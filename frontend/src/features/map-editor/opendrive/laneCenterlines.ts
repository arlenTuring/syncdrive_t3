import { evalGeometryAt, offsetFromReference, sampleReferenceLine, type RoadGeometry } from './geometry'
import { evalWidthPoly } from './laneWidth'
import type { OpenDriveBounds, OpenDrivePoint, ParsedLane, RefSample, WidthPoly } from './types'

/**
 * 車道中心線。
 *
 * 既有的 {@link parseOpenDriveXodr} 產出的是車道<strong>外框多邊形</strong>，適合上色，
 * 但軌道生成要的是每條車道的一條線——中心線，以及沿線的累積里程。兩者需要的東西
 * 不同，所以分開解析，不去動已經在用的那一支。
 */

export type LaneCenterline = {
  /** road id 與 lane id 組成的唯一鍵，例如 "8:-2" */
  key: string
  roadId: string
  laneId: number
  laneType: string
  mmslLaneId: string | null
  /** 是否位於 junction 內（渡線／連接道） */
  inJunction: boolean
  /** 中心線取樣點，已依<strong>行車方向</strong>排序 */
  points: OpenDrivePoint[]
  /** 與 points 等長的累積里程 */
  stations: number[]
  lengthM: number
}

export type LaneCenterlinePlan = {
  lanes: LaneCenterline[]
  bounds: OpenDriveBounds
  roadCount: number
  laneCount: number
}

function num(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name)
  if (raw == null) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function parseWidths(laneEl: Element): WidthPoly[] {
  return Array.from(laneEl.querySelectorAll(':scope > width')).map((w) => ({
    sOffset: num(w, 'sOffset'),
    a: num(w, 'a'),
    b: num(w, 'b'),
    c: num(w, 'c'),
    d: num(w, 'd'),
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

function parsePlanView(roadEl: Element): RoadGeometry[] {
  const out: RoadGeometry[] = []
  for (const geomEl of Array.from(roadEl.querySelectorAll(':scope > planView > geometry'))) {
    const base = {
      s: num(geomEl, 's'),
      x: num(geomEl, 'x'),
      y: num(geomEl, 'y'),
      hdg: num(geomEl, 'hdg'),
      length: num(geomEl, 'length'),
    }
    const arc = geomEl.querySelector(':scope > arc')
    if (arc) out.push({ kind: 'arc', ...base, curvature: num(arc, 'curvature') })
    else out.push({ kind: 'line', ...base })
  }
  return out
}

/**
 * 車道中心線相對參考線的橫向偏移。
 *
 * OpenDRIVE 的車道由內往外編號，寬度逐條累加，所以第 n 條的中心在
 * 「前 n−1 條寬度總和 ＋ 自己的一半」處。左側為正、右側為負。
 */
function lateralOffset(
  lane: ParsedLane,
  ordered: ParsedLane[],
  sectionS: number,
  roadS: number,
): number {
  const sign = lane.id > 0 ? 1 : -1
  let acc = 0
  for (const l of ordered) {
    const w = evalWidthPoly(l.widths, sectionS, roadS)
    if (l.id === lane.id) return sign * (acc + w / 2)
    acc += w
  }
  return sign * acc
}

export type ParseLaneCenterlinesOptions = {
  sampleStepM?: number
  /** 只取這些車道型別，預設只取 driving */
  laneTypes?: string[]
}

export function parseLaneCenterlines(
  xml: string,
  options: ParseLaneCenterlinesOptions = {},
): LaneCenterlinePlan {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('OpenDRIVE XML 解析失敗')
  const root = doc.querySelector('OpenDRIVE')
  if (!root) throw new Error('找不到 OpenDRIVE 根節點')

  const step = options.sampleStepM ?? 1
  const wanted = new Set(options.laneTypes ?? ['driving'])
  const roadEls = Array.from(root.querySelectorAll(':scope > road'))
  const lanes: LaneCenterline[] = []

  for (const roadEl of roadEls) {
    const roadId = roadEl.getAttribute('id') ?? '?'
    const inJunction = (roadEl.getAttribute('junction') ?? '-1') !== '-1'
    const refLine: RefSample[] = sampleReferenceLine(parsePlanView(roadEl), step)
    if (refLine.length < 2) continue

    const sectionEls = Array.from(roadEl.querySelectorAll(':scope > lanes > laneSection'))
    for (const sectionEl of sectionEls) {
      const sectionS = num(sectionEl, 's')
      const nextS =
        sectionEls
          .map((el) => num(el, 's'))
          .filter((s) => s > sectionS)
          .sort((a, b) => a - b)[0] ?? refLine[refLine.length - 1]!.s + 1e-6
      const samples = refLine.filter((p) => p.s >= sectionS - 1e-6 && p.s <= nextS + 1e-6)
      if (samples.length < 2) continue

      const all: ParsedLane[] = []
      for (const side of ['left', 'right']) {
        const container = sectionEl.querySelector(`:scope > ${side}`)
        if (!container) continue
        for (const laneEl of Array.from(container.querySelectorAll(':scope > lane'))) {
          all.push(parseLane(laneEl))
        }
      }
      const positive = all.filter((l) => l.id > 0).sort((a, b) => a.id - b.id)
      const negative = all.filter((l) => l.id < 0).sort((a, b) => b.id - a.id)

      for (const lane of all) {
        if (lane.id === 0 || !wanted.has(lane.type)) continue
        const ordered = lane.id > 0 ? positive : negative
        const points: OpenDrivePoint[] = samples.map((p) => {
          const t = lateralOffset(lane, ordered, sectionS, p.s)
          return offsetFromReference(p.x, p.y, p.hdg, t)
        })
        // 左側車道（正號）的行車方向與參考線相反，先轉正再算里程，
        // 否則串接時每一段的頭尾都會對不起來。
        const ordered2 = lane.id > 0 ? [...points].reverse() : points
        const stations: number[] = [0]
        for (let i = 1; i < ordered2.length; i += 1) {
          stations.push(
            stations[i - 1]! + Math.hypot(
              ordered2[i]!.x - ordered2[i - 1]!.x,
              ordered2[i]!.y - ordered2[i - 1]!.y,
            ),
          )
        }
        lanes.push({
          key: `${roadId}:${lane.id}`,
          roadId,
          laneId: lane.id,
          laneType: lane.type,
          mmslLaneId: lane.mmslLaneId,
          inJunction,
          points: ordered2,
          stations,
          lengthM: stations[stations.length - 1] ?? 0,
        })
      }
    }
  }

  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const lane of lanes) {
    for (const p of lane.points) {
      if (p.x < xmin) xmin = p.x
      if (p.y < ymin) ymin = p.y
      if (p.x > xmax) xmax = p.x
      if (p.y > ymax) ymax = p.y
    }
  }
  if (!Number.isFinite(xmin)) {
    xmin = 0
    ymin = 0
    xmax = 1
    ymax = 1
  }

  return {
    lanes,
    bounds: { xmin, ymin, xmax, ymax },
    roadCount: roadEls.length,
    laneCount: lanes.length,
  }
}

export { evalGeometryAt }
