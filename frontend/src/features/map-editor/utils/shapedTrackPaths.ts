import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import {
  getRefFieldBounds,
  patchRefFieldBounds,
} from './facilityRefFieldBounds'
import {
  getRefFieldCorners,
  hasValidRefFieldCorners,
  REF_FIELD_CORNERS_M,
  serializeRefFieldCorners,
  type RefFieldCornerMeters,
} from './facilityRefFieldCorners'
import {
  getTrackGenLatPerBox,
  getTrackGenPaths,
  getTrackGenSpans,
  pointAlongPath,
  projectAlongPath,
  TRACKGEN_LAT_PER_BOX_KEY,
  TRACKGEN_SPANS_KEY,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import { usesCornerFieldRange } from './facilityRefFieldBoundsAuto'
import { resolveCrossPortalFields } from './crossTrackPortals'
import { ZONE_ENTRANCE_WAYPOINT_ID_KEY } from './zonePartition'
import { realBounds } from './trackGenApply'
import {
  CROSS_HANDLE_KEYS,
  crossTrackHandlesPx,
  readCrossTrack,
  readSwitchTrack,
  readTaperTrack,
  switchTrackHandlesPx,
  taperTrackHandlesPx,
} from './trackShapes'

/**
 * 沒有生成身分的斜／彎軌道，照形狀與鄰居推出一條中心線。
 *
 * <h3>為什麼需要</h3>
 * 一般軌道是水平或垂直的帶子，外框內插就等於中心線，沒有中心線也不影響。但分岔、
 * 斜接、圓角的中心線是斜的，外框裡大半是空地——沒有中心線時，車開到那一塊會被算到
 * 空地上的某個點。這些方塊多半是手工放的或複製來的，身上沒有生成器寫的路徑。
 *
 * <h3>分岔怎麼表示</h3>
 * <strong>主線道一個、分支一個</strong>：
 * <pre>
 *   主線道   進口 a → 直行出口 m   ——就是外框囊括的那條，與一般軌道同一回事
 *   分支     進口 a → 岔出出口 b   ——斜的，與斜接軌道同一回事
 * </pre>
 * 一個元件一條中心線，所以圖上把分岔畫成兩塊（一塊標直行、一塊標岔出）時，各自推
 * 各自那一條；只畫一塊時推主線道那條。
 *
 * <h3>現場座標從哪來</h3>
 * 端面的意義是「這裡接上隔壁那一塊」，所以答案在隔壁：找圖面上貼著這個端面的軌道
 * 方塊，取它中心線的那一端。自己身上那組參照場域範圍不能用——它正是壞掉的那個東西
 * （實測一塊分岔的範圍縱向橫跨 248 公尺，而它畫出來只有 131 像素）。
 */

/** 端面與隔壁方塊端點視為同一點的圖面距離（區域像素） */
const JOIN_NEAR_PX = 40

/**
 * 這張圖的軌道有多寬（公尺）。
 *
 * 斜接的場域範圍是<strong>四個角</strong>，不是兩端點，所以推完中心線還要往兩側撐開。
 * 寬度不能用圖面像素換算——示意圖沿線與橫向的比例尺是兩回事，照沿線的比例尺撐開，
 * 在被壓扁的那幾段會撐出三十幾公尺寬的軌道。
 *
 * 改成回頭問這張圖自己：取直軌道場域範圍的短邊中位數，那就是這條路的軌道寬。
 */
function laneWidthMOf(area: MapAreaObject): number {
  const widths: number[] = []
  for (const f of area.facilities) {
    if (f.type !== 'Track' || f.name !== 'Rail') continue
    const p = f.parameters as Record<string, number> | undefined
    if (!p) continue
    const w = Math.abs((p.refFieldXMaxM ?? 0) - (p.refFieldXMinM ?? 0))
    const h = Math.abs((p.refFieldYMaxM ?? 0) - (p.refFieldYMinM ?? 0))
    const short = Math.min(w, h)
    if (short > 0.5 && short < 20) widths.push(short)
  }
  if (widths.length === 0) return 3.5
  widths.sort((a, b) => a - b)
  return widths[Math.floor(widths.length / 2)]!
}

/**
 * 中心線兩端 ± 半個軌道寬 → 梯形四角。
 * 順序照屬性框：A 端起 → A 端迄 → B 端迄 → B 端起。
 */
function cornersFromCentreline(
  real: Array<[number, number]>,
  widthM: number,
): RefFieldCornerMeters[] {
  const a = real[0]!
  const b = real[real.length - 1]!
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (!(len > 1e-6)) return []
  const nx = (-dy / len) * (widthM / 2)
  const ny = (dx / len) * (widthM / 2)
  const round = (n: number) => Number(n.toFixed(2))
  return [
    { xM: round(a[0] + nx), yM: round(a[1] + ny) },
    { xM: round(a[0] - nx), yM: round(a[1] - ny) },
    { xM: round(b[0] - nx), yM: round(b[1] - ny) },
    { xM: round(b[0] + nx), yM: round(b[1] + ny) },
  ]
}

export type TrackAnchor = Anchor
type Anchor = {
  /** 這一端屬於哪一塊；重推自己時要排除自己，否則會找到自己 */
  facilityId: string
  /** 中心線的哪一端：0 起點、1 終點 */
  end: 0 | 1
  /** 交叉軌道才有：是四個口的哪一個 */
  port?: string
  /**
   * 分區入口才有：入口外框的四條邊（區域座標，[x0, y0, x1, y1]）。軌道可以接在邊上任何一處，
   * 所以比對時算到<strong>線段</strong>的距離；現場座標是入口綁定的途經點，整個入口只有這一個。
   */
  edges?: Array<[number, number, number, number]>
  px: number
  py: number
  xM: number
  yM: number
  /** 這一塊的橫向比例尺，推出來的那塊沒有時抄它的 */
  latPerBox: [number, number] | null
}

/** 入口外框的四條邊（區域座標，y 向上）；旋轉照元件的順時針角度 */
function entranceEdges(f: FacilityObject, area: MapAreaObject): Array<[number, number, number, number]> {
  const pos = resolveFacilityAreaPosition(f, area.domain, area.layout)
  const size = resolveFacilityAreaSize(f, area.domain, area.layout)
  const cx = pos.x + size.w / 2
  const cy = pos.y + size.h / 2
  const rad = (-(f.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corner = (dx: number, dy: number): [number, number] => [
    cx + dx * cos - dy * sin,
    cy + dx * sin + dy * cos,
  ]
  const hw = size.w / 2
  const hh = size.h / 2
  const c = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)]
  return c.map((p, i) => [p[0], p[1], c[(i + 1) % 4]![0], c[(i + 1) % 4]![1]])
}

/**
 * 分區入口：軌道接到入口的邊上，現場座標是入口綁定的途經點（zoneEntranceWaypointId）。
 * 入口的圖台位置與大小不決定現場範圍，所以邊上每一處都答同一個座標。沒綁途經點就沒有答案。
 */
function entranceAnchor(f: FacilityObject, area: MapAreaObject): Anchor | null {
  const wpId = f.parameters?.[ZONE_ENTRANCE_WAYPOINT_ID_KEY]
  const wp = typeof wpId === 'string' ? area.facilities.find((x) => x.id === wpId) : undefined
  const xM = Number(wp?.parameters?.refFieldXM)
  const yM = Number(wp?.parameters?.refFieldYM)
  if (!wp || !Number.isFinite(xM) || !Number.isFinite(yM)) return null
  const edges = entranceEdges(f, area)
  return {
    facilityId: f.id,
    end: 0,
    px: (edges[0]![0] + edges[2]![0]) / 2,
    py: (edges[0]![1] + edges[2]![1]) / 2,
    xM,
    yM,
    latPerBox: null,
    edges,
  }
}

function collectAnchors(area: MapAreaObject, withEntrances = false): Anchor[] {
  const out: Anchor[] = []
  if (withEntrances) {
    for (const f of area.facilities) {
      if (f.type === 'Facility' && f.name === 'ZoneEntrance') {
        const a = entranceAnchor(f, area)
        if (a) out.push(a)
      }
    }
  }
  for (const f of area.facilities) {
    if (f.type !== 'Track') continue
    /*
     * 交叉軌道對外的接口是四個口，不是它那條頭尾連線的折線（那條只是把兩條直行併成一條，
     * 端點離口差好幾公尺）。隔壁要接的是口，所以拿口當錨點。
     */
    if (f.name === 'RailCross') {
      const size = resolveFacilityAreaSize(f, area.domain, area.layout)
      const handles = crossTrackHandlesPx(readCrossTrack(f.parameters), size.w, size.h)
      const fields = resolveCrossPortalFields(f, area)
      for (const key of CROSS_HANDLE_KEYS) {
        const at = fields[key]
        if (at.xM === null || at.yM === null) continue
        const local = trackLocalPathPointToAreaLocal(f, area, {
          x: handles[key].x / Math.max(1e-6, size.w),
          y: handles[key].y / Math.max(1e-6, size.h),
        })
        out.push({
          facilityId: f.id,
          end: key === 'lt' || key === 'lb' ? 0 : 1,
          port: key,
          px: local.x,
          py: local.y,
          xM: at.xM,
          yM: at.yM,
          latPerBox: getTrackGenLatPerBox(f.parameters),
        })
      }
      continue
    }
    const paths = getTrackGenPaths(f.parameters)
    if (!paths) continue
    for (const t of [0, 1] as const) {
      const uv = pointAlongPath(paths.local, t)
      const local = trackLocalPathPointToAreaLocal(f, area, uv)
      const real = pointAlongPath(paths.real, t)
      out.push({
        facilityId: f.id,
        end: t,
        px: local.x,
        py: local.y,
        xM: real.x,
        yM: real.y,
        latPerBox: getTrackGenLatPerBox(f.parameters),
      })
    }
  }
  return out
}

function distToSegment(px: number, py: number, e: [number, number, number, number]): number {
  const dx = e[2] - e[0]
  const dy = e[3] - e[1]
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - e[0]) * dx + (py - e[1]) * dy) / len2)) : 0
  return Math.hypot(px - (e[0] + t * dx), py - (e[1] + t * dy))
}

function nearestAnchor(
  anchors: Anchor[],
  px: number,
  py: number,
  exceptId?: string,
  nearPx: number = JOIN_NEAR_PX,
): Anchor | null {
  let best: Anchor | null = null
  let bestD = Infinity
  for (const a of anchors) {
    if (exceptId && a.facilityId === exceptId) continue
    const d = a.edges
      ? Math.min(...a.edges.map((e) => distToSegment(px, py, e)))
      : Math.hypot(a.px - px, a.py - py)
    if (d > nearPx || d >= bestD) continue
    best = a
    bestD = d
  }
  return best
}

/** 端面在外框內的比例位置（0–1，v 向下）；handles 回的是相對元件左上角的像素 */
function faceUv(
  handle: { x: number; y: number },
  size: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, handle.x / Math.max(1e-6, size.w))),
    y: Math.max(0, Math.min(1, handle.y / Math.max(1e-6, size.h))),
  }
}

/**
 * 這一塊要接的是哪兩個端面。
 *
 * 分岔看它標的是哪一部分：只標了岔出就推分支那條，其餘（標直行、或沒標）推主線道。
 */
function facesOf(
  facility: FacilityObject,
  size: { w: number; h: number },
): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (facility.name === 'RailSwitch') {
    const g = readSwitchTrack(facility.parameters)
    const handles = switchTrackHandlesPx(g, size.w, size.h)
    const parts = facility.parameters?.trackGenPartNames as
      | Record<string, unknown>
      | undefined
    const branchOnly =
      typeof parts?.branch === 'string' && typeof parts?.straight !== 'string'
    return [handles.a, branchOnly ? handles.b : handles.m]
  }
  if (facility.name === 'RailTaper') {
    const g = readTaperTrack(facility.parameters)
    const handles = taperTrackHandlesPx(g, size.w, size.h)
    return [handles.a, handles.b]
  }
  /*
   * 一般軌道與圓角：端面就是外框長邊的兩端。
   *
   * 拖過來放下的那一塊還沒有中心線，只有一個框；它要接的是框的兩頭，所以就拿兩頭去
   * 問隔壁。圓角的兩頭在相鄰的兩條邊上，用外框兩端當近似——找隔壁只需要「大概在哪個
   * 角」，差幾像素不影響挑到誰。
   */
  if (facility.type === 'Track') {
    const horizontal = size.w >= size.h
    return horizontal
      ? [{ x: 0, y: size.h / 2 }, { x: size.w, y: size.h / 2 }]
      : [{ x: size.w / 2, y: size.h }, { x: size.w / 2, y: 0 }]
  }
  return null
}

/**
 * 把推得出來的中心線補上去。
 *
 * 兩端都在隔壁找得到對應才寫——只找到一端的話，另一端要嘛編一個座標、要嘛照壞掉的
 * 外框推，兩種都是給一個看起來合理的錯答案。
 */
export function deriveShapedTrackPathsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  derived: string[]
  skipped: string[]
} {
  const derived: string[] = []
  const skipped: string[] = []

  const nextAreas = areas.map((area) => {
    const anchors = collectAnchors(area, true)
    if (anchors.length === 0) return area
    const laneWidthM = laneWidthMOf(area)

    let touched = false
    const facilities = area.facilities.map((f) => {
      if (f.type !== 'Track') return f
      if (getTrackGenPaths(f.parameters)) return f
      const size = resolveFacilityAreaSize(f, area.domain, area.layout)
      const faces = facesOf(f, size)
      if (!faces) return f

      const label = f.customName?.trim() || (f.parameters?.trackGenPartNames as
        | Record<string, string>
        | undefined)?.branch
        || (f.parameters?.trackGenPartNames as Record<string, string> | undefined)?.straight
        || f.id

      const ends = faces.map((handle) => {
        const uv = faceUv(handle, size)
        const local = trackLocalPathPointToAreaLocal(f, area, { x: uv.x, y: uv.y })
        return { uv, anchor: nearestAnchor(anchors, local.x, local.y) }
      })
      if (ends.some((e) => !e.anchor)) {
        skipped.push(label)
        return f
      }

      const real: Array<[number, number]> = ends.map((e) => [
        Number(e.anchor!.xM.toFixed(2)),
        Number(e.anchor!.yM.toFixed(2)),
      ])
      const local: Array<[number, number]> = ends.map((e) => [
        Number(e.uv.x.toFixed(4)),
        Number(e.uv.y.toFixed(4)),
      ])
      if (Math.hypot(real[1][0] - real[0][0], real[1][1] - real[0][1]) < 0.5) {
        skipped.push(label)
        return f
      }

      touched = true
      derived.push(label)
      let parameters: Record<string, unknown> = {
        ...(f.parameters ?? {}),
        [TRACKGEN_REAL_PATH_KEY]: real,
        [TRACKGEN_LOCAL_PATH_KEY]: local,
      }
      /*
       * 橫向比例尺跟著鄰居走。
       *
       * 少了它，這一塊就算有中心線也<strong>算不出任何一點</strong>——橫向偏移沒有
       * 尺可以換算成公尺，fieldFromTrack 直接回 null，於是框裡的停靠點會被隔壁那塊
       * 搶去解釋。相鄰的兩塊是同一條帶子、畫在同一個比例上，抄過來就對。
       */
      if (!(f.parameters ?? {})[TRACKGEN_LAT_PER_BOX_KEY]) {
        const donor = ends
          .map((e) => e.anchor?.latPerBox)
          .find((v) => Array.isArray(v) && v.length === 2)
        if (donor) parameters = { ...parameters, [TRACKGEN_LAT_PER_BOX_KEY]: donor }
      }
      /*
       * 斜接的場域範圍是四個角，屬性框顯示的、下游用的都是它。只寫左右上下四個數
       * 的話，舊的四個角會原封不動留著——畫面上看起來完全沒變，實際上還是指著別的
       * 地方。推完中心線就把角一起重算。
       */
      const corners = usesCornerFieldRange(f)
        ? cornersFromCentreline(real, laneWidthM)
        : []
      if (corners.length === 4) {
        parameters = {
          ...parameters,
          [REF_FIELD_CORNERS_M]: serializeRefFieldCorners(corners),
        }
      }
      const pts = corners.length === 4
        ? corners.map((c) => [c.xM, c.yM] as [number, number])
        : real
      const xs = pts.map((r) => r[0])
      const ys = pts.map((r) => r[1])
      return {
        ...f,
        parameters: patchRefFieldBounds(parameters, {
          xMinM: Number(Math.min(...xs).toFixed(2)),
          xMaxM: Number(Math.max(...xs).toFixed(2)),
          yMinM: Number(Math.min(...ys).toFixed(2)),
          yMaxM: Number(Math.max(...ys).toFixed(2)),
        }),
      } as FacilityObject
    })

    return touched ? { ...area, facilities } : area
  })

  return { areas: nextAreas, derived, skipped }
}

/**
 * 補上缺的橫向比例尺。
 *
 * 有中心線、卻沒有 trackGenLatPerBox 的方塊，<strong>一個點都算不出來</strong>：橫向
 * 偏移沒有尺可以換算成公尺，fieldFromTrack 直接回 null。症狀是框裡的停靠點被隔壁那塊
 * 搶去解釋——實測 T3上行 畫在 U19 框內，卻由 87 像素外的 D19 給了答案，座標落在隔壁
 * 那條線再往旁邊 16 公尺，而兩條線只差 3.5 公尺。
 *
 * 橫向比例尺是「這條帶子畫多粗代表現場多寬」，相鄰同一條帶子的方塊是同一個值，所以
 * 抄圖面上最近、外框大小又最像的那一塊。
 */
export function backfillTrackGenLatPerBoxInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  filled: string[]
} {
  const filled: string[] = []
  const next = areas.map((area) => {
    const box = (f: FacilityObject) => {
      const pos = resolveFacilityAreaPosition(f, area.domain, area.layout)
      const size = resolveFacilityAreaSize(f, area.domain, area.layout)
      return { cx: pos.x + size.w / 2, cy: pos.y + size.h / 2, w: size.w, h: size.h }
    }
    const donors = area.facilities
      .filter((f) => f.type === 'Track' && getTrackGenLatPerBox(f.parameters))
      .map((f) => ({ ...box(f), lat: getTrackGenLatPerBox(f.parameters)! }))
    if (donors.length === 0) return area

    let changed = false
    const facilities = area.facilities.map((f) => {
      if (f.type !== 'Track') return f
      if (!getTrackGenPaths(f.parameters)) return f
      if (getTrackGenLatPerBox(f.parameters)) return f
      const me = box(f)
      let best: (typeof donors)[number] | null = null
      let bestScore = Infinity
      for (const d of donors) {
        // 先看畫面上多近，再看外框像不像——同一條帶子上的方塊兩者都接近
        const score = Math.hypot(d.cx - me.cx, d.cy - me.cy)
          + (Math.abs(d.w - me.w) + Math.abs(d.h - me.h)) * 2
        if (score < bestScore) {
          bestScore = score
          best = d
        }
      }
      if (!best) return f
      changed = true
      filled.push(f.customName?.trim() || f.id)
      return {
        ...f,
        parameters: { ...(f.parameters ?? {}), [TRACKGEN_LAT_PER_BOX_KEY]: best.lat },
      } as FacilityObject
    })
    return changed ? { ...area, facilities } : area
  })
  return { areas: next, filled }
}

/* ── 中心線過期：複製、移動之後兩端不再接到隔壁 ─────────────────────────── */

/**
 * 中心線的一端與圖面上貼著它的隔壁差超過這麼多公尺，就當它過期了。
 *
 * 生成出來的軌道兩端本來就接著隔壁，差距是 0.0x 公尺；差幾公尺以上只有一個原因：這一塊
 * 的圖面位置換了、身上的現場中心線還是別處的（複製一塊軌道再拖到別處，連中心線一起複製
 * 了過去）。
 */
export const STALE_PATH_END_M = 3

/** 圖面上貼著多近才算「隔壁」——比接合用的 JOIN_NEAR_PX 嚴，過期判斷不能誤把別條車道當鄰居 */
const STALE_NEAR_PX = 12

/** 過期偵測只看單純的帶子；交叉與分岔的中心線本來就不等於各口的位置 */
function checksStaleness(f: FacilityObject): boolean {
  return f.type === 'Track' && (f.name === 'Rail' || f.name === 'RailTaper' || f.name === 'RailCorner')
}

export type StaleTrackPathEnd = {
  end: 0 | 1
  /** 這一端的現場座標與隔壁那一端差多少公尺 */
  diffM: number
  neighbourId: string
}

/**
 * 這一塊的中心線哪幾端與隔壁對不上。空陣列＝沒過期（或找不到隔壁，無從比較）。
 */
export function findStaleTrackPathEnds(
  f: FacilityObject,
  area: MapAreaObject,
  anchors: Anchor[] = collectAnchors(area),
): StaleTrackPathEnd[] {
  if (!checksStaleness(f)) return []
  const paths = getTrackGenPaths(f.parameters)
  if (!paths) return []
  const out: StaleTrackPathEnd[] = []
  for (const t of [0, 1] as const) {
    const uv = pointAlongPath(paths.local, t)
    const at = trackLocalPathPointToAreaLocal(f, area, uv)
    const near = nearestAnchor(anchors, at.x, at.y, f.id, STALE_NEAR_PX)
    if (!near) continue
    const own = pointAlongPath(paths.real, t)
    const diffM = Math.hypot(near.xM - own.x, near.yM - own.y)
    if (diffM > STALE_PATH_END_M) out.push({ end: t, diffM, neighbourId: near.facilityId })
  }
  return out
}

/**
 * 這張圖裡「畫多粗代表現場多寬」：每公尺橫向偏移佔幾個像素。
 *
 * 同一張圖是同一把尺，所以取直軌道的中位數；新推出來的中心線用它換算橫向比例，才不會
 * 抄到別的外框尺寸的值（複製來的 U04 就是這樣被標成 7 公尺寬）。
 */
function lateralPxPerMOf(area: MapAreaObject): number | null {
  const values: number[] = []
  for (const f of area.facilities) {
    if (f.type !== 'Track' || f.name !== 'Rail') continue
    const lat = getTrackGenLatPerBox(f.parameters)
    if (!lat) continue
    const size = resolveFacilityAreaSize(f, area.domain, area.layout)
    const v = size.w >= size.h ? lat[1] * size.h : lat[0] * size.w
    if (v > 0.5 && Number.isFinite(v)) values.push(v)
  }
  if (values.length === 0) return null
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]!
}

export type RederiveResult =
  | { ok: true; facility: FacilityObject; changedM: number }
  | { ok: false; reason: string }

/**
 * 依隔壁重建這一塊的中心線（複製或移動之後用）。
 *
 * 跟載入時補中心線是同一套：兩端各找圖面上貼著的隔壁（排除自己），取它中心線的那一端；
 * 兩端都找得到才寫。差別是這裡<strong>覆寫既有的</strong>：要重建的正是那條複製來的、過期的。
 * 連帶更新里程（接在隔壁後面）、行進方向、橫向比例尺與場域範圍——只換中心線不換這些，
 * 場域範圍與里程還是指著舊的位置。
 */
export function rederiveTrackPath(
  f: FacilityObject,
  area: MapAreaObject,
  nearPx: number = JOIN_NEAR_PX,
): RederiveResult {
  if (f.type !== 'Track') return { ok: false, reason: '不是軌道' }
  if (f.name === 'RailCross' || f.name === 'RailSwitch') {
    return { ok: false, reason: '交叉與分岔的中心線由口與各段決定，不能這樣重建' }
  }
  const size = resolveFacilityAreaSize(f, area.domain, area.layout)
  const faces = facesOf(f, size)
  if (!faces) return { ok: false, reason: '這種軌道沒有可接的端面' }

  const anchors = collectAnchors(area, true)
  const ends = faces.map((handle) => {
    const uv = faceUv(handle, size)
    const local = trackLocalPathPointToAreaLocal(f, area, { x: uv.x, y: uv.y })
    return { uv, anchor: nearestAnchor(anchors, local.x, local.y, f.id, nearPx) }
  })
  if (ends.some((e) => !e.anchor)) {
    return { ok: false, reason: '有一端在圖上找不到相接的軌道' }
  }
  const real: Array<[number, number]> = ends.map((e) => [
    Number(e.anchor!.xM.toFixed(2)),
    Number(e.anchor!.yM.toFixed(2)),
  ])
  const lengthM = Math.hypot(real[1]![0] - real[0]![0], real[1]![1] - real[0]![1])
  if (lengthM < 0.5) return { ok: false, reason: '兩端接到同一點' }

  const old = getTrackGenPaths(f.parameters)
  const oldEnd = old ? pointAlongPath(old.real, 0) : null
  const changedM = oldEnd ? Math.hypot(oldEnd.x - real[0]![0], oldEnd.y - real[0]![1]) : 0

  const local: Array<[number, number]> = ends.map((e) => [
    Number(e.uv.x.toFixed(4)),
    Number(e.uv.y.toFixed(4)),
  ])
  let parameters: Record<string, unknown> = {
    ...(f.parameters ?? {}),
    [TRACKGEN_REAL_PATH_KEY]: real,
    [TRACKGEN_LOCAL_PATH_KEY]: local,
  }

  // 橫向比例尺：同一張圖同一把尺，換成這一塊的外框
  const pxPerM = lateralPxPerMOf(area)
  if (pxPerM) {
    parameters[TRACKGEN_LAT_PER_BOX_KEY] = [
      Number((pxPerM / Math.max(1, size.w)).toFixed(6)),
      Number((pxPerM / Math.max(1, size.h)).toFixed(6)),
    ]
  }

  // 里程與行進方向：沿用原本的 road／lane；里程接在起點那一端的隔壁後面
  const heading = Math.atan2(real[1]![1] - real[0]![1], real[1]![0] - real[0]![0])
  const span0 = getTrackGenSpans(f.parameters)[0]
  if (span0) {
    const owner = area.facilities.find((g) => g.id === ends[0]!.anchor!.facilityId)
    const ownerSpans = owner ? getTrackGenSpans(owner.parameters) : []
    const ownerTail = ownerSpans[ownerSpans.length - 1]
    // 隔壁同一條 road／lane、而且是接在它的終點後面，里程就從它結束的地方接下去
    const s0 =
      ownerTail && ends[0]!.anchor!.end === 1 && ownerTail.road === span0.road && ownerTail.lane === span0.lane
        ? ownerTail.s1
        : span0.s0
    parameters[TRACKGEN_SPANS_KEY] = [
      {
        road: span0.road,
        lane: span0.lane,
        s0: Number(s0.toFixed(2)),
        s1: Number((s0 + lengthM).toFixed(2)),
        h: Number(heading.toFixed(4)),
        f0: 0,
        f1: 1,
      },
    ]
  }

  // 場域範圍：斜接是四個角，其餘取中心線兩側各半個軌道寬的外接矩形
  const laneWidthM = laneWidthMOf(area)
  const corners = cornersFromCentreline(real, laneWidthM)
  if (usesCornerFieldRange(f) && corners.length === 4) {
    parameters[REF_FIELD_CORNERS_M] = serializeRefFieldCorners(corners)
  }
  const pts = corners.length === 4 ? corners.map((c) => [c.xM, c.yM] as [number, number]) : real
  const xs = pts.map((r) => r[0])
  const ys = pts.map((r) => r[1])
  // 直軌道與圓角：與生成器、「重算」同一個定義（中心線外框往兩側撐半個車道）
  const canonical =
    (f.name === 'Rail' || f.name === 'RailCorner') && !usesCornerFieldRange(f)
      ? (realBounds(real.map(([x, y]) => ({ x, y }))) as Record<string, number>)
      : null
  return {
    ok: true,
    changedM,
    facility: {
      ...f,
      parameters: patchRefFieldBounds(
        parameters,
        canonical
          ? {
              xMinM: canonical.refFieldXMinM!,
              xMaxM: canonical.refFieldXMaxM!,
              yMinM: canonical.refFieldYMinM!,
              yMaxM: canonical.refFieldYMaxM!,
            }
          : {
              xMinM: Number(Math.min(...xs).toFixed(2)),
              xMaxM: Number(Math.max(...xs).toFixed(2)),
              yMinM: Number(Math.min(...ys).toFixed(2)),
              yMaxM: Number(Math.max(...ys).toFixed(2)),
            },
      ),
    } as FacilityObject,
  }
}

/* ── 移動之後：場域位置跟著接到的鄰居走 ───────────────────────────────────── */

/** 使用者放下一塊軌道，大概貼在鄰居旁邊就算「接上」：比載入時的 40 像素寬鬆 */
export const MOVE_FOLLOW_NEAR_PX = 60

/** 兩端已經接著鄰居（差不到這麼多公尺）就不必動它，免得把彎的中心線拉成直線 */
const FOLLOW_CONSISTENT_M = 0.3

/**
 * 剛移動過的軌道，場域位置跟著它接到的鄰居走。
 *
 * <ul>
 *   <li>兩端都貼著鄰居：中心線重建成兩端接鄰居（複製來的 U04 就是這樣接回 U05 與交叉）。</li>
 *   <li>只有一端貼著鄰居：形狀與長度不變，整條平移到那一端貼上去。</li>
 *   <li>沒有貼著任何鄰居：不動——圖上空地沒有對應的現場座標，硬換算只會編一個數字。</li>
 *   <li>已經接著鄰居（差不到 {@link FOLLOW_CONSISTENT_M} 公尺）：不動。</li>
 * </ul>
 * 沒有要改的回 null。
 */
export function followNeighboursAfterMove(
  f: FacilityObject,
  area: MapAreaObject,
): RederiveResult | null {
  if (!checksStaleness(f)) return null
  const paths = getTrackGenPaths(f.parameters)
  if (!paths) return null
  const anchors = collectAnchors(area, true)
  const ends = ([0, 1] as const).map((t) => {
    const uv = pointAlongPath(paths.local, t)
    const at = trackLocalPathPointToAreaLocal(f, area, uv)
    return {
      t,
      own: pointAlongPath(paths.real, t),
      anchor: nearestAnchor(anchors, at.x, at.y, f.id, MOVE_FOLLOW_NEAR_PX),
    }
  })
  const found = ends.filter((e) => e.anchor)
  if (found.length === 0) return null
  const diff = (e: (typeof ends)[number]) => Math.hypot(e.anchor!.xM - e.own.x, e.anchor!.yM - e.own.y)
  if (found.every((e) => diff(e) <= FOLLOW_CONSISTENT_M)) return null

  if (found.length === 2) return rederiveTrackPath(f, area, MOVE_FOLLOW_NEAR_PX)

  // 只有一端：整條平移，讓那一端貼上鄰居
  const e = found[0]!
  const dx = e.anchor!.xM - e.own.x
  const dy = e.anchor!.yM - e.own.y
  const real = paths.real.map(([x, y]) => [Number((x + dx).toFixed(2)), Number((y + dy).toFixed(2))] as [number, number])
  let parameters: Record<string, unknown> = { ...(f.parameters ?? {}), [TRACKGEN_REAL_PATH_KEY]: real }
  const bounds = realBounds(real.map(([x, y]) => ({ x, y })))
  const corners = getRefFieldCorners(f.parameters)
  if (usesCornerFieldRange(f) && hasValidRefFieldCorners(f.parameters)) {
    parameters[REF_FIELD_CORNERS_M] = serializeRefFieldCorners(
      corners.map((c) => ({ xM: Number(((c.xM ?? 0) + dx).toFixed(2)), yM: Number(((c.yM ?? 0) + dy).toFixed(2)) })),
    )
    const b = getRefFieldBounds(f.parameters)
    parameters = patchRefFieldBounds(parameters, {
      xMinM: Number(((b.xMinM ?? 0) + dx).toFixed(2)),
      xMaxM: Number(((b.xMaxM ?? 0) + dx).toFixed(2)),
      yMinM: Number(((b.yMinM ?? 0) + dy).toFixed(2)),
      yMaxM: Number(((b.yMaxM ?? 0) + dy).toFixed(2)),
    })
  } else if (Object.keys(bounds).length === 4) {
    const v = bounds as Record<string, number>
    parameters = patchRefFieldBounds(parameters, {
      xMinM: v.refFieldXMinM!,
      xMaxM: v.refFieldXMaxM!,
      yMinM: v.refFieldYMinM!,
      yMaxM: v.refFieldYMaxM!,
    })
  }
  return { ok: true, facility: { ...f, parameters } as FacilityObject, changedM: Math.hypot(dx, dy) }
}

/** 給軌道檢查用：整個區域所有軌道端點（與交叉口）的錨點 */
export function collectTrackAnchors(area: MapAreaObject): TrackAnchor[] {
  return collectAnchors(area)
}

/** 給軌道檢查用：圖面位置附近最近的錨點（排除自己） */
export function nearestTrackAnchor(
  anchors: TrackAnchor[],
  px: number,
  py: number,
  exceptId: string | undefined,
  nearPx: number,
): TrackAnchor | null {
  return nearestAnchor(anchors, px, py, exceptId, nearPx)
}

/** 端面把手（相對元件左上角的像素）→ 外框內的比例位置 */
export function faceUvOfHandle(
  handle: { x: number; y: number },
  size: { w: number; h: number },
): { x: number; y: number } {
  return faceUv(handle, size)
}

/* ── 圖面路徑上下顛倒、中心線多算了一段 ────────────────────────────────────── */

/** 同一條車道上，兩塊軌道的現場中心線相距這麼近（公尺）才算「走在同一條線上」 */
const SAME_LANE_M = 1.2
/** 走在同一條線上的重疊長度超過這麼多公尺，就是有一塊多算了（公尺） */
export const REAL_OVERLAP_M = 20

function realLength(path: Array<[number, number]>): number {
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
  }
  return total
}

/** 較短那條的取樣點落在較長那條旁邊（SAME_LANE_M 內）的長度（公尺） */
function collinearOverlapM(
  short: Array<[number, number]>,
  long: Array<[number, number]>,
): number {
  const len = realLength(short)
  if (!(len > 1)) return 0
  const step = 4
  const n = Math.max(2, Math.ceil(len / step))
  let hit = 0
  for (let i = 0; i <= n; i += 1) {
    const at = pointAlongPath(short, i / n)
    if (projectAlongPath(long, at.x, at.y).distance <= SAME_LANE_M) hit += 1
  }
  return (hit / (n + 1)) * len
}

export type RealOverlap = {
  longer: FacilityObject
  shorter: FacilityObject
  overlapM: number
}

/**
 * 現場中心線走在同一條線上、又重疊一大段的兩塊軌道（同一條車道上不該有兩塊蓋同一段路）。
 *
 * U18 的現場中心線長 168 公尺，是圖上 U18 與 U19 兩塊的長度加起來，一半與 U19 疊在一起。
 * 這個判斷只看現場座標，不依賴里程（span）——里程欄位被重建、重接之後常常就沒了。
 * 較長的那塊多半是多算的。
 */
export function findRealOverlaps(area: MapAreaObject): RealOverlap[] {
  const plain = area.facilities
    .filter((f) => checksStaleness(f))
    .map((f) => ({ f, paths: getTrackGenPaths(f.parameters) }))
    .filter((x): x is { f: FacilityObject; paths: NonNullable<ReturnType<typeof getTrackGenPaths>> } => x.paths !== null)
  const out: RealOverlap[] = []
  for (let i = 0; i < plain.length; i += 1) {
    for (let j = i + 1; j < plain.length; j += 1) {
      const a = plain[i]!
      const b = plain[j]!
      const la = realLength(a.paths.real)
      const lb = realLength(b.paths.real)
      const [longer, shorter, longLen, shortLen] = la >= lb ? [a, b, la, lb] : [b, a, lb, la]
      // 兩條的外框差太遠就不必逐點算
      const near = longer.paths.real.some(([x, y]) =>
        shorter.paths.real.some(([u, v]) => Math.hypot(x - u, y - v) < 30),
      )
      if (!near) continue
      const overlap = collinearOverlapM(shorter.paths.real, longer.paths.real)
      // 重疊夠長，而且佔較短那塊的一大半（只是擦邊、接點附近並排的不算）
      if (overlap < REAL_OVERLAP_M || overlap < shortLen * 0.6 || longLen < shortLen * 1.3) continue
      out.push({ longer: longer.f, shorter: shorter.f, overlapM: overlap })
    }
  }
  return out
}

