import { useEffect, useRef } from 'react'
import type { MapAreaObject } from '../types/area'
import {
  movedFacilityKeys,
  rebuildStaleAmong,
  snapshotGeometry,
  type GeometrySnapshot,
} from '../utils/rederiveAfterMove'
import { healTrackChainsInAreas } from '../utils/shapedTrackPaths'
import { reanchorFieldPointsAfterTrackHeal } from '../utils/reanchorPointsAfterHeal'

/** 動完之後等多久才檢查——拖曳過程中每一幀都動，只在停手後算一次 */
const SETTLE_MS = 600

/**
 * 編輯模式下，剛移動、縮放或複製貼上的軌道若兩端接不上隔壁，就重建它的中心線。
 * 規則與理由見 utils/rederiveAfterMove。
 */
export function useRebuildStaleTracksAfterMove(
  areas: MapAreaObject[],
  active: boolean,
  setAreas: (fn: (prev: MapAreaObject[]) => MapAreaObject[]) => void,
): void {
  const baseline = useRef<GeometrySnapshot>(new Map())
  const pending = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(areas)
  latest.current = areas

  useEffect(() => {
    const next = snapshotGeometry(areas)
    const moved = active ? movedFacilityKeys(baseline.current, next) : null
    baseline.current = next
    if (!moved || moved.length === 0) return
    for (const k of moved) pending.current.add(k)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const keys = [...pending.current]
      pending.current.clear()
      const outcome = rebuildStaleAmong(latest.current, keys)
      // 動過之後整條鏈也檢查一次：多算的、反的、因此對不上的鄰居（見 healTrackChainsInAreas）
      const chained = healTrackChainsInAreas(outcome.areas)
      const chainChanged = chained.areas !== outcome.areas
      if (chainChanged) {
        const parts = [
          ...chained.trimmed.map((n) => `${n} 多算一段已減掉重疊`),
          ...chained.flipped.map((n) => `${n} 圖面路徑已翻正`),
          ...chained.propagated.map((n) => `${n} 依新端點重建`),
        ]
        console.info(`[map] 軌道鏈修正：${parts.join('、')}`)
      }
      if (outcome.rebuilt.length === 0 && !chainChanged) return
      for (const r of outcome.rebuilt) {
        console.info(
          `[map] ${r.label} 移動後場域位置已跟著相接的軌道更新（位移 ${r.changedM.toFixed(1)} 公尺）`,
        )
      }
      // 用最新的狀態再算一次：等待期間使用者可能又改了別的
      setAreas((prev) => {
        const rebuilt = rebuildStaleAmong(prev, keys).areas
        const healed = healTrackChainsInAreas(rebuilt).areas
        return reanchorFieldPointsAfterTrackHeal(rebuilt, healed).areas
      })
      // 重建改的是參數，位置與大小沒變：快照不必更新
    }, SETTLE_MS)
  }, [areas, active, setAreas])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
}
