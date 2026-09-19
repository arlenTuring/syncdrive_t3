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

/** 沿一塊軌道走的一段：從 a 走到 b（0–1，照折線記錄順序），實長 lengthM 公尺 */
export type PathStep = { trackId: string; a: number; b: number; lengthM: number }

export type PathTween = {
  from: PathPose
  to: PathPose
  startMs: number
  durationMs: number
  /**
   * 換塊時沿相連端點走過的每一段（含起點那塊剩下的、中間整塊走完的、終點那塊走到的）。
   * 同一塊沒有這一項。可以跨好幾塊：一秒的位移跨過中間的短路段時照樣沿路走。
   */
  steps: PathStep[] | null
}

/**
 * 一次補間最多走多遠（公尺）。超過就不補了直接到——一秒鐘不會走這麼遠，
 * 多半是重新發車、換單或資料斷了很久，補間只會讓車在圖上飛過去。
 */
export const MAX_TWEEN_TRAVEL_M = 80

/** 最多跨幾塊。一秒的位移不會跨很多塊；超過多半是換單或資料斷了 */
export const MAX_TWEEN_HOPS = 4

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function poseSignature(p: PathPose): string {
  return `${p.trackId}|${p.along.toFixed(5)}|${p.side.toFixed(3)}`
}

/**
 * 規劃從目前顯示的位置補到新位置。
 *
 * 補不了（不同塊又接不起來、或距離太遠）就回一個時長為 0 的補間：直接到位。
 */
export function planPathTween(
  index: TrackGenIndex,
  from: PathPose,
  to: PathPose,
  nowMs: number,
  durationMs: number,
): PathTween {
  const snap: PathTween = { from: to, to, startMs: nowMs, durationMs: 0, steps: null }
  if (!(durationMs > 0)) return snap

  const lenFrom = index.lengthM.get(from.trackId) ?? 0

  if (from.trackId === to.trackId) {
    if (Math.abs(to.along - from.along) * lenFrom > MAX_TWEEN_TRAVEL_M) return snap
    return { from, to, startMs: nowMs, durationMs, steps: null }
  }

  const steps = findSteps(index, from, to)
  if (!steps) return snap
  return { from, to, startMs: nowMs, durationMs, steps }
}

/**
 * 從 from 沿相連的端點走到 to，總路程最短的一條（最多 MAX_TWEEN_HOPS 塊）。
 *
 * 進一塊是從哪一端進來的，就從另一端出去；圖很小，深度受限的搜尋就夠。
 */
function findSteps(index: TrackGenIndex, from: PathPose, to: PathPose): PathStep[] | null {
  const lenOf = (id: string) => index.lengthM.get(id) ?? 0
  let best: { cost: number; steps: PathStep[] } | null = null

  // exit：從 trackId 的哪一端離開；prefix：到這裡為止已經走過的段；cost：已走的路程
  const walk = (
    trackId: string,
    exitEnd: 0 | 1,
    prefix: PathStep[],
    cost: number,
    visited: Set<string>,
  ): void => {
    if (cost > MAX_TWEEN_TRAVEL_M) return
    for (const j of index.joins.get(trackId) ?? []) {
      if (j.end !== exitEnd || visited.has(j.to)) continue
      if (j.to === to.trackId) {
        const finalLen = Math.abs(to.along - j.toEnd) * lenOf(j.to)
        const total = cost + finalLen
        if (total <= MAX_TWEEN_TRAVEL_M && (!best || total < best.cost)) {
          best = {
            cost: total,
            steps: [...prefix, { trackId: j.to, a: j.toEnd, b: to.along, lengthM: finalLen }],
          }
        }
        continue
      }
      if (prefix.length >= MAX_TWEEN_HOPS) continue
      // 整塊走完：從進來的那一端走到另一端
      const through = lenOf(j.to)
      const nextExit: 0 | 1 = j.toEnd === 0 ? 1 : 0
      visited.add(j.to)
      walk(
        j.to,
        nextExit,
        [...prefix, { trackId: j.to, a: j.toEnd, b: nextExit, lengthM: through }],
        cost + through,
        visited,
      )
      visited.delete(j.to)
    }
  }

  for (const exitEnd of [0, 1] as const) {
    const first: PathStep = {
      trackId: from.trackId,
      a: from.along,
      b: exitEnd,
      lengthM: Math.abs(exitEnd - from.along) * lenOf(from.trackId),
    }
    walk(from.trackId, exitEnd, [first], first.lengthM, new Set([from.trackId]))
  }
  return best ? (best as { steps: PathStep[] }).steps : null
}

/** 補間在 nowMs 這一刻的位置，以及補完了沒有 */
export function samplePathTween(
  tween: PathTween,
  nowMs: number,
): { pose: PathPose; done: boolean } {
  if (!(tween.durationMs > 0)) return { pose: tween.to, done: true }
  const u = clamp01((nowMs - tween.startMs) / tween.durationMs)
  if (u >= 1) return { pose: tween.to, done: true }

  const { from, to, steps } = tween
  // 橫向偏差在整段之間平順過渡，不在換塊的瞬間跳
  const side = lerp(from.side, to.side, u)
  if (!steps) {
    return {
      pose: { trackId: to.trackId, along: lerp(from.along, to.along, u), side },
      done: false,
    }
  }

  // 時間照路程分配：走在哪一段由已走的路程決定
  const total = steps.reduce((sum, st) => sum + st.lengthM, 0)
  if (!(total > 1e-6)) {
    return { pose: { trackId: to.trackId, along: to.along, side }, done: false }
  }
  let remaining = u * total
  for (const st of steps) {
    if (remaining <= st.lengthM || st === steps[steps.length - 1]) {
      const k = st.lengthM > 1e-9 ? Math.min(1, remaining / st.lengthM) : 1
      return { pose: { trackId: st.trackId, along: lerp(st.a, st.b, k), side }, done: false }
    }
    remaining -= st.lengthM
  }
  return { pose: { trackId: to.trackId, along: to.along, side }, done: false }
}
