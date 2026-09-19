import type { TrackGenIndex } from '../utils/trackGenLocate'

/**
 * 沿路徑補間。
 *
 * <h3>為什麼不能在畫面上直線補間</h3>
 * 遙測一秒一筆。把「上一筆的畫面點」直線滑到「這一筆的畫面點」，中間走的是兩點的弦：
 * 兩點分別在彎道兩側時，車會穿過彎道內側，畫面上就是切出軌道。兩個端點都在路上，
 * 中間不一定。
 *
 * 改成補<strong>沿線位置</strong>：車在路上的位置本來就是（哪一塊、走了幾成、偏了多少），
 * 補這三個值，每一幀再從那一塊的圖面路徑取座標——不管路怎麼彎，車都在路上。
 * 換塊時沿相連的端點走：先走完上一塊，再從下一塊的起點走到位置。
 *
 * 這個檔案只有算法，沒有 React；畫面那一側見 useVehiclePathTween。
 */

export type PathPose = {
  /** 軌道設施 id */
  trackId: string
  /** 在這一塊上走了幾成（0–1，照折線記錄順序） */
  along: number
  /** 離中心線多遠（公尺，左正右負） */
  side: number
}

export type PathTween = {
  from: PathPose
  to: PathPose
  startMs: number
  durationMs: number
  /**
   * 換塊時的中繼：先從 from 走到它那一塊的 fromEndAlong，再從 to 那一塊的
   * toStartAlong 走到 to。同一塊沒有這一項。
   */
  via: { fromEndAlong: number; toStartAlong: number; splitAt: number } | null
}

/**
 * 一次補間最多走多遠（公尺）。超過就不補了直接到——一秒鐘不會走這麼遠，
 * 多半是重新發車、換單或資料斷了很久，補間只會讓車在圖上飛過去。
 */
export const MAX_TWEEN_TRAVEL_M = 80

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function poseSignature(p: PathPose): string {
  return `${p.trackId}|${p.along.toFixed(5)}|${p.side.toFixed(3)}`
}

/**
 * 規劃從目前顯示的位置補到新位置。
 *
 * 補不了（不同塊又不相連、或距離太遠）就回一個時長為 0 的補間：直接到位。
 */
export function planPathTween(
  index: TrackGenIndex,
  from: PathPose,
  to: PathPose,
  nowMs: number,
  durationMs: number,
): PathTween {
  const snap: PathTween = { from: to, to, startMs: nowMs, durationMs: 0, via: null }
  if (!(durationMs > 0)) return snap

  const lenFrom = index.lengthM.get(from.trackId) ?? 0
  const lenTo = index.lengthM.get(to.trackId) ?? 0

  if (from.trackId === to.trackId) {
    if (Math.abs(to.along - from.along) * lenFrom > MAX_TWEEN_TRAVEL_M) return snap
    return { from, to, startMs: nowMs, durationMs, via: null }
  }

  // 沿相連的端點走：挑總路程最短的那一組接點
  let best: { end: 0 | 1; toEnd: 0 | 1; d1: number; d2: number } | null = null
  for (const j of index.joins.get(from.trackId) ?? []) {
    if (j.to !== to.trackId) continue
    const d1 = Math.abs(j.end - from.along) * lenFrom
    const d2 = Math.abs(to.along - j.toEnd) * lenTo
    if (!best || d1 + d2 < best.d1 + best.d2) best = { end: j.end, toEnd: j.toEnd, d1, d2 }
  }
  if (!best) return snap
  const total = best.d1 + best.d2
  if (total > MAX_TWEEN_TRAVEL_M) return snap
  return {
    from,
    to,
    startMs: nowMs,
    durationMs,
    via: {
      fromEndAlong: best.end,
      toStartAlong: best.toEnd,
      // 兩段各佔多少時間，照路程比例；總路程是 0（剛好在接點上）就對半分
      splitAt: total > 1e-6 ? best.d1 / total : 0.5,
    },
  }
}

/** 補間在 nowMs 這一刻的位置，以及補完了沒有 */
export function samplePathTween(
  tween: PathTween,
  nowMs: number,
): { pose: PathPose; done: boolean } {
  if (!(tween.durationMs > 0)) return { pose: tween.to, done: true }
  const u = clamp01((nowMs - tween.startMs) / tween.durationMs)
  if (u >= 1) return { pose: tween.to, done: true }

  const { from, to, via } = tween
  if (!via) {
    return {
      pose: {
        trackId: to.trackId,
        along: lerp(from.along, to.along, u),
        side: lerp(from.side, to.side, u),
      },
      done: false,
    }
  }

  // 橫向偏差在整段之間平順過渡，不在換塊的瞬間跳
  const side = lerp(from.side, to.side, u)
  if (u < via.splitAt) {
    const k = via.splitAt > 1e-9 ? u / via.splitAt : 1
    return {
      pose: { trackId: from.trackId, along: lerp(from.along, via.fromEndAlong, k), side },
      done: false,
    }
  }
  const rest = 1 - via.splitAt
  const k = rest > 1e-9 ? (u - via.splitAt) / rest : 1
  return {
    pose: { trackId: to.trackId, along: lerp(via.toStartAlong, to.along, k), side },
    done: false,
  }
}
