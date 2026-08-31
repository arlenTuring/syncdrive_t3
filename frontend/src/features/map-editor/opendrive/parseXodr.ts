import {
  type ArcGeometry,
  type LineGeometry,
  type RoadGeometry,
  sampleReferenceLine,
} from './geometry'
import {
  buildLanePolygonsForRoad,
  mergeOpenDrivePlan,
  type RoadLaneSection,
} from './lanePolygons'
import type { OpenDrivePlan, ParsedLane, WidthPoly } from './types'

function parseFloatAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name)
  if (raw == null) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function parseWidths(laneEl: Element): WidthPoly[] {
  return Array.from(laneEl.querySelectorAll(':scope > width')).map((w) => ({
    sOffset: parseFloatAttr(w, 'sOffset'),
    a: parseFloatAttr(w, 'a'),
    b: parseFloatAttr(w, 'b'),
    c: parseFloatAttr(w, 'c'),
    d: parseFloatAttr(w, 'd'),
  }))
}

function parseLane(laneEl: Element): ParsedLane {
  const mmsl = laneEl.querySelector(':scope > userData[code="mmslLaneId"]')
  return {
    id: Number.parseInt(laneEl.getAttribute('id') ?? '0', 10),
    type: laneEl.getAttribute('type') ?? 'unknown',
    mmslLaneId: mmsl?.getAttribute('value') ?? null,
    widths: parseWidths(laneEl),
  }
}

function parseLaneSection(sectionEl: Element): RoadLaneSection {
  const lanes: ParsedLane[] = []
  for (const side of ['left', 'center', 'right']) {
    const container = sectionEl.querySelector(`:scope > ${side}`)
    if (!container) continue
    for (const laneEl of Array.from(container.querySelectorAll(':scope > lane'))) {
      lanes.push(parseLane(laneEl))
    }
  }
  return {
    s: parseFloatAttr(sectionEl, 's'),
    lanes,
  }
}

function parsePlanView(roadEl: Element): RoadGeometry[] {
  const geometries: RoadGeometry[] = []
  for (const geomEl of Array.from(roadEl.querySelectorAll(':scope > planView > geometry'))) {
    const base = {
      s: parseFloatAttr(geomEl, 's'),
      x: parseFloatAttr(geomEl, 'x'),
      y: parseFloatAttr(geomEl, 'y'),
      hdg: parseFloatAttr(geomEl, 'hdg'),
      length: parseFloatAttr(geomEl, 'length'),
    }
    if (geomEl.querySelector(':scope > line')) {
      geometries.push({ kind: 'line', ...base } satisfies LineGeometry)
      continue
    }
    const arc = geomEl.querySelector(':scope > arc')
    if (arc) {
      geometries.push({
        kind: 'arc',
        ...base,
        curvature: parseFloatAttr(arc, 'curvature'),
      } satisfies ArcGeometry)
      continue
    }
    // spiral / paramPoly3: approximate as line for now
    geometries.push({ kind: 'line', ...base } satisfies LineGeometry)
  }
  return geometries
}

export type ParseOpenDriveOptions = {
  sampleStepM?: number
}

export function parseOpenDriveXodr(
  xml: string,
  options: ParseOpenDriveOptions = {},
): OpenDrivePlan {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('OpenDRIVE XML 解析失敗')
  }

  const root = doc.querySelector('OpenDRIVE')
  if (!root) {
    throw new Error('找不到 OpenDRIVE 根節點')
  }

  const stepM = options.sampleStepM ?? 0.75
  const roadEls = Array.from(root.querySelectorAll(':scope > road'))
  const roadPolygons = roadEls.map((roadEl) => {
    const roadId = roadEl.getAttribute('id') ?? '?'
    const geometries = parsePlanView(roadEl)
    const refLine = sampleReferenceLine(geometries, stepM)
    const sections = Array.from(roadEl.querySelectorAll(':scope > lanes > laneSection')).map(
      parseLaneSection,
    )
    return buildLanePolygonsForRoad(roadId, sections, refLine)
  })

  return mergeOpenDrivePlan(roadPolygons, roadEls.length)
}
