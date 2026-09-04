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
export type RoadLink = {
  /** 'road' | 'junction' */
  type: string
  id: string
  /** 只有 type 是 road 時才有：接在對方的起點還是終點 */
  contact: 'start' | 'end' | null
}

export type RoadInfo = {
  id: string
  name: string
  lengthM: number
  /** '-1' 表示不在 junction 裡 */
  junctionId: string
  /**
   * 前後接誰。
   *
   * `contact` 是接在對方的哪一端（起點或終點）——OpenDRIVE 的 <code>contactPoint</code>。
   * 少了它就只知道「這兩條路相接」，不知道接在哪一頭，拓樸還是得靠座標猜。
   */
  predecessor: RoadLink | null
  successor: RoadLink | null
  /** 參考線取樣點（真實座標） */
  refPoints: OpenDrivePoint[]
  /**
   * 兩條行車道<strong>之間</strong>隔了多寬（公尺），與 refPoints 等長。
   *
   * 也就是內側那幾條非行車道（分隔島、路肩、標線）的總寬。上下行併在一起時它只有幾公分，
   * 中間夾進月台或安全島時它會長到幾公尺——月台在哪，檔案自己用這條寬度說了，不必從兩條
   * 中心線的距離回推。
   */
  innerGapM: number[]
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
    const linkOf = (tag: string): RoadLink | null => {
      const el = linkEl?.querySelector(`:scope > ${tag}`)
      if (!el) return null
      const contact = el.getAttribute('contactPoint')
      return {
        type: el.getAttribute('elementType') ?? '',
        id: el.getAttribute('elementId') ?? '',
        contact: contact === 'start' || contact === 'end' ? contact : null,
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
    /*
     * 兩條行車道之間隔多寬，沿線逐點算。
     *
     * 取兩側<strong>最靠內</strong>的行車道，把夾在它們中間那幾條的寬度加起來。那幾條在
     * OpenDRIVE 裡就是分隔島、路肩或只有標線寬度的 none —— 上下行併在一起時加起來只有
     * 幾公分，中間夾進月台時會長到幾公尺。
     */
    const innerGapM: number[] = (() => {
      const secEls = Array.from(roadEl.querySelectorAll(':scope > lanes > laneSection'))
      if (!secEls.length) return refLine.map(() => 0)
      return refLine.map((p) => {
        // 這個 s 落在哪一個 laneSection
        let sec = secEls[0]!
        let secS = num(sec, 's')
        for (const el of secEls) {
          const sv = num(el, 's')
          if (sv <= p.s + 1e-6 && sv >= secS) {
            sec = el
            secS = sv
          }
        }
        const all: ParsedLane[] = []
        for (const side of ['left', 'right']) {
          const container = sec.querySelector(`:scope > ${side}`)
          if (!container) continue
          for (const laneEl of Array.from(container.querySelectorAll(':scope > lane'))) {
            all.push(parseLane(laneEl))
          }
        }
        const driving = all.filter((l) => wanted.has(l.type))
        if (!driving.length) return 0
        const innerPos = driving.filter((l) => l.id > 0).sort((a, b) => a.id - b.id)[0]
        const innerNeg = driving.filter((l) => l.id < 0).sort((a, b) => b.id - a.id)[0]
        /*
         * 兩側各自算：從參考線數到那一側最靠內的行車道，中間夾了幾條非行車道。
         *
         * 上下行有時分成兩條 road（各只有一側有行車道），這時一條 road 只看得到自己那半
         * 邊的分隔島；把同一束的幾條加起來才是完整的間隔。
         */
        let gap = 0
        for (const l of all) {
          if (l.id === 0 || wanted.has(l.type)) continue
          if (innerPos && l.id > 0 && l.id < innerPos.id) gap += evalWidthPoly(l.widths, secS, p.s)
          if (innerNeg && l.id < 0 && l.id > innerNeg.id) gap += evalWidthPoly(l.widths, secS, p.s)
        }
        return gap
      })
    })()

    const deg = (rad: number) => (rad * 180) / Math.PI
    roads.push({
      id: roadId,
      name: roadEl.getAttribute('name') ?? roadId,
      lengthM: num(roadEl, 'length'),
      junctionId: roadEl.getAttribute('junction') ?? '-1',
      predecessor: linkOf('predecessor'),
      successor: linkOf('successor'),
      refPoints: refLine.map((p) => ({ x: p.x, y: p.y })),
      innerGapM,
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
