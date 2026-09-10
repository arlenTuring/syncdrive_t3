import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import {
  areaPositionToCssTopLeft,
  domainHeightM,
  domainWidthM,
  meterToAreaLocalPx,
} from './areaCoords'
import { resolveFacilityRenderPlacement } from './facilityAreaCoords'
import { collectStationsFromAreas } from './dockingPointStationId'
import {
  getFacilityDockingPoint,
  resolveFacilityDockingPointListTitle,
} from './facilityDockingPoint'
import { parseFacilityIdFromFacilityDockingTopologyNodeId } from './pointTopology'
import { fieldPositionToFacilityAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import {
  collectCrossoverPortalWaypointsFromAreas,
  collectCrossPortalWaypointsFromAreas,
  collectWaypointsFromAreas,
} from './waypointCode'
import { resolveWaypointDisplayName } from './waypointFacility'
import {
  parseCrossoverPortalTopologyNodeId,
  getCrossoverPortals,
  resolveCrossoverPortalDisplayName,
} from './trackCrossoverFacility'
import {
  getCrossPortals,
  parseCrossPortalTopologyNodeId,
  resolveCrossPortalDisplayName,
  resolveCrossPortalFields,
} from './crossTrackPortals'

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
  // 行駛時間可選：特殊站序未必能由拓撲加總，仍允許先存路線
  if (draft.avgTravelTimeSeconds == null && draft.minTravelTimeSeconds == null) {
    return true
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

function parseMapRoutePathWaypoints(raw: unknown): MapPlannedRoute['pathWaypoints'] {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<MapPlannedRoute['pathWaypoints']> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const px = typeof o.px === 'number' && Number.isFinite(o.px) ? o.px : null
    const py = typeof o.py === 'number' && Number.isFinite(o.py) ? o.py : null
    if (px == null || py == null) continue
    const x = typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : undefined
    const y = typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : undefined
    const stationId =
      typeof o.stationId === 'string' && o.stationId.trim().length > 0
        ? o.stationId.trim()
        : undefined
    out.push({
      px,
      py,
      ...(x != null ? { x } : {}),
      ...(y != null ? { y } : {}),
      ...(stationId ? { stationId } : {}),
    })
  }
  return out.length >= 2 ? out : undefined
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
    const pathWaypoints = parseMapRoutePathWaypoints(o.pathWaypoints)
    out.push({
      routeId,
      displayName,
      stationIds,
      ...(pathWaypoints ? { pathWaypoints } : {}),
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

/** 設施停靠點（fdock:<facilityId>）→ 圖台 px */
export function resolveFacilityDockingRouteStopMapPx(
  areas: MapAreaObject[],
  stationId: string,
): { x: number; y: number; stationName: string; xM: number; yM: number } | null {
  const facilityId = parseFacilityIdFromFacilityDockingTopologyNodeId(stationId)
  if (!facilityId) return null
  for (const area of areas) {
    const facility = area.facilities.find((f) => f.id === facilityId)
    if (facility?.type !== 'Facility') continue
    const dock = getFacilityDockingPoint(facility)
    if (!dock) continue
    // fieldPositionToFacilityAreaLocal 回傳區域座標（左下原點），須轉成 CSS 左上再加 Area 外框
    const local = fieldPositionToFacilityAreaLocal(
      dock.xM,
      dock.yM,
      facility,
      area,
      { extrapolate: false },
    )
    if (!local) continue
    const css = areaPositionToCssTopLeft(local, { w: 0, h: 0 }, area.layout.hPx)
    return {
      x: area.layout.xPx + css.left,
      y: area.layout.yPx + css.top,
      stationName: resolveFacilityDockingPointListTitle(facility),
      xM: dock.xM,
      yM: dock.yM,
    }
  }
  return null
}

/** 虛擬渡線端點途經點（waypointCode 或 xowp:…）→ 圖台 px */
export function resolveCrossoverPortalRouteStopMapPx(
  areas: MapAreaObject[],
  stationId: string,
): { x: number; y: number; stationName: string; xM: number; yM: number } | null {
  const trimmed = stationId.trim()
  if (!trimmed) return null

  const byCode = collectCrossoverPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === trimmed || s.topologyNodeId === trimmed,
  )
  const ref = byCode
    ? { facilityId: byCode.facilityId, key: byCode.portalKey }
    : parseCrossoverPortalTopologyNodeId(trimmed)
  if (!ref) return null

  for (const area of areas) {
    const facility = area.facilities.find((f) => f.id === ref.facilityId)
    if (facility?.type !== 'TrackCrossover') continue
    const portals = getCrossoverPortals(facility)
    const portal = portals?.[ref.key]
    if (!portal) continue
    // portal.xM/yM 已是場域公尺；用 Area 座標系換算。
    // 不可走 fieldPositionToFacilityAreaLocal：虛擬渡線通常沒有參照場域範圍，會整段找不到畫面站位。
    const areaLocal = meterToAreaLocalPx(
      portal.xM,
      portal.yM,
      area.domain,
      area.layout,
    )
    const css = areaPositionToCssTopLeft(areaLocal, { w: 0, h: 0 }, area.layout.hPx)
    return {
      x: area.layout.xPx + css.left,
      y: area.layout.yPx + css.top,
      stationName: byCode?.stationName ?? resolveCrossoverPortalDisplayName(portal),
      xM: portal.xM,
      yM: portal.yM,
    }
  }
  return null
}

/** 交叉軌道四口途經點（waypointCode 或 xcwp:…）→ 圖台 px */
export function resolveCrossPortalRouteStopMapPx(
  areas: MapAreaObject[],
  stationId: string,
): { x: number; y: number; stationName: string; xM: number; yM: number } | null {
  const trimmed = stationId.trim()
  if (!trimmed) return null

  const byCode = collectCrossPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === trimmed || s.topologyNodeId === trimmed,
  )
  const ref = byCode
    ? { facilityId: byCode.facilityId, key: byCode.portalKey }
    : parseCrossPortalTopologyNodeId(trimmed)
  if (!ref) return null

  for (const area of areas) {
    const facility = area.facilities.find((f) => f.id === ref.facilityId)
    if (facility?.type !== 'Track' || facility.name !== 'RailCross') continue
    const portals = getCrossPortals(facility)
    const portal = portals[ref.key]
    if (!portal) continue
    const fields = resolveCrossPortalFields(facility, area)
    const field = fields[ref.key]
    if (field.xM == null || field.yM == null) continue
    const areaLocal = meterToAreaLocalPx(
      field.xM,
      field.yM,
      area.domain,
      area.layout,
    )
    const css = areaPositionToCssTopLeft(areaLocal, { w: 0, h: 0 }, area.layout.hPx)
    return {
      x: area.layout.xPx + css.left,
      y: area.layout.yPx + css.top,
      stationName: byCode?.stationName ?? resolveCrossPortalDisplayName(portal),
      xM: field.xM,
      yM: field.yM,
    }
  }
  return null
}

export function resolveRouteStationPoints(
  areas: MapAreaObject[],
  stationIds: string[],
): RouteStationPoint[] {
  const stations = collectStationsFromAreas(areas)
  const byId = new Map(stations.map((s) => [s.stationId, s]))
  const waypoints = collectWaypointsFromAreas(areas)
  const waypointById = new Map(waypoints.map((s) => [s.stationId, s]))
  const out: RouteStationPoint[] = []
  for (const stationId of stationIds) {
    const fdock = resolveFacilityDockingRouteStopMapPx(areas, stationId)
    if (fdock) {
      out.push({
        stationId,
        stationName: fdock.stationName,
        x: fdock.x,
        y: fdock.y,
      })
      continue
    }

    const crossover = resolveCrossoverPortalRouteStopMapPx(areas, stationId)
    if (crossover) {
      out.push({
        stationId,
        stationName: crossover.stationName,
        x: crossover.x,
        y: crossover.y,
      })
      continue
    }

    const cross = resolveCrossPortalRouteStopMapPx(areas, stationId)
    if (cross) {
      out.push({
        stationId,
        stationName: cross.stationName,
        x: cross.x,
        y: cross.y,
      })
      continue
    }

    const waypoint =
      waypointById.get(stationId)
      ?? waypoints.find((s) => s.facilityId === stationId)
    if (waypoint) {
      const area = areas.find((a) => a.id === waypoint.areaId)
      const facility = area?.facilities.find((f) => f.id === waypoint.facilityId)
      if (area && facility) {
        const { css, areaSize } = resolveFacilityRenderPlacement(
          facility,
          area.domain,
          area.layout,
        )
        out.push({
          stationId,
          stationName: waypoint.stationName,
          x: area.layout.xPx + css.left + areaSize.w / 2,
          y: area.layout.yPx + css.top + areaSize.h / 2,
        })
        continue
      }
      // 途經點資料在但算不出畫面座標：仍占位，避免站序與編號錯位
      out.push({
        stationId,
        stationName: waypoint.stationName,
        x: Number.NaN,
        y: Number.NaN,
      })
      continue
    }

    const station = byId.get(stationId)
    if (!station) {
      out.push({
        stationId,
        stationName: stationId,
        x: Number.NaN,
        y: Number.NaN,
      })
      continue
    }
    const px = resolveDockingPointNodeMapPx(
      areas,
      station.areaId,
      station.facilityId,
    )
    if (!px) {
      out.push({
        stationId,
        stationName: station.stationName,
        x: Number.NaN,
        y: Number.NaN,
      })
      continue
    }
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
  const fdockFacilityId = parseFacilityIdFromFacilityDockingTopologyNodeId(stationId)
  if (fdockFacilityId) {
    for (const area of areas) {
      const facility = area.facilities.find((f) => f.id === fdockFacilityId)
      if (facility?.type === 'Facility' && getFacilityDockingPoint(facility)) {
        return resolveFacilityDockingPointListTitle(facility)
      }
    }
  }

  const crossover = collectCrossoverPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.topologyNodeId === stationId,
  )
  if (crossover) return crossover.stationName

  const crossoverPx = resolveCrossoverPortalRouteStopMapPx(areas, stationId)
  if (crossoverPx) return crossoverPx.stationName

  const cross = collectCrossPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.topologyNodeId === stationId,
  )
  if (cross) return cross.stationName

  const crossPx = resolveCrossPortalRouteStopMapPx(areas, stationId)
  if (crossPx) return crossPx.stationName

  const waypoint = collectWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.facilityId === stationId,
  )
  if (waypoint) return waypoint.stationName

  for (const area of areas) {
    const facility = area.facilities.find((f) => f.id === stationId && f.type === 'Waypoint')
    if (facility) return resolveWaypointDisplayName(facility)
  }

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
