import { defaultBasemapParameters } from '../utils/basemapFacility'

export interface MapBasemapLayout {
  xPx: number
  yPx: number
  wPx: number
  hPx: number
}

export interface MapBasemapObject {
  id: string
  customName: string
  layout: MapBasemapLayout
  parameters?: Record<string, unknown>
}

export function createBlankBasemap(
  id: string,
  mapPointPx: { x: number; y: number },
  sizePx = { w: 400, h: 300 },
): MapBasemapObject {
  const w = Math.max(80, sizePx.w)
  const h = Math.max(60, sizePx.h)
  return {
    id,
    customName: `底圖 ${id}`,
    layout: {
      xPx: mapPointPx.x - w / 2,
      yPx: mapPointPx.y - h / 2,
      wPx: w,
      hPx: h,
    },
    parameters: defaultBasemapParameters(),
  }
}
