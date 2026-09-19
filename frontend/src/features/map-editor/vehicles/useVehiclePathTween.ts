import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackGenIndex } from '../utils/trackGenLocate'
import {
  planPathTween,
  poseSignature,
  samplePathTween,
  type PathPose,
  type PathTween,
} from './pathTween'

/**
 * 每台車的沿路徑補間狀態，以及讓畫面在補間期間持續重畫的節拍。
 *
 * 用法：在 render 裡對每台車呼叫回傳的 resolve(id, 目標位置, 是否瞬移)，拿到的是
 * <strong>這一刻</strong>該畫的位置。補間期間 hook 會自己排下一幀；補完就停，靜止的
 * 車不會空轉。
 *
 * 30 fps 就夠：遙測本來一秒一筆，補間是把兩筆之間畫平順，不需要 60。
 */

const FRAME_MS = 33

type VehicleTweenState = {
  signature: string
  tween: PathTween
}

export function useVehiclePathTween(index: TrackGenIndex | undefined, durationMs: number) {
  const statesRef = useRef(new Map<string, VehicleTweenState>())
  const animatingRef = useRef(false)
  const [, setFrame] = useState(0)

  // 每次 render 重新判斷「這一輪還有沒有車在補間」
  animatingRef.current = false

  const resolve = useCallback(
    (vehicleId: string, target: PathPose, teleport: boolean): PathPose => {
      if (!index || !(durationMs > 0)) return target
      const now = performance.now()
      const signature = poseSignature(target)
      const states = statesRef.current
      let state = states.get(vehicleId)

      if (!state) {
        state = {
          signature,
          tween: { from: target, to: target, startMs: now, durationMs: 0, steps: null },
        }
        states.set(vehicleId, state)
        return target
      }

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

  // 每次 render 之後：還有車在補間就排下一幀
  useEffect(() => {
    if (!animatingRef.current) return undefined
    const timer = window.setTimeout(() => setFrame((n) => (n + 1) % 1_000_000), FRAME_MS)
    return () => window.clearTimeout(timer)
  })

  return { resolve, prune }
}
