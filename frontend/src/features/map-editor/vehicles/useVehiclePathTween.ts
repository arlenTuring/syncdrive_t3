import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackGenIndex } from '../utils/trackGenLocate'
import {
  planPathTween,
  poseSignature,
  samplePathTween,
  type PathPose,
  type PathTween,
} from './pathTween'
import {
  createPlayoutState,
  pushPlayoutSample,
  resolvePlayoutPose,
  type PlayoutState,
} from './pathPlayout'

/**
 * 每台車的沿路徑補間狀態，以及讓畫面在補間期間持續重畫的節拍。
 *
 * 用法：在 render 裡對每台車呼叫回傳的 resolve(id, 目標位置, 是否瞬移)，拿到的是
 * <strong>這一刻</strong>該畫的位置。補間期間 hook 會自己排下一幀；補完就停，靜止的
 * 車不會空轉。
 *
 * 遙測帶時間戳時走緩衝播放（見 pathPlayout）：照車端時間戳在前後兩筆之間補，
 * 送達時間抖動不會讓車停住再追。沒有時間戳才退回「收到就朝它補 durationMs」。
 *
 * 30 fps 就夠：遙測本來一秒一筆，補間是把兩筆之間畫平順，不需要 60。節拍跟著
 * requestAnimationFrame 走（每隔一幀畫一次），不用 setTimeout——計時器跟螢幕更新
 * 不同步，會一幀動、一幀不動，看起來抖。
 */

const FRAME_MS = 33

type VehicleTweenState = {
  signature: string
  tween: PathTween
  /** 帶時間戳的遙測才有：緩衝播放狀態 */
  playout: PlayoutState | null
  lastSampleMs: number | null
}

export function useVehiclePathTween(index: TrackGenIndex | undefined, durationMs: number) {
  const statesRef = useRef(new Map<string, VehicleTweenState>())
  const animatingRef = useRef(false)
  const [, setFrame] = useState(0)

  // 每次 render 重新判斷「這一輪還有沒有車在補間」
  animatingRef.current = false

  const resolve = useCallback(
    (vehicleId: string, target: PathPose, teleport: boolean, sampleMs?: number | null): PathPose => {
      if (!index || !(durationMs > 0)) return target
      const now = performance.now()
      const signature = poseSignature(target)
      const states = statesRef.current
      let state = states.get(vehicleId)

      if (!state) {
        state = {
          signature,
          tween: { from: target, to: target, startMs: now, durationMs: 0, steps: null },
          playout: sampleMs != null ? createPlayoutState(target, sampleMs, Date.now()) : null,
          lastSampleMs: sampleMs ?? null,
        }
        states.set(vehicleId, state)
        return target
      }

      // 緩衝播放：每筆新遙測（時間戳往前）收進緩衝，照時間戳取樣
      if (sampleMs != null) {
        const wallNow = Date.now()
        if (teleport || !state.playout) {
          state.playout = createPlayoutState(target, sampleMs, wallNow)
        } else if (state.lastSampleMs == null || sampleMs > state.lastSampleMs) {
          pushPlayoutSample(index, state.playout, target, sampleMs, wallNow)
        }
        state.lastSampleMs = sampleMs
        state.signature = signature
        const { pose, animating } = resolvePlayoutPose(state.playout, wallNow)
        if (animating) animatingRef.current = true
        return pose
      }
      state.playout = null
      state.lastSampleMs = null

      if (state.signature !== signature) {
        // 從「現在畫在哪裡」補到新位置，不是從上一筆的目標——補到一半又來新資料時才不會倒退
        const shown = samplePathTween(state.tween, now).pose
        state.tween = teleport
          ? { from: target, to: target, startMs: now, durationMs: 0, steps: null }
          : planPathTween(index, shown, target, now, durationMs)
        state.signature = signature
      }

      const { pose, done } = samplePathTween(state.tween, now)
      if (!done) animatingRef.current = true
      return pose
    },
    [index, durationMs],
  )

  /** 車不在了就把它的狀態清掉，免得下次同一個 id 出現時從舊位置補過去 */
  const prune = useCallback((activeIds: ReadonlySet<string>) => {
    for (const id of statesRef.current.keys()) {
      if (!activeIds.has(id)) statesRef.current.delete(id)
    }
  }, [])

  // 每次 render 之後：還有車在補間就排下一幀（跟著螢幕更新，約每 FRAME_MS 畫一次）
  useEffect(() => {
    if (!animatingRef.current) return undefined
    const scheduledAt = performance.now()
    let raf = 0
    const tick = (t: number) => {
      if (t - scheduledAt >= FRAME_MS - 4) {
        setFrame((n) => (n + 1) % 1_000_000)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  /** 這台車離開軌道（進場區、停格）時清掉，重新進軌道不會從過時的軌道位置補過去 */
  const reset = useCallback((vehicleId: string) => {
    statesRef.current.delete(vehicleId)
  }, [])

  return { resolve, prune, reset }
}
