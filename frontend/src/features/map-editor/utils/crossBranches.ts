import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveFacilityAreaSize } from './facilityAreaCoords'
import {
  CROSS_ROUTE_ENDS,
  CROSS_ROUTE_KEYS,
  getCrossRoutes,
  resolveCrossPortalFields,
  type CrossPortalKey,
  type CrossRouteKey,
} from './crossTrackPortals'
import {
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
  TRACKGEN_SPANS_KEY,
  type PathXY,
} from './trackGenPaths'
import { getTrackGenPartNames } from './trackGenParts'
import { getTrackGenPaths } from './trackGenPaths'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import { neighbourEndField } from './crossTrackPortals'
import {
  crossTrackHandlesPx,
  readCrossTrack,
  readSwitchTrack,
  switchTrackHandlesPx,
  type SwitchHandleKey,
} from './trackShapes'

/** 分岔的兩條路徑：直行（進口 → 直行出口）與岔出（進口 → 岔出出口） */
export type SwitchBranchKey = 'straight' | 'branch'

/**
 * 交叉軌道的分支：每一條通行的路徑（斜行、直行）各自是一條有自己中心線的軌道。
 *
 * <h3>為什麼要拆</h3>
 * 生成出來的交叉軌道只有<strong>一條</strong>折線（頭尾連線）：圖面上畫了兩條斜線，現場
 * 卻只記得中間那一條。下行轉線的車與上行轉線的車都被算到同一條線上，車輛被畫在方框的
 * 中線，而不是它實際走的那條斜線；兩條線在外側相差幾公尺，定位的偏移量也就一起失真。
 *
 * 拆開之後每個分支有自己的<strong>端點、方向、圖面中心線、現場中心線</strong>，端點就是
 * 隔壁軌道接進來的那一端，所以跟鄰居自然相連（換塊判定與沿路補間照端點接起來）。
 */

/** 分支代號，跟 {@link CrossRouteKey} 一一對應 */
export const CROSS_BRANCH_SUFFIX: Record<CrossRouteKey, string> = {
  straightTop: 'STRAIGHT_TOP',
  straightBottom: 'STRAIGHT_BOTTOM',
  diagDown: 'DIAG_DOWN',
  diagUp: 'DIAG_UP',
}

/** 分支設施 id 與母體 id 的分隔；母體 id 本身不含它 */
export const CROSS_BRANCH_ID_SEPARATOR = '~'

/** 每條路徑在屬性框「軌道分段命名」裡對應哪一段 */
const CROSS_ROUTE_PART: Record<CrossRouteKey, 'up' | 'down' | 'diagUp' | 'diagDown'> = {
  straightTop: 'up',
  straightBottom: 'down',
  diagDown: 'diagDown',
  diagUp: 'diagUp',
}

export type CrossBranch = {
  /** 穩定代號，如 D03U03_DIAG_UP：改設施 id 之外也不變，給訂單／任務記「預期走哪一條」 */
  code: string
  /** 使用者在屬性框幫這一段取的名字；沒取為 null。圖上的車輛標籤與診斷優先顯示它 */
  name: string | null
  /** 分支設施 id（母體 id + ~ + 後綴） */
  facilityId: string
  parentId: string
  /** 交叉：CrossRouteKey；分岔：'straight'／'branch' */
  route: CrossRouteKey | SwitchBranchKey
  /** 行車方向的起訖口（'both' 時是 CROSS_ROUTE_ENDS 的順序）；分岔是 a／m／b */
  from: CrossPortalKey | SwitchHandleKey
  to: CrossPortalKey | SwitchHandleKey
  bidirectional: boolean
  /** 現場中心線（公尺），照行車方向排 */
  real: PathXY
  /** 圖面中心線（未旋轉外框的 0–1 比例，v 向下），與 real 一一對應 */
  local: PathXY
  lengthM: number
}

function codeOfFacility(f: FacilityObject): string {
  const raw = (f.customName?.trim() || f.id).replace(/[^A-Za-z0-9]/g, '')
  return raw || f.id
}

export function crossBranchFacilityId(parentId: string, route: CrossRouteKey): string {
  return `${parentId}${CROSS_BRANCH_ID_SEPARATOR}${CROSS_BRANCH_SUFFIX[route]}`
}

/** 分支設施 id 指回母體；不是分支回原值 */
export function parentFacilityIdOfBranch(id: string): string {
  const i = id.indexOf(CROSS_BRANCH_ID_SEPARATOR)
  return i < 0 ? id : id.slice(0, i)
}

/** 這個口在圖面外框內的位置（0–1，v 向下） */
function portalUnits(facility: FacilityObject, area: MapAreaObject) {
  const size = resolveFacilityAreaSize(facility, area.domain, area.layout)
  const handles = crossTrackHandlesPx(readCrossTrack(facility.parameters), size.w, size.h)
  const unit = (k: CrossPortalKey) => ({
    x: handles[k].x / Math.max(1e-6, size.w),
    y: handles[k].y / Math.max(1e-6, size.h),
  })
  return { lt: unit('lt'), lb: unit('lb'), rt: unit('rt'), rb: unit('rb') }
}

/** 兩個口太近就不是一條路了 */
const MIN_BRANCH_M = 1

export function deriveCrossBranches(
  facility: FacilityObject,
  area: MapAreaObject,
): CrossBranch[] {
  if (facility.type !== 'Track' || facility.name !== 'RailCross') return []
  const routes = getCrossRoutes(facility)
  const fields = resolveCrossPortalFields(facility, area)
  const units = portalUnits(facility, area)
  const code = codeOfFacility(facility)
  const partNames = getTrackGenPartNames(facility)
  const out: CrossBranch[] = []
  for (const route of CROSS_ROUTE_KEYS) {
    /*
     * 「不通」只影響路線規劃，不代表那條軌道不存在。
     *
     * 交叉軌道同時是<strong>正線本身</strong>：直行兩條就是正線的兩條車道（D02 進、D04 出），
     * 車照樣從那裡開過去，只是規劃路線時不把它當成可選的轉線。少了它，正線上的車在推導出
     * 的軌道裡只剩兩條斜線可挑，被吸到斜線上，圖上就是車頭左右歪、位置上下跳。
     * 所以幾何一律推導；方向照設定，不通的當成雙向（只用來定位）。
     */
    const configured = routes[route]
    const direction = configured === 'off' ? 'both' : configured
    const [a, b] = CROSS_ROUTE_ENDS[route]
    const from = direction === 'reverse' ? b : a
    const to = direction === 'reverse' ? a : b
    const p = fields[from]
    const q = fields[to]
    if (p.xM === null || p.yM === null || q.xM === null || q.yM === null) continue
    const lengthM = Math.hypot(q.xM - p.xM, q.yM - p.yM)
    if (lengthM < MIN_BRANCH_M) continue
    out.push({
      code: `${code}_${CROSS_BRANCH_SUFFIX[route]}`,
      name: partNames[CROSS_ROUTE_PART[route]] ?? null,
      facilityId: crossBranchFacilityId(facility.id, route),
      parentId: facility.id,
      route,
      from,
      to,
      bidirectional: direction === 'both',
      real: [
        [p.xM, p.yM],
        [q.xM, q.yM],
      ],
      local: [
        [units[from].x, units[from].y],
        [units[to].x, units[to].y],
      ],
      lengthM,
    })
  }
  return out
}

function polylineLength(path: PathXY): number {
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
  }
  return total
}

/**
 * 分岔（RailSwitch）拆成直行與岔出兩條。
 *
 * <h3>為什麼要拆</h3>
 * 生成出來的分岔只記<strong>一條</strong>折線，而且是「進口 → 岔出」那條（road 12 這種連接路），
 * 圖面路徑卻畫成直行的橫線。於是主線上的車被換算到岔線的現場座標：D02→D04→D05 的正線，
 * 在 D04/T01 那一塊繞去岔線的方向再繞回來，最遠偏 8 公尺——圖上就是車突然斜插出去又折回。
 *
 * <h3>三個口的現場座標</h3>
 * 進口取折線靠進口那一端。直行、岔出出口取貼著該口的隔壁軌道的端點（與交叉軌道同一套）；
 * 只有一個口找得到鄰居時（岔出去的另一頭通往場區入口點，不是軌道），沒鄰居的那一口取折線
 * 的另一端——那條折線本來就是通往它的。兩個口都沒鄰居就不拆，維持原樣。
 */
export function deriveSwitchBranches(
  facility: FacilityObject,
  area: MapAreaObject,
): CrossBranch[] {
  if (facility.type !== 'Track' || facility.name !== 'RailSwitch') return []
  const stored = getTrackGenPaths(facility.parameters)
  if (!stored || stored.real.length < 2 || stored.local.length < 2) return []
  const size = resolveFacilityAreaSize(facility, area.domain, area.layout)
  const handles = switchTrackHandlesPx(readSwitchTrack(facility.parameters), size.w, size.h)
  const unit = (k: SwitchHandleKey) => ({
    x: handles[k].x / Math.max(1e-6, size.w),
    y: handles[k].y / Math.max(1e-6, size.h),
  })
  const units = { a: unit('a'), m: unit('m'), b: unit('b') }

  // 折線的哪一端在進口那一側：圖面路徑兩端裡離進口口較近的那一端
  const dist = (uv: [number, number], k: SwitchHandleKey) =>
    Math.hypot(uv[0] - units[k].x, uv[1] - units[k].y)
  const head = stored.local[0]!
  const tail = stored.local[stored.local.length - 1]!
  const aAtHead = dist(head as [number, number], 'a') <= dist(tail as [number, number], 'a')
  const real = aAtHead ? stored.real : [...stored.real].reverse()
  const aPoint = real[0]!
  const farPoint = real[real.length - 1]!

  const neighbour = (k: 'm' | 'b'): [number, number] | null => {
    const at = trackLocalPathPointToAreaLocal(facility, area, units[k])
    // 兩個出口離折線遠端都不遠；口自己的現場位置換算不出來（沒有對應的中心線），拿遠端當粗估
    const hit = neighbourEndField(facility, area, at, { xM: farPoint[0], yM: farPoint[1] })
    return hit ? [hit.xM, hit.yM] : null
  }
  let m = neighbour('m')
  let b = neighbour('b')
  const near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2
  let branchPath: PathXY | null = null
  if (m && !b && !near(m, farPoint)) {
    b = farPoint
    branchPath = real
  } else if (b && !m && !near(b, farPoint)) {
    m = farPoint
  }
  if (!m || !b) return []

  const code = codeOfFacility(facility)
  const partNames = getTrackGenPartNames(facility)
  const make = (
    route: SwitchBranchKey,
    to: SwitchHandleKey,
    path: PathXY,
  ): CrossBranch | null => {
    const lengthM = polylineLength(path)
    if (lengthM < MIN_BRANCH_M) return null
    return {
      code: `${code}_${route === 'straight' ? 'STRAIGHT' : 'BRANCH'}`,
      name: partNames[route] ?? null,
      facilityId: `${facility.id}${CROSS_BRANCH_ID_SEPARATOR}${route === 'straight' ? 'STRAIGHT' : 'BRANCH'}`,
      parentId: facility.id,
      route,
      from: 'a',
      to,
      // 分岔的兩條腿都能雙向開（進場、出場都會走），定位時方向不加減分
      bidirectional: true,
      real: path,
      local: [
        [units.a.x, units.a.y],
        [units[to].x, units[to].y],
      ],
      lengthM,
    }
  }
  const out: CrossBranch[] = []
  const straight = make('straight', 'm', [aPoint as [number, number], m])
  const branch = make('branch', 'b', branchPath ?? [aPoint as [number, number], b])
  if (straight) out.push(straight)
  if (branch) out.push(branch)
  return out
}

/** 分支換成一塊「像普通生成軌道」的設施：自己的兩條中心線與車道，其餘沿用母體 */
export function crossBranchToFacility(parent: FacilityObject, branch: CrossBranch): FacilityObject {
  const first = branch.real[0]!
  const last = branch.real[branch.real.length - 1]!
  const heading = Math.atan2(last[1] - first[1], last[0] - first[0])
  const span = (lane: number, h: number) => ({
    road: branch.code,
    lane,
    s0: 0,
    s1: branch.lengthM,
    h,
    f0: 0,
    f1: 1,
  })
  return {
    ...parent,
    id: branch.facilityId,
    // 車輛標籤顯示這一條的名字；沒取名就沿用母體的
    customName: branch.name ?? parent.customName,
    parameters: {
      ...parent.parameters,
      [TRACKGEN_REAL_PATH_KEY]: branch.real,
      [TRACKGEN_LOCAL_PATH_KEY]: branch.local,
      // 雙向的分支掛正負兩條車道：定位時車頭朝哪邊都不扣分
      [TRACKGEN_SPANS_KEY]: branch.bidirectional
        ? [span(-1, heading), span(1, heading + Math.PI)]
        : [span(-1, heading)],
      crossBranch: {
        code: branch.code,
        parentId: branch.parentId,
        route: branch.route,
        from: branch.from,
        to: branch.to,
      },
    },
  }
}

const derivedByAreas = new WeakMap<MapAreaObject[], MapAreaObject[]>()

/**
 * 車輛定位用的區域：每一塊交叉軌道換成它的分支們。
 *
 * 只給「車在哪裡」這一類的查詢用；編輯器、路線規劃、存檔仍然是原本的區域——分支是
 * 推導出來的，不寫回圖檔。沒有交叉軌道（或推導不出任何分支）就原樣回傳同一個陣列。
 */
export function withCrossBranchTracks(areas: MapAreaObject[]): MapAreaObject[] {
  const cached = derivedByAreas.get(areas)
  if (cached) return cached
  let changed = false
  const next = areas.map((area) => {
    let touched = false
    const facilities: FacilityObject[] = []
    for (const f of area.facilities ?? []) {
      const branches =
        f.name === 'RailSwitch' ? deriveSwitchBranches(f, area) : deriveCrossBranches(f, area)
      if (!branches.length) {
        facilities.push(f)
        continue
      }
      touched = true
      for (const b of branches) facilities.push(crossBranchToFacility(f, b))
    }
    if (!touched) return area
    changed = true
    return { ...area, facilities }
  })
  const result = changed ? next : areas
  derivedByAreas.set(areas, result)
  derivedByAreas.set(result, result)
  return result
}
