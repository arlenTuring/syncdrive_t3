import type { MapAreaDomain, MapAreaObject } from '../types/area'
import { domainHeightM, domainWidthM } from './areaCoords'
import { getTrackGenPaths } from './trackGenPaths'

/** 圖台刻度顯示模式：關閉／畫布刻度（解析度尺）／場域實際座標 */
export type MapRulerDisplayMode = 'off' | 'scale' | 'field'

export function cycleMapRulerDisplayMode(
  mode: MapRulerDisplayMode,
): MapRulerDisplayMode {
  if (mode === 'off') return 'scale'
  if (mode === 'scale') return 'field'
  return 'off'
}

export type FieldAabbMeters = {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
}

/**
 * 由生成軌道的真實路徑估場域外框。
 * 尺標必須用這套外框做<strong>線性</strong>對應；不可沿邊呼叫 track 反推，
 * 否則會與 domain 刻度混成兩套數字（例如 −43 與 400 同尺）。
 */
export function trackGenFieldAabb(
  area: MapAreaObject,
): FieldAabbMeters | null {
  let xMinM = Infinity
  let xMaxM = -Infinity
  let yMinM = Infinity
  let yMaxM = -Infinity
  let any = false
  for (const f of area.facilities) {
    const paths = getTrackGenPaths(f.parameters)
    if (!paths?.real?.length) continue
    for (const pt of paths.real) {
      const x = pt[0]
      const y = pt[1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      any = true
      if (x < xMinM) xMinM = x
      if (x > xMaxM) xMaxM = x
      if (y < yMinM) yMinM = y
      if (y > yMaxM) yMaxM = y
    }
  }
  if (!any) return null
  if (!(xMaxM > xMinM)) {
    xMaxM = xMinM + 1e-3
  }
  if (!(yMaxM > yMinM)) {
    yMaxM = yMinM + 1e-3
  }
  return { xMinM, xMaxM, yMinM, yMaxM }
}

/**
 * 尺用場域座標：domain 位置 → 單一座標系的線性映射。
 *
 * - 有軌道生成：對到真實路徑 AABB（與車輛座標系一致、且單調）
 * - 否則：domain 本身即場域／顯示尺
 */
export function rulerFieldMetersAtDomain(
  domain: MapAreaDomain,
  domainXM: number,
  domainYM: number,
  area?: MapAreaObject | null,
): { xM: number; yM: number } {
  const aabb = area ? trackGenFieldAabb(area) : null
  if (!aabb) {
    return { xM: domainXM, yM: domainYM }
  }
  const w = domainWidthM(domain)
  const h = domainHeightM(domain)
  const u = (domainXM - domain.xMinM) / w
  const v = (domainYM - domain.yMinM) / h
  return {
    xM: aabb.xMinM + u * (aabb.xMaxM - aabb.xMinM),
    yM: aabb.yMinM + v * (aabb.yMaxM - aabb.yMinM),
  }
}

/**
 * 尺用場域座標反推：場域公尺 → domain（與 rulerFieldMetersAtDomain 互為反函數）。
 * 供選取引導把元件自身 refField 範圍對到刻度帶位置（如分區）。
 */
export function rulerDomainAtFieldMeters(
  domain: MapAreaDomain,
  fieldXM: number,
  fieldYM: number,
  area?: MapAreaObject | null,
): { xM: number; yM: number } {
  const aabb = area ? trackGenFieldAabb(area) : null
  if (!aabb) {
    return { xM: fieldXM, yM: fieldYM }
  }
  const fw = aabb.xMaxM - aabb.xMinM
  const fh = aabb.yMaxM - aabb.yMinM
  const u = fw > 0 ? (fieldXM - aabb.xMinM) / fw : 0
  const v = fh > 0 ? (fieldYM - aabb.yMinM) / fh : 0
  return {
    xM: domain.xMinM + u * domainWidthM(domain),
    yM: domain.yMinM + v * domainHeightM(domain),
  }
}
