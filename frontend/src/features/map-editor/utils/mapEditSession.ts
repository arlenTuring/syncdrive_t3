import type { MapAreaObject, MapPixelOrigin, MapPixelSize } from '../types/area'

export type LoadedMapMetaSnapshot = {
  libraryId: string
  mapId: string
  displayName: string
  version: string
  pixelSize: MapPixelSize
  pixelOrigin: MapPixelOrigin
}

export type EditSessionSnapshot = {
  areas: MapAreaObject[]
  nextNumericId: number
  loadedMapMeta: LoadedMapMetaSnapshot
}

export function isEditSessionDirty(
  baseline: EditSessionSnapshot | null,
  areas: MapAreaObject[],
  nextNumericId: number,
  loadedMapMeta: LoadedMapMetaSnapshot,
): boolean {
  if (!baseline) return false
  return (
    JSON.stringify(baseline.areas) !== JSON.stringify(areas) ||
    baseline.nextNumericId !== nextNumericId ||
    JSON.stringify(baseline.loadedMapMeta) !== JSON.stringify(loadedMapMeta)
  )
}
