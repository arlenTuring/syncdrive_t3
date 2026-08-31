import { useCallback, useState } from 'react'
import type { MapAreaObject, MapPixelOrigin, MapPixelSize } from '../types/area'
import type { MapBasemapObject } from '../types/basemap'

export type MapEditorSnapshot = {
  areas: MapAreaObject[]
  basemaps: MapBasemapObject[]
  mapPixelSize: MapPixelSize
  mapPixelOrigin: MapPixelOrigin
  selectedAreaId: string | null
  selectedFacilityIds: string[]
  selectedBasemapId: string | null
  nextNumericId: number
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
