import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import {
  patchRefFieldBounds,
} from './facilityRefFieldBounds'
import {
  REF_FIELD_CORNERS_M,
  serializeRefFieldCorners,
  type RefFieldCornerMeters,
} from './facilityRefFieldCorners'
import {
  getTrackGenLatPerBox,
  getTrackGenPaths,
  pointAlongPath,
  TRACKGEN_LAT_PER_BOX_KEY,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import { usesCornerFieldRange } from './facilityRefFieldBoundsAuto'
import {
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

type Anchor = {
  px: number
  py: number
  xM: number
  yM: number
  /** 這一塊的橫向比例尺，推出來的那塊沒有時抄它的 */
  latPerBox: [number, number] | null
}

function collectAnchors(area: MapAreaObject): Anchor[] {
  const out: Anchor[] = []
  for (const f of area.facilities) {
    if (f.type !== 'Track') continue
    const paths = getTrackGenPaths(f.parameters)
    if (!paths) continue
    for (const t of [0, 1]) {
      const uv = pointAlongPath(paths.local, t)
      const local = trackLocalPathPointToAreaLocal(f, area, uv)
      const real = pointAlongPath(paths.real, t)
      out.push({
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

function nearestAnchor(anchors: Anchor[], px: number, py: number): Anchor | null {
  let best: Anchor | null = null
  let bestD = Infinity
  for (const a of anchors) {
    const d = Math.hypot(a.px - px, a.py - py)
    if (d > JOIN_NEAR_PX || d >= bestD) continue
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
    const anchors = collectAnchors(area)
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
