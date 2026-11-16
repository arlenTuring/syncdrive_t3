import { useCallback, useState } from 'react'
import type { MapAreaObject, MapPixelOrigin, MapPixelSize } from '../types/area'
import type { MapBasemapObject } from '../types/basemap'
import type { PointTopology } from '../types/pointTopology'

export type MapEditorSnapshot = {
  areas: MapAreaObject[]
  basemaps: MapBasemapObject[]
  mapPixelSize: MapPixelSize
  mapPixelOrigin: MapPixelOrigin
  selectedAreaId: string | null
  selectedFacilityIds: string[]
  selectedBasemapId: string | null
  nextNumericId: number
  /**
   * 路網拓樸跟著區域一起記。刪設施時拓樸會自動移除對不到設施的點（syncPointTopologyWithAreas），
   * 復原只還原區域的話，拓樸回不來，自動儲存就把空拓樸存進去
   * （2026-11-11 實測：整張圖刪除再復原，路網拓樸變成 0 點 0 邊）。
   */
  pointTopology: PointTopology
}

const MAX_HISTORY = 50

function cloneSnapshot(s: MapEditorSnapshot): MapEditorSnapshot {
  return {
    areas: structuredClone(s.areas),
    basemaps: structuredClone(s.basemaps),
    mapPixelSize: { ...s.mapPixelSize },
    mapPixelOrigin: { ...s.mapPixelOrigin },
    selectedAreaId: s.selectedAreaId,
    selectedFacilityIds: [...s.selectedFacilityIds],
    selectedBasemapId: s.selectedBasemapId,
    nextNumericId: s.nextNumericId,
    pointTopology: structuredClone(s.pointTopology),
  }
}

type UseMapHistoryParams = {
  getSnapshot: () => MapEditorSnapshot
  applySnapshot: (s: MapEditorSnapshot) => void
}

export function useMapHistory({ getSnapshot, applySnapshot }: UseMapHistoryParams) {
  const [past, setPast] = useState<MapEditorSnapshot[]>([])
  const [future, setFuture] = useState<MapEditorSnapshot[]>([])

  const pushHistory = useCallback(() => {
    const snap = cloneSnapshot(getSnapshot())
    setPast((prev) => [...prev, snap].slice(-MAX_HISTORY))
    setFuture([])
  }, [getSnapshot])

  const undo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev
      const before = prev[prev.length - 1]
      const current = cloneSnapshot(getSnapshot())
      setFuture((f) => [current, ...f].slice(0, MAX_HISTORY))
      applySnapshot(before)
      return prev.slice(0, -1)
    })
  }, [getSnapshot, applySnapshot])

  const redo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev
      const next = prev[0]
      const current = cloneSnapshot(getSnapshot())
      setPast((p) => [...p, current].slice(-MAX_HISTORY))
      applySnapshot(next)
      return prev.slice(1)
    })
  }, [getSnapshot, applySnapshot])

  const resetHistory = useCallback(() => {
    setPast([])
    setFuture([])
  }, [])

  return {
    pushHistory,
    undo,
    redo,
    resetHistory,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
