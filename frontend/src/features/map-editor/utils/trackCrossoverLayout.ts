import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import {
  areaLocalPxToMeter,
  clientToAreaLocalPx,
  meterSizeToAreaLocalPx,
  meterToAreaLocalPx,
} from './areaCoords'
import {
  crossoverPortalsAabb,
  syncCrossoverPortalFieldMeters,
  type CrossoverPortals,
  TRACK_CROSSOVER_PORTALS_KEY,
} from './trackCrossoverFacility'

export type CrossoverLayoutSync = {
  parametersPatch: Record<string, unknown>
  position: { x: number; y: number }
  areaPosition: { x: number; y: number }
  areaSizePx: { w: number; h: number }
}

/** 依端點 AABB 同步設施位置與圖台尺寸 */
export function syncLayoutFromCrossoverPortals(
  portals: CrossoverPortals,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): CrossoverLayoutSync {
  // 走到這裡代表端點在圖上真的被移動了（拖動或磁吸接合），現場座標要跟著走。
  // 屬性面板手打現場座標不會經過這裡——那是純粹修正量測值，不該移動圖上的端點。
  const synced: CrossoverPortals = {
    a: syncCrossoverPortalFieldMeters(portals.a),
    b: syncCrossoverPortalFieldMeters(portals.b),
  }
  const aabb = crossoverPortalsAabb(synced)
  const position = { x: aabb.xMinM, y: aabb.yMinM }
  const sizeM = {
    w: Math.max(0.5, aabb.xMaxM - aabb.xMinM),
    h: Math.max(0.5, aabb.yMaxM - aabb.yMinM),
  }
  const areaSizePx = meterSizeToAreaLocalPx(sizeM.w, sizeM.h, domain, layout)
  const areaLocal = meterToAreaLocalPx(position.x, position.y, domain, layout)
  return {
    parametersPatch: { [TRACK_CROSSOVER_PORTALS_KEY]: synced },
    position,
    areaPosition: { x: areaLocal.x, y: areaLocal.y },
    areaSizePx: {
      w: Math.max(8, areaSizePx.w),
      h: Math.max(8, areaSizePx.h),
    },
  }
}

/**
 * 螢幕指標 → 場域公尺。
 * clientToAreaLocalPx 是 CSS（左上、y 向下）；areaLocalPxToMeter 要的是區域座標（左下、y 向上）。
 */
export function clientPointToFieldMeters(
  clientX: number,
  clientY: number,
  worldEl: HTMLElement,
  mapScale: number,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { xM: number; yM: number } {
  const css = clientToAreaLocalPx(clientX, clientY, worldEl, mapScale)
  const areaYFromBottom = layout.hPx - css.y
  const m = areaLocalPxToMeter(css.x, areaYFromBottom, domain, layout)
  return { xM: m.x, yM: m.y }
}
