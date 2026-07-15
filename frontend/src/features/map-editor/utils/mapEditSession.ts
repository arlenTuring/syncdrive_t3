import type { MapAreaObject, MapPixelOrigin, MapPixelSize } from '../types/area'
import type { MapPlannedRoute, MapRouteGroup } from '../types/mapFile'

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
  routeGroups: MapRouteGroup[]
  routes: MapPlannedRoute[]
  nextNumericId: number
  loadedMapMeta: LoadedMapMetaSnapshot
}

export function isEditSessionDirty(
  baseline: EditSessionSnapshot | null,
  areas: MapAreaObject[],
  routeGroups: MapRouteGroup[],
  routes: MapPlannedRoute[],
  nextNumericId: number,
  loadedMapMeta: LoadedMapMetaSnapshot,
): boolean {
  if (!baseline) return false
  return (
    JSON.stringify(baseline.areas) !== JSON.stringify(areas) ||
    JSON.stringify(baseline.routeGroups) !== JSON.stringify(routeGroups) ||
    JSON.stringify(baseline.routes) !== JSON.stringify(routes) ||
    baseline.nextNumericId !== nextNumericId ||
    JSON.stringify(baseline.loadedMapMeta) !== JSON.stringify(loadedMapMeta)
  )
}
