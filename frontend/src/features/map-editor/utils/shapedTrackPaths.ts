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
  getTrackGenSpans,
  pointAlongPath,
  TRACKGEN_LAT_PER_BOX_KEY,
  TRACKGEN_SPANS_KEY,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import { usesCornerFieldRange } from './facilityRefFieldBoundsAuto'
import { resolveCrossPortalFields } from './crossTrackPortals'
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

type Anchor = {
  /** 這一端屬於哪一塊；重推自己時要排除自己，否則會找到自己 */
  facilityId: string
  /** 中心線的哪一端：0 起點、1 終點 */
  end: 0 | 1
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
    const d = Math.hypot(a.px - px, a.py - py)
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
 * 載入時自動修好「兩端都接不上隔壁」的軌道。
 *
 * 使用者不會、也不該去想複製一塊軌道會連中心線一起複製：U04 是 U06 的複製，拖到 U05 與交叉
 * 之間，兩端都跟隔壁差了幾十公尺，就是它錯。判斷規則：
 * <ul>
 *   <li>兩端在圖上都找得到貼著的隔壁，而且<strong>兩端都對不上</strong>——才自動重建。</li>
 *   <li>只有一端對不上的不動：兩塊互相對不上時（U18／U19）看不出誰對誰錯，各自的另一端
 *       都接得上，硬改一塊就是拿正確的去配錯誤的。這種只回報。</li>
 * </ul>
 * 這樣圖資載入（編輯器、儀表板、任何讀圖的地方）就是對的，編輯器存檔時也會把修好的寫回去，
 * 不需要有人去按任何按鈕。
 */
export function healStaleTrackPathsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  healed: string[]
  ambiguous: string[]
} {
  const healed: string[] = []
  const next = areas.map((area) => {
    const anchors = collectAnchors(area)
    let touched = false
    const facilities = area.facilities.map((f) => {
      // 兩端都對不上才改；只有一端對不上的先不動，等這一輪修完再看還剩誰
      if (findStaleTrackPathEnds(f, area, anchors).length < 2) return f
      const res = rederiveTrackPath(f, area)
      if (!res.ok) return f
      touched = true
      healed.push(f.customName?.trim() || f.id)
      return res.facility
    })
    return touched ? { ...area, facilities } : area
  })
  // 修完之後還對不上的：鄰居是被修好的那一塊的，現在已經接上；剩下的才是真的看不出誰錯
  const ambiguous = listStaleTrackPaths(next).map((s) => s.label)
  return { areas: next, healed, ambiguous }
}

/** 整張圖裡中心線過期的軌道（載入時只回報，不自動改：兩塊互相對不上時看不出誰對誰錯） */
export function listStaleTrackPaths(
  areas: MapAreaObject[],
): Array<{ areaId: string; facilityId: string; label: string; ends: StaleTrackPathEnd[] }> {
  const out: Array<{ areaId: string; facilityId: string; label: string; ends: StaleTrackPathEnd[] }> = []
  for (const area of areas) {
    const anchors = collectAnchors(area)
    for (const f of area.facilities) {
      const ends = findStaleTrackPathEnds(f, area, anchors)
      if (ends.length > 0) {
        out.push({ areaId: area.id, facilityId: f.id, label: f.customName?.trim() || f.id, ends })
      }
    }
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
export function rederiveTrackPath(f: FacilityObject, area: MapAreaObject): RederiveResult {
  if (f.type !== 'Track') return { ok: false, reason: '不是軌道' }
  if (f.name === 'RailCross' || f.name === 'RailSwitch') {
    return { ok: false, reason: '交叉與分岔的中心線由口與各段決定，不能這樣重建' }
  }
  const size = resolveFacilityAreaSize(f, area.domain, area.layout)
  const faces = facesOf(f, size)
  if (!faces) return { ok: false, reason: '這種軌道沒有可接的端面' }

  const anchors = collectAnchors(area)
  const ends = faces.map((handle) => {
    const uv = faceUv(handle, size)
    const local = trackLocalPathPointToAreaLocal(f, area, { x: uv.x, y: uv.y })
    return { uv, anchor: nearestAnchor(anchors, local.x, local.y, f.id) }
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
  return {
    ok: true,
    changedM,
    facility: {
      ...f,
      parameters: patchRefFieldBounds(parameters, {
        xMinM: Number(Math.min(...xs).toFixed(2)),
        xMaxM: Number(Math.max(...xs).toFixed(2)),
        yMinM: Number(Math.min(...ys).toFixed(2)),
        yMaxM: Number(Math.max(...ys).toFixed(2)),
      }),
    } as FacilityObject,
  }
}

/** 過期才重建：沒過期回 null（呼叫端不必動它） */
export function rederiveIfStale(f: FacilityObject, area: MapAreaObject): RederiveResult | null {
  if (findStaleTrackPathEnds(f, area).length === 0) return null
  return rederiveTrackPath(f, area)
}
