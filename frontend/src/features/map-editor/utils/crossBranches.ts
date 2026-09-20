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
import { crossTrackHandlesPx, readCrossTrack } from './trackShapes'

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
  route: CrossRouteKey
  /** 行車方向的起訖口（'both' 時是 CROSS_ROUTE_ENDS 的順序） */
  from: CrossPortalKey
  to: CrossPortalKey
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

/** 分支換成一塊「像普通生成軌道」的設施：自己的兩條中心線與車道，其餘沿用母體 */
export function crossBranchToFacility(parent: FacilityObject, branch: CrossBranch): FacilityObject {
  const [[x0, y0], [x1, y1]] = branch.real
  const heading = Math.atan2(y1 - y0, x1 - x0)
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
      const branches = deriveCrossBranches(f, area)
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
