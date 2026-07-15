import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import { domainHeightM, domainWidthM } from './areaCoords'
import { resolveFacilityRenderPlacement } from './facilityAreaCoords'
import { collectStationsFromAreas } from './dockingPointStationId'

export type RoutePlanningDraft = {
  routeId: string | null
  displayName: string
  stationIds: string[]
  /** 所屬路線群組；新建時預設帶入 */
  groupId: string | null
  /** 走完路線平均時間（秒）；不含月台門停靠 */
  avgTravelTimeSeconds: number | null
  /** 走完路線最快時間（秒）；不含月台門停靠 */
  minTravelTimeSeconds: number | null
}

export type RouteStationPoint = {
  stationId: string
  stationName: string
  x: number
  y: number
}

const ROUTE_ID_PATTERN = /^route_(\d+)$/

export function parsePositiveRouteSeconds(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return Math.round(raw)
}

export function resolveRouteTravelTimesFromBody(body: Record<string, unknown>): {
  avgTravelTimeSeconds: number | null
  minTravelTimeSeconds: number | null
} {
  const avg = parsePositiveRouteSeconds(body.avgTravelTimeSeconds)
  const min = parsePositiveRouteSeconds(body.minTravelTimeSeconds)
  if (avg != null || min != null) {
    return { avgTravelTimeSeconds: avg, minTravelTimeSeconds: min }
  }
  const legacy = parsePositiveRouteSeconds(body.travelTimeSeconds)
  return {
    avgTravelTimeSeconds: legacy,
    minTravelTimeSeconds: legacy,
  }
}

export function isRouteTravelTimePairValid(
  avg: number | null | undefined,
  min: number | null | undefined,
): boolean {
  if (avg == null || min == null || avg <= 0 || min <= 0) return false
  return min <= avg
}

export function formatRouteTravelTimeSummary(
  avg: number | null | undefined,
  min: number | null | undefined,
): string | null {
  const hasAvg = avg != null && avg > 0
  const hasMin = min != null && min > 0
  if (!hasAvg && !hasMin) return null
  if (hasAvg && hasMin) return `均 ${avg} 秒 · 快 ${min} 秒`
  if (hasAvg) return `均 ${avg} 秒`
  return `快 ${min} 秒`
}

export function isRoutePlanningDraftSavable(draft: RoutePlanningDraft): boolean {
  if (!draft.displayName.trim() || draft.stationIds.length < 2) {
    return false
  }
  return isRouteTravelTimePairValid(
    draft.avgTravelTimeSeconds,
    draft.minTravelTimeSeconds,
  )
}

export function generateNextRouteId(routes: MapPlannedRoute[]): string {
  const ids = new Set(routes.map((r) => r.routeId))
  let max = 0
  for (const id of ids) {
    const match = ROUTE_ID_PATTERN.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  let next = max + 1
  let candidate = `route_${next}`
  while (ids.has(candidate)) {
    next += 1
    candidate = `route_${next}`
  }
  return candidate
}

export function parseMapRoutes(raw: unknown): MapPlannedRoute[] {
  if (!Array.isArray(raw)) return []
  const out: MapPlannedRoute[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const routeId = typeof o.routeId === 'string' ? o.routeId.trim() : ''
    const displayName = typeof o.displayName === 'string' ? o.displayName.trim() : ''
    if (!routeId || !displayName) continue
    const stationIds = Array.isArray(o.stationIds)
      ? o.stationIds
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
      : []
    const { avgTravelTimeSeconds, minTravelTimeSeconds } = resolveRouteTravelTimesFromBody(o)
    out.push({
      routeId,
      displayName,
      stationIds,
      ...(avgTravelTimeSeconds != null ? { avgTravelTimeSeconds } : {}),
      ...(minTravelTimeSeconds != null ? { minTravelTimeSeconds } : {}),
      ...(typeof o.createdAt === 'string' ? { createdAt: o.createdAt } : {}),
      ...(typeof o.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}),
    })
  }
  return out
}

export function resolveDockingPointNodeMapPx(
  areas: MapAreaObject[],
  areaId: string,
  facilityId: string,
): { x: number; y: number } | null {
  const area = areas.find((a) => a.id === areaId)
  if (!area) return null
  const facility = area.facilities.find((f) => f.id === facilityId)
  if (!facility || facility.type !== 'DockingPoint') return null

  const domainSpan = {
    w: domainWidthM(area.domain),
    h: domainHeightM(area.domain),
  }
  const { css, areaSize } = resolveFacilityRenderPlacement(
    facility,
    area.domain,
    area.layout,
    domainSpan,
  )
  return {
    x: area.layout.xPx + css.left + areaSize.w / 2,
    y: area.layout.yPx + css.top + areaSize.h / 2,
  }
}

export function resolveRouteStationPoints(
  areas: MapAreaObject[],
  stationIds: string[],
): RouteStationPoint[] {
  const stations = collectStationsFromAreas(areas)
  const byId = new Map(stations.map((s) => [s.stationId, s]))
  const out: RouteStationPoint[] = []
  for (const stationId of stationIds) {
    const station = byId.get(stationId)
    if (!station) continue
    const px = resolveDockingPointNodeMapPx(
      areas,
      station.areaId,
      station.facilityId,
    )
    if (!px) continue
    out.push({
      stationId,
      stationName: station.stationName,
      x: px.x,
      y: px.y,
    })
  }
  return out
}

export function stationDisplayLabel(
  areas: MapAreaObject[],
  stationId: string,
): string {
  const station = collectStationsFromAreas(areas).find((s) => s.stationId === stationId)
  return station?.stationName || stationId
}

/** 路線路徑中點（圖台 px），供時間標籤定位 */
export function resolveRoutePathMidpointPx(
  pathPx: Array<{ x: number; y: number }>,
): { x: number; y: number } | null {
  if (pathPx.length === 0) return null
  if (pathPx.length === 1) return pathPx[0] ?? null

  const cumLen: number[] = [0]
  for (let i = 0; i < pathPx.length - 1; i++) {
    const a = pathPx[i]!
    const b = pathPx[i + 1]!
    cumLen.push(cumLen[i]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const totalLen = cumLen[cumLen.length - 1]!
  if (totalLen <= 0) return pathPx[Math.floor(pathPx.length / 2)] ?? null

  const half = totalLen / 2
  let segIdx = 0
  while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1]! < half) segIdx++
  const segStart = cumLen[segIdx]!
  const segEnd = cumLen[segIdx + 1]!
  const segLen = segEnd - segStart
  if (segLen <= 0.001) return pathPx[segIdx] ?? null
  const t = (half - segStart) / segLen
  const a = pathPx[segIdx]!
  const b = pathPx[segIdx + 1]!
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}
