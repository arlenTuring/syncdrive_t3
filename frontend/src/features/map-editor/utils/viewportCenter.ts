import { MAX_NODE_WORLD_H, MAX_NODE_WORLD_W } from '../constants/facilityDimensions'
import type { FacilityType } from '../types/facility'
import { metersToWorldPx, worldPxToMeters } from '../constants/map'
import { snapDragPosition } from './snapDrag'
import type { MapWorldBounds } from './mapViewport'
import { nodeWorldSizeForFacilityType } from './placement'

/** 以目前可視區中心對應的世界座標（資產列新增元件用）；需與 MapCanvas 的 scaleX／scaleY 一致 */
export function computeViewportCenterPosition(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  facilityType: FacilityType = 'Slot',
  worldBounds?: MapWorldBounds,
): { x: number; y: number } {
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1
  const { w: nw, h: nh } = nodeWorldSizeForFacilityType(facilityType)
  const bounds = {
    worldW: worldBounds?.worldW ?? MAX_NODE_WORLD_W,
    worldH: worldBounds?.worldH ?? MAX_NODE_WORLD_H,
  }
  if (!viewport) {
    return snapDragPosition(
      bounds.worldW / 2 - nw / 2,
      bounds.worldH / 2 - nh / 2,
      { w: nw, h: nh },
      bounds,
    )
  }
  const centerMeters = {
    x: worldPxToMeters((viewport.scrollLeft + viewport.clientWidth / 2) / sx),
    y: worldPxToMeters((viewport.scrollTop + viewport.clientHeight / 2) / sy),
  }
  const x = metersToWorldPx(centerMeters.x) - nw / 2
  const y = metersToWorldPx(centerMeters.y) - nh / 2
  return snapDragPosition(x, y, { w: nw, h: nh }, bounds)
}
