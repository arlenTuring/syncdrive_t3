import { offsetFromReference } from './geometry'
import { evalWidthPoly } from './laneWidth'
import type {
  OpenDriveBounds,
  OpenDriveLanePolygon,
  OpenDrivePlan,
  OpenDrivePoint,
  ParsedLane,
  RefSample,
} from './types'

const DEFAULT_MARGIN_M = 2

export type RoadLaneSection = {
  s: number
  lanes: ParsedLane[]
}

export function buildLanePolygonsForRoad(
  roadId: string,
  sections: RoadLaneSection[],
  refLine: RefSample[],
): OpenDriveLanePolygon[] {
  if (refLine.length < 2 || sections.length === 0) return []

  const polygons: OpenDriveLanePolygon[] = []

  for (const section of sections) {
    const sectionEndS =
      sections.find((s) => s.s > section.s)?.s ?? refLine[refLine.length - 1]!.s + 1e-6
    const sectionSamples = refLine.filter(
      (p) => p.s >= section.s - 1e-6 && p.s <= sectionEndS + 1e-6,
    )
    if (sectionSamples.length < 2) continue

    const positive = section.lanes
      .filter((l) => l.id > 0)
      .sort((a, b) => a.id - b.id)
    const negative = section.lanes
      .filter((l) => l.id < 0)
      .sort((a, b) => b.id - a.id)

    for (const lane of [...positive, ...negative]) {
      if (lane.id === 0 || lane.type === 'none') continue
      const poly = buildLanePolygon(
        roadId,
        lane,
        section.s,
        sectionSamples,
        positive,
        negative,
      )
      if (poly) polygons.push(poly)
    }
  }

  return polygons
}

function buildLanePolygon(
  roadId: string,
  lane: ParsedLane,
  sectionS: number,
  samples: RefSample[],
  positive: ParsedLane[],
  negative: ParsedLane[],
): OpenDriveLanePolygon | null {
  const inner: OpenDrivePoint[] = []
  const outer: OpenDrivePoint[] = []

  for (const sample of samples) {
    const { tInner, tOuter } = laneOffsetsAt(
      lane,
      sectionS,
      sample.s,
      positive,
      negative,
    )
    if (!Number.isFinite(tInner) || !Number.isFinite(tOuter)) continue
    inner.push(offsetFromReference(sample.x, sample.y, sample.hdg, tInner))
    outer.push(offsetFromReference(sample.x, sample.y, sample.hdg, tOuter))
  }

  if (inner.length < 2 || outer.length < 2) return null

  const points = [...inner, ...outer.reverse()]
  if (polygonArea(points) < 0.01) return null

  return {
    roadId,
    laneId: String(lane.id),
    laneType: lane.type,
    mmslLaneId: lane.mmslLaneId,
    points,
  }
}

function laneOffsetsAt(
  lane: ParsedLane,
  sectionS: number,
  roadS: number,
  positive: ParsedLane[],
  negative: ParsedLane[],
): { tInner: number; tOuter: number } {
  if (lane.id > 0) {
    let tInner = 0
    for (const left of positive) {
      if (left.id >= lane.id) break
      tInner += evalWidthPoly(left.widths, sectionS, roadS)
    }
    const w = evalWidthPoly(lane.widths, sectionS, roadS)
    return { tInner, tOuter: tInner + w }
  }

  let tInner = 0
  for (const right of negative) {
    if (right.id <= lane.id) break
    tInner -= evalWidthPoly(right.widths, sectionS, roadS)
  }
  const w = evalWidthPoly(lane.widths, sectionS, roadS)
  return { tInner, tOuter: tInner - w }
}

function polygonArea(points: OpenDrivePoint[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function boundsFromPolygons(
  lanes: OpenDriveLanePolygon[],
  marginM = DEFAULT_MARGIN_M,
): OpenDriveBounds {
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity

  for (const lane of lanes) {
    for (const p of lane.points) {
      xmin = Math.min(xmin, p.x)
      ymin = Math.min(ymin, p.y)
      xmax = Math.max(xmax, p.x)
      ymax = Math.max(ymax, p.y)
    }
  }

  if (!Number.isFinite(xmin)) {
    return { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }
  }

  return {
    xmin: xmin - marginM,
    ymin: ymin - marginM,
    xmax: xmax + marginM,
    ymax: ymax + marginM,
  }
}

export function mergeOpenDrivePlan(
  roadPlans: OpenDriveLanePolygon[][],
  roadCount: number,
): OpenDrivePlan {
  const lanes = roadPlans.flat()
  return {
    bounds: boundsFromPolygons(lanes),
    lanes,
    roadCount,
    laneCount: lanes.length,
  }
}

export function laneFillColor(laneType: string): string {
  switch (laneType) {
    case 'driving':
      return '#4b5563'
    case 'median':
      return '#3f6212'
    case 'shoulder':
      return '#52525b'
    case 'border':
      return '#3f3f46'
    default:
      return '#374151'
  }
}

export function laneStrokeColor(laneType: string): string {
  switch (laneType) {
    case 'driving':
      return '#9ca3af'
    case 'median':
      return '#84cc16'
    default:
      return '#71717a'
  }
}

export function worldToBasemapLocal(
  x: number,
  y: number,
  bounds: OpenDriveBounds,
  widthPx: number,
  heightPx: number,
): OpenDrivePoint {
  const w = Math.max(1e-6, bounds.xmax - bounds.xmin)
  const h = Math.max(1e-6, bounds.ymax - bounds.ymin)
  return {
    x: ((x - bounds.xmin) / w) * widthPx,
    y: ((bounds.ymax - y) / h) * heightPx,
  }
}

export function lanePolygonToSvgPath(
  points: OpenDrivePoint[],
  bounds: OpenDriveBounds,
  widthPx: number,
  heightPx: number,
): string {
  if (points.length === 0) return ''
  const first = worldToBasemapLocal(points[0]!.x, points[0]!.y, bounds, widthPx, heightPx)
  const parts = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`]
  for (let i = 1; i < points.length; i++) {
    const p = worldToBasemapLocal(points[i]!.x, points[i]!.y, bounds, widthPx, heightPx)
    parts.push(`L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}
