/**
 * 模擬路線折點編輯：預設路徑、吸附目標、像素↔場域換算。
 *
 * 行為對齊 syncdrive_t3_simulator 的 RoutePathApp，資料寫回 MapPlannedRoute.pathWaypoints。
 */

import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute, MapRoutePathWaypoint } from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import type {
  EditPoint,
  SnapSegment,
  SnapTargets,
} from '../components/SimRoutePathOverlay'
import {
  areaPositionToCssTopLeft,
  domainHeightM,
  domainWidthM,
  meterToAreaLocalPx,
} from './areaCoords'
import { fieldPositionFromArea } from './facilityAreaCoords'
import { resolveFacilityRenderPlacement } from './facilityAreaCoords'
import { resolveCrossPortalFields } from './crossTrackPortals'
import { resolveRoutePreviewGeometry } from './routeTrackPath'
import {
  resolveFacilityDockingRouteStopMapPx,
  resolveCrossoverPortalRouteStopMapPx,
  resolveRouteStationPoints,
  stationDisplayLabel,
} from './routePlanning'

function fieldMetersToMapPx(
  areas: MapAreaObject[],
  areaId: string,
  xM: number,
  yM: number,
): { px: number; py: number } | null {
  const area = areas.find((a) => a.id === areaId)
  if (!area) return null
  const areaLocal = meterToAreaLocalPx(xM, yM, area.domain, area.layout)
  const css = areaPositionToCssTopLeft(areaLocal, { w: 0, h: 0 }, area.layout.hPx)
  return {
    px: area.layout.xPx + css.left,
    py: area.layout.yPx + css.top,
  }
}

function resolveStopWithMeters(
  areas: MapAreaObject[],
  stationId: string,
): { x: number; y: number; stationName: string; xM?: number; yM?: number } | null {
  const fdock = resolveFacilityDockingRouteStopMapPx(areas, stationId)
  if (fdock) return fdock
  const crossover = resolveCrossoverPortalRouteStopMapPx(areas, stationId)
  if (crossover) return crossover
  const points = resolveRouteStationPoints(areas, [stationId])
  const p = points[0]
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  return { x: p.x, y: p.y, stationName: p.stationName }
}

/**
 * 站序 → 可編輯折點。
 * 預設只放路線上既有的實體站點／途經點／停靠點；虛擬折點由使用者手動加，不要自動從軌道路徑塞一堆。
 */
export function buildDefaultSimRouteEditPoints(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null | undefined,
  route: Pick<MapPlannedRoute, 'stationIds'>,
): EditPoint[] {
  const ids = route.stationIds
  if (ids.length < 2) return []

  const stations = resolveRouteStationPoints(areas, ids)
  const points: EditPoint[] = []

  for (let i = 0; i < stations.length; i += 1) {
    const s = stations[i]!
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
    const point: EditPoint = {
      px: s.x,
      py: s.y,
      stationId: s.stationId,
      name: s.stationName || stationDisplayLabel(areas, s.stationId),
    }
    if (i < stations.length - 1) {
      const geometry = resolveRoutePreviewGeometry(
        areas,
        [ids[i]!, ids[i + 1]!],
        pointTopology,
      )
      if (!geometry.followsTracks) point.brokenAhead = true
    }
    points.push(point)
  }
  return points
}

/** 舊版誤把軌道路徑折角當虛擬折點寫入；用來辨識並清掉 */
function legacyAutoBendPixels(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null | undefined,
  stationIds: string[],
): Array<{ px: number; py: number }> {
  const keepCorners = (
    points: Array<{ x: number; y: number }>,
    minTurnDeg = 4,
  ): Array<{ x: number; y: number }> => {
    if (points.length <= 2) return points.map((p) => ({ ...p }))
    const out = [{ ...points[0]! }]
    for (let i = 1; i < points.length - 1; i += 1) {
      const a = out[out.length - 1]!
      const b = points[i]!
      const c = points[i + 1]!
      const inAngle = Math.atan2(b.y - a.y, b.x - a.x)
      const outAngle = Math.atan2(c.y - b.y, c.x - b.x)
      let turn = Math.abs((outAngle - inAngle) * (180 / Math.PI)) % 360
      if (turn > 180) turn = 360 - turn
      if (turn >= minTurnDeg) out.push({ ...b })
    }
    out.push({ ...points[points.length - 1]! })
    return out
  }

  const out: Array<{ px: number; py: number }> = []
  for (let i = 0; i < stationIds.length - 1; i += 1) {
    const geometry = resolveRoutePreviewGeometry(
      areas,
      [stationIds[i]!, stationIds[i + 1]!],
      pointTopology,
    )
    const leg = geometry.pathLegs?.[0] ?? geometry.pathPx
    if (!leg || leg.length <= 2) continue
    for (const p of keepCorners(leg).slice(1, -1)) {
      out.push({ px: p.x, py: p.y })
    }
  }
  return out
}

/** 已存折點是否幾乎全是舊版自動塞的軌道路徑折角 */
export function isLegacyAutoPathWaypoints(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null | undefined,
  route: MapPlannedRoute,
): boolean {
  const wps = route.pathWaypoints
  if (!wps || wps.length < 2) return false
  const bends = wps.filter((w) => !w.stationId)
  if (bends.length === 0) return false
  const auto = legacyAutoBendPixels(areas, pointTopology, route.stationIds)
  if (auto.length === 0) return false
  const matched = bends.filter((w) =>
    auto.some((a) => Math.hypot(a.px - w.px, a.py - w.py) <= 4),
  ).length
  return matched >= Math.max(1, Math.ceil(bends.length * 0.8))
}

/** 已存 pathWaypoints → 編輯點 */
export function editPointsFromPathWaypoints(
  areas: MapAreaObject[],
  waypoints: MapRoutePathWaypoint[],
): EditPoint[] {
  return waypoints
    .filter((w) => Number.isFinite(w.px) && Number.isFinite(w.py))
    .map((w) => ({
      px: w.px,
      py: w.py,
      ...(w.stationId
        ? {
            stationId: w.stationId,
            name: stationDisplayLabel(areas, w.stationId),
          }
        : {}),
    }))
}

export type FieldBox = {
  id: string
  type: string
  code: string
  x: number
  y: number
  w: number
  h: number
  areaId: string
  facilityId: string
}

/** 圖台像素上的軌道方塊與渡線，供吸附／落點檢查 */
export function collectSimRouteFieldTargets(areas: MapAreaObject[]): {
  boxes: FieldBox[]
  crossovers: Array<{
    id: string
    code: string
    a: { px: number; py: number }
    b: { px: number; py: number }
  }>
} {
  const boxes: FieldBox[] = []
  const crossovers: Array<{
    id: string
    code: string
    a: { px: number; py: number }
    b: { px: number; py: number }
  }> = []

  for (const area of areas) {
    const domainSpan = {
      w: domainWidthM(area.domain),
      h: domainHeightM(area.domain),
    }
    for (const f of area.facilities) {
      if (f.type !== 'Track' && f.type !== 'TrackCrossover') continue
      const { css, areaSize } = resolveFacilityRenderPlacement(
        f,
        area.domain,
        area.layout,
        domainSpan,
      )
      const x = area.layout.xPx + css.left
      const y = area.layout.yPx + css.top
      const w = areaSize.w
      const h = areaSize.h
      if (f.type === 'Track') {
        boxes.push({
          id: f.id,
          type: 'Track',
          code: f.customName || f.id,
          x,
          y,
          w,
          h,
          areaId: area.id,
          facilityId: f.id,
        })
      }
      if (f.type === 'TrackCrossover') {
        const fields = resolveCrossPortalFields(f, area)
        const pushSeg = (
          id: string,
          aM: { xM: number | null; yM: number | null },
          bM: { xM: number | null; yM: number | null },
        ) => {
          if (
            aM.xM == null ||
            aM.yM == null ||
            bM.xM == null ||
            bM.yM == null
          ) {
            return
          }
          const a = fieldMetersToMapPx(areas, area.id, aM.xM, aM.yM)
          const b = fieldMetersToMapPx(areas, area.id, bM.xM, bM.yM)
          if (!a || !b) return
          crossovers.push({
            id,
            code: f.customName || f.id,
            a,
            b,
          })
        }
        // 渡線兩條對角：lt↔rb、rt↔lb
        pushSeg(`${f.id}-lt-rb`, fields.lt, fields.rb)
        pushSeg(`${f.id}-rt-lb`, fields.rt, fields.lb)
      }
    }
  }
  return { boxes, crossovers }
}

export function buildSimRouteSnapTargets(areas: MapAreaObject[]): SnapTargets {
  const { boxes, crossovers } = collectSimRouteFieldTargets(areas)
  const verticals: SnapTargets['verticals'] = []
  const horizontals: SnapTargets['horizontals'] = []
  for (const box of boxes) {
    if (box.w >= box.h) {
      horizontals.push({
        value: box.y + box.h / 2,
        from: box.x,
        to: box.x + box.w,
        slack: box.h,
        label: box.code || box.id,
        kind: 'track',
      })
    } else {
      verticals.push({
        value: box.x + box.w / 2,
        from: box.y,
        to: box.y + box.h,
        slack: box.w,
        label: box.code || box.id,
        kind: 'track',
      })
    }
  }
  const segments: SnapSegment[] = crossovers.map((xo) => ({
    ax: xo.a.px,
    ay: xo.a.py,
    bx: xo.b.px,
    by: xo.b.py,
    label: xo.code || xo.id,
  }))
  return { verticals, horizontals, segments }
}

export function isSimRoutePointOnField(
  areas: MapAreaObject[],
  p: { x: number; y: number },
): boolean {
  const { boxes, crossovers } = collectSimRouteFieldTargets(areas)
  if (
    boxes.some(
      (f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h,
    )
  ) {
    return true
  }
  return crossovers.some((xo) => {
    const dx = xo.b.px - xo.a.px
    const dy = xo.b.py - xo.a.py
    const lenSq = dx * dx + dy * dy
    if (lenSq <= 0) return false
    const t = Math.max(
      0,
      Math.min(1, ((p.x - xo.a.px) * dx + (p.y - xo.a.py) * dy) / lenSq),
    )
    return (
      Math.hypot(p.x - (xo.a.px + dx * t), p.y - (xo.a.py + dy * t)) <= 24
    )
  })
}

/** 編輯點 → 可寫入地圖檔的 pathWaypoints（盡量附場域公尺） */
export function editPointsToPathWaypoints(
  areas: MapAreaObject[],
  points: EditPoint[],
): MapRoutePathWaypoint[] {
  const { boxes } = collectSimRouteFieldTargets(areas)
  return points.map((p) => {
    let x: number | undefined
    let y: number | undefined
    if (p.stationId) {
      const stop = resolveStopWithMeters(areas, p.stationId)
      if (
        stop &&
        typeof stop.xM === 'number' &&
        typeof stop.yM === 'number' &&
        Number.isFinite(stop.xM) &&
        Number.isFinite(stop.yM)
      ) {
        x = Number(stop.xM.toFixed(2))
        y = Number(stop.yM.toFixed(2))
      }
    } else {
      const hit = boxes.find(
        (b) =>
          p.px >= b.x &&
          p.px <= b.x + b.w &&
          p.py >= b.y &&
          p.py <= b.y + b.h,
      )
      if (hit) {
        const area = areas.find((a) => a.id === hit.areaId)
        if (area) {
          const areaLocal = {
            x: Math.min(area.layout.wPx, Math.max(0, p.px - area.layout.xPx)),
            y: Math.min(
              area.layout.hPx,
              Math.max(0, area.layout.yPx + area.layout.hPx - p.py),
            ),
          }
          const meters = fieldPositionFromArea(
            areaLocal,
            area.domain,
            area.layout,
          )
          x = Number(meters.x.toFixed(2))
          y = Number(meters.y.toFixed(2))
        }
      }
    }
    return {
      px: Number(p.px.toFixed(2)),
      py: Number(p.py.toFixed(2)),
      ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      ...(p.stationId ? { stationId: p.stationId } : {}),
    }
  })
}

export function startSimRouteEditPoints(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null | undefined,
  route: MapPlannedRoute,
): EditPoint[] {
  const defaults = buildDefaultSimRouteEditPoints(
    areas,
    pointTopology,
    route,
  )
  const wps = route.pathWaypoints
  if (!wps || wps.length < 2) return defaults

  // 只有站點、沒有手動虛擬折點 → 不當成自訂路徑
  if (!wps.some((w) => !w.stationId)) return defaults

  // 舊版自動塞的軌道路徑折角 → 丟掉，改回只留站點
  if (isLegacyAutoPathWaypoints(areas, pointTopology, route)) {
    return defaults
  }

  return editPointsFromPathWaypoints(areas, wps)
}

/** 有自訂虛擬折點時，優先用其繪製路線；僅站點或舊版自動折角則退回拓撲／軌道幾何 */
export function geometryFromPathWaypoints(
  areas: MapAreaObject[],
  route: MapPlannedRoute,
  pointTopology?: PointTopology | null,
): {
  stations: Array<{
    stationId: string
    stationName: string
    x: number
    y: number
  }>
  pathPx: Array<{ x: number; y: number }>
  pathLegs: Array<Array<{ x: number; y: number }>>
  brokenLegs: Array<Array<{ x: number; y: number }>>
} | null {
  const wps = route.pathWaypoints
  if (!wps || wps.length < 2) return null
  // 沒有虛擬折點就不覆寫預設沿軌道繪製
  if (!wps.some((w) => !w.stationId)) return null
  if (isLegacyAutoPathWaypoints(areas, pointTopology, route)) return null
  const pathPx = wps
    .filter((w) => Number.isFinite(w.px) && Number.isFinite(w.py))
    .map((w) => ({ x: w.px, y: w.py }))
  if (pathPx.length < 2) return null
  const stations = wps
    .filter((w) => w.stationId && Number.isFinite(w.px) && Number.isFinite(w.py))
    .map((w) => ({
      stationId: w.stationId!,
      stationName: stationDisplayLabel(areas, w.stationId!),
      x: w.px,
      y: w.py,
    }))
  return {
    stations:
      stations.length > 0
        ? stations
        : resolveRouteStationPoints(areas, route.stationIds),
    pathPx,
    pathLegs: [pathPx],
    brokenLegs: [],
  }
}
