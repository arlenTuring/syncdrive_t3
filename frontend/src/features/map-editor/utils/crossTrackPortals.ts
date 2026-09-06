import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveFacilityAreaSize } from './facilityAreaCoords'
import { fieldMetersAtAreaLocal } from './fieldFromArea'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import {
  CROSS_HANDLE_KEYS,
  crossTrackHandlesPx,
  readCrossTrack,
  type CrossHandleKey,
} from './trackShapes'

/**
 * 交叉軌道的四個連接點與四條路徑。
 *
 * <h3>為什麼要記這些</h3>
 * 交叉軌道是路網上的一個節點：車子從哪個口進、往哪個口出，排班與路徑規劃都要知道。
 * 虛擬渡線靠兩個端點記這件事，交叉軌道有四個口、四條路徑，所以兩邊都要記——口記
 * 途經點代號，路徑記方向。
 *
 * <h3>方向為什麼要用填的</h3>
 * 虛擬渡線的方向是<strong>畫出來的</strong>：先點哪一端就往哪邊走。交叉軌道四個口
 * 是接合出來的，沒有先後可言，所以方向只能另外指定。
 */

export const CROSS_PORTAL_KEYS = CROSS_HANDLE_KEYS
export type CrossPortalKey = CrossHandleKey

export type CrossPortalState = {
  /** 途經點代號 */
  waypointCode: string
  /** 別名（顯示名稱） */
  alias?: string
  /** 現場實際位置（場域公尺）；未填時為 null */
  xM: number | null
  yM: number | null
}

export type CrossPortals = Record<CrossPortalKey, CrossPortalState>

export const CROSS_PORTALS_KEY = 'crossTrackPortals'
export const CROSS_ROUTES_KEY = 'crossTrackRoutes'

/**
 * 四條路徑。前兩條是直行，後兩條是斜行——與 {@link crossTrackPath} 畫的一致：
 * 本體是兩條直行，斜的用虛線疊上去。
 */
export const CROSS_ROUTE_KEYS = ['straightTop', 'straightBottom', 'diagDown', 'diagUp'] as const
export type CrossRouteKey = (typeof CROSS_ROUTE_KEYS)[number]

/** 每條路徑由哪兩個口相連（順序就是「正向」的定義） */
export const CROSS_ROUTE_ENDS: Record<CrossRouteKey, [CrossPortalKey, CrossPortalKey]> = {
  straightTop: ['lt', 'rt'],
  straightBottom: ['lb', 'rb'],
  diagDown: ['lt', 'rb'],
  diagUp: ['lb', 'rt'],
}

/** 不通／雙向／正向（第一個口往第二個）／反向 */
export type CrossRouteDirection = 'off' | 'both' | 'forward' | 'reverse'
export const CROSS_ROUTE_DIRECTIONS: readonly CrossRouteDirection[] = [
  'both',
  'forward',
  'reverse',
  'off',
]

export type CrossRoutes = Record<CrossRouteKey, CrossRouteDirection>

/*
 * 預設四條全開、全雙向。
 *
 * 這個元件的意義就是「四個口互相都通」；要做成只走斜的（菱形交叉）或只走直的，把
 * 不要的那兩條關掉即可。預設全關會讓剛放下去的元件在路網上等於不存在，比較難發現。
 */
export const DEFAULT_CROSS_ROUTES: CrossRoutes = {
  straightTop: 'both',
  straightBottom: 'both',
  diagDown: 'both',
  diagUp: 'both',
}

function readNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readPortal(raw: unknown, fallbackCode: string): CrossPortalState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<CrossPortalState>
  const code = typeof o.waypointCode === 'string' ? o.waypointCode.trim() : ''
  const alias = typeof o.alias === 'string' ? o.alias.trim() : ''
  return {
    waypointCode: code || fallbackCode,
    ...(alias ? { alias } : {}),
    xM: readNum(o.xM),
    yM: readNum(o.yM),
  }
}

/** 沒填代號時的預設值：元件 id 加口的代號，同一張圖不會撞 */
export function defaultCrossPortalCode(facilityId: string, key: CrossPortalKey): string {
  return `xc_${facilityId}_${key}`
}

export function getCrossPortals(facility: FacilityObject): CrossPortals {
  const raw = facility.parameters?.[CROSS_PORTALS_KEY]
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return Object.fromEntries(
    CROSS_PORTAL_KEYS.map((k) => [k, readPortal(o[k], defaultCrossPortalCode(facility.id, k))]),
  ) as CrossPortals
}

export function getCrossRoutes(facility: FacilityObject): CrossRoutes {
  const raw = facility.parameters?.[CROSS_ROUTES_KEY]
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const one = (k: CrossRouteKey): CrossRouteDirection =>
    CROSS_ROUTE_DIRECTIONS.includes(o[k] as CrossRouteDirection)
      ? (o[k] as CrossRouteDirection)
      : DEFAULT_CROSS_ROUTES[k]
  return Object.fromEntries(CROSS_ROUTE_KEYS.map((k) => [k, one(k)])) as CrossRoutes
}

/** 只改一個口的一個欄位，其餘原封不動 */
export function patchCrossPortal(
  facility: FacilityObject,
  key: CrossPortalKey,
  patch: Partial<CrossPortalState>,
): Record<string, unknown> {
  const portals = getCrossPortals(facility)
  const next: CrossPortals = { ...portals, [key]: { ...portals[key], ...patch } }
  return { [CROSS_PORTALS_KEY]: next }
}

export function patchCrossRoute(
  facility: FacilityObject,
  key: CrossRouteKey,
  direction: CrossRouteDirection,
): Record<string, unknown> {
  return { [CROSS_ROUTES_KEY]: { ...getCrossRoutes(facility), [key]: direction } }
}

/**
 * 四個口<strong>現在</strong>在現場的哪裡。
 *
 * 連接點就固定在那一面的中點上——與 .xodr 的交會點對齊，是接合時就決定好的，不該
 * 讓使用者去填。所以座標由圖上的位置反推：接好、移動、縮放、旋轉之後都自己跟上。
 *
 * 手填的值只當<strong>覆寫</strong>：填了就用填的，清空就回到自動。
 */
export function resolveCrossPortalFields(
  facility: FacilityObject,
  area: MapAreaObject | null | undefined,
): Record<CrossPortalKey, { xM: number | null; yM: number | null; auto: boolean }> {
  const portals = getCrossPortals(facility)
  const out = {} as Record<
    CrossPortalKey,
    { xM: number | null; yM: number | null; auto: boolean }
  >
  const geom = readCrossTrack(facility.parameters)
  const size = area
    ? resolveFacilityAreaSize(facility, area.domain, area.layout)
    : { w: 1, h: 1 }
  const handles = crossTrackHandlesPx(geom, size.w, size.h)
  for (const key of CROSS_PORTAL_KEYS) {
    const manual = portals[key]
    if (manual.xM !== null && manual.yM !== null) {
      out[key] = { xM: manual.xM, yM: manual.yM, auto: false }
      continue
    }
    if (!area) {
      out[key] = { xM: null, yM: null, auto: true }
      continue
    }
    const h = handles[key]
    const local = trackLocalPathPointToAreaLocal(facility, area, {
      x: h.x / Math.max(1e-6, size.w),
      y: h.y / Math.max(1e-6, size.h),
    })
    const field = fieldMetersAtAreaLocal(area, local.x, local.y)
    out[key] = { xM: field.xM, yM: field.yM, auto: true }
  }
  return out
}
