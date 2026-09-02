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
  /** 車道寬（公尺，取起點處）——軌道畫多寬直接用它，不要自己訂 */
  widthM: number
}

/**
 * 一條 road。
 *
 * OpenDRIVE 本來就以 road 為單位：每條有 id、name、長度、屬於哪個 junction、
 * 前後接誰，以及左右各有哪些 lane。方向也是明確的——s 沿參考線遞增，lane id
 * 正號在參考線左側、負號在右側。這些都不需要猜。
 */
export type RoadInfo = {
  id: string
  name: string
  lengthM: number
  /** '-1' 表示不在 junction 裡 */
  junctionId: string
  predecessor: { type: string; id: string } | null
  successor: { type: string; id: string } | null
  /** 參考線取樣點（真實座標） */
  refPoints: OpenDrivePoint[]
  /** 起點與終點的方位（度，數學慣例、逆時針為正） */
  headingFromDeg: number
  headingToDeg: number
  lanes: Array<{
    id: number
    type: string
    /** 車道寬（公尺，取起點處） */
    widthM: number
    mmslLaneId: string | null
  }>
}

export type LaneCenterlinePlan = {
  lanes: LaneCenterline[]
  roads: RoadInfo[]
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
  const roads: RoadInfo[] = []

  for (const roadEl of roadEls) {
    const roadId = roadEl.getAttribute('id') ?? '?'
    const inJunction = (roadEl.getAttribute('junction') ?? '-1') !== '-1'
    const refLine: RefSample[] = sampleReferenceLine(parsePlanView(roadEl), step)
    if (refLine.length < 2) continue

    /*
     * road 層的資訊照抄，不做任何推論。
     *
     * 這一層本來就在檔案裡，先前只取了車道中心線就把它丟掉，結果得靠「把車道串起來」
     * 反推有幾條路——那是猜的，而 OpenDRIVE 已經明講了。
     */
    const linkEl = roadEl.querySelector(':scope > link')
    const linkOf = (tag: string) => {
      const el = linkEl?.querySelector(`:scope > ${tag}`)
      if (!el) return null
      return {
        type: el.getAttribute('elementType') ?? '',
        id: el.getAttribute('elementId') ?? '',
      }
    }
    const firstSection = roadEl.querySelector(':scope > lanes > laneSection')
    const roadLanes: RoadInfo['lanes'] = []
    for (const side of ['left', 'center', 'right']) {
      const container = firstSection?.querySelector(`:scope > ${side}`)
      if (!container) continue
      for (const laneEl of Array.from(container.querySelectorAll(':scope > lane'))) {
        const parsed = parseLane(laneEl)
        roadLanes.push({
          id: parsed.id,
          type: parsed.type,
          widthM: evalWidthPoly(parsed.widths, 0, 0),
          mmslLaneId: parsed.mmslLaneId,
        })
      }
    }
    const deg = (rad: number) => (rad * 180) / Math.PI
    roads.push({
      id: roadId,
      name: roadEl.getAttribute('name') ?? roadId,
      lengthM: num(roadEl, 'length'),
      junctionId: roadEl.getAttribute('junction') ?? '-1',
      predecessor: linkOf('predecessor'),
      successor: linkOf('successor'),
      refPoints: refLine.map((p) => ({ x: p.x, y: p.y })),
      headingFromDeg: deg(refLine[0]!.hdg),
      headingToDeg: deg(refLine[refLine.length - 1]!.hdg),
      lanes: roadLanes.sort((a, b) => b.id - a.id),
    })

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
          widthM: evalWidthPoly(lane.widths, sectionS, sectionS),
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
    roads,
    bounds: { xmin, ymin, xmax, ymax },
    roadCount: roadEls.length,
    laneCount: lanes.length,
  }
}

export { evalGeometryAt }
