import { useEffect, useRef } from 'react'
import type { MapAreaObject } from '../types/area'
import {
  movedFacilityKeys,
  rebuildStaleAmong,
  snapshotGeometry,
  type GeometrySnapshot,
} from '../utils/rederiveAfterMove'
import { backfillTrackGenLatPerBoxInAreas, deriveShapedTrackPathsInAreas } from '../utils/shapedTrackPaths'
import { backfillTrackGenSpansInAreas } from '../utils/trackGenSpanBackfill'
import { settleTrackJointsInAreas } from '../utils/trackJoints'

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
    // 刪掉軌道：沒有東西要重建，但它原本的接點要整理（只剩一塊的接點不留）
    const removed =
      active && baseline.current.size > 0 && [...baseline.current.keys()].some((k) => !next.has(k))
    baseline.current = next
    if ((!moved || moved.length === 0) && !removed) return
    for (const k of moved ?? []) pending.current.add(k)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const keys = [...pending.current]
      pending.current.clear()
      const outcome = rebuildStaleAmong(latest.current, keys)
      for (const r of outcome.rebuilt) {
        console.info(
          `[map] ${r.label} 移動後場域位置已跟著相接的軌道更新（位移 ${r.changedM.toFixed(1)} 公尺）`,
        )
      }
      // 用最新的狀態再算一次：等待期間使用者可能又改了別的
      setAreas((prev) => {
        const rebuilt = rebuildStaleAmong(prev, keys).areas
        // 新拉的軌道：先補中心線（接隔壁或分區入口），再整理接點，最後補里程；
        // 不然要等下次重新載入才補，期間存出去的檔案缺這些
        const shaped = deriveShapedTrackPathsInAreas(backfillTrackGenLatPerBoxInAreas(rebuilt).areas).areas
        // 整理接點：拖開的放掉、貼上的併成接點，中心線頭尾依接點對齊
        const settled = backfillTrackGenSpansInAreas(settleTrackJointsInAreas(shaped).areas).areas
        return settled.every((a, i) => a === prev[i]) && settled.length === prev.length ? prev : settled
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
