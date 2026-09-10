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
 */

export const CROSS_PORTAL_KEYS = CROSS_HANDLE_KEYS
export type CrossPortalKey = CrossHandleKey

/**
 * 屬性框／清單顯示順序：左上 → 右下 → 左下 → 右上
 * （對應兩條斜行路徑的兩端：↘ 的頭尾、↗ 的頭尾）
 */
export const CROSS_PORTAL_UI_ORDER: readonly CrossPortalKey[] = [
  'lt',
  'rb',
  'lb',
  'rt',
]

/** 在圖台上短暫標示某一個口（屬性框提示鈕） */
type CrossPortalPing = {
  facilityId: string
  key: CrossPortalKey
  seq: number
}

let crossPortalPing: CrossPortalPing | null = null
const crossPortalPingListeners = new Set<() => void>()

export function pingCrossPortal(facilityId: string, key: CrossPortalKey): void {
  crossPortalPing = {
    facilityId,
    key,
    seq: (crossPortalPing?.seq ?? 0) + 1,
  }
  for (const listener of crossPortalPingListeners) listener()
}

export function getCrossPortalPing(): CrossPortalPing | null {
  return crossPortalPing
}

export function subscribeCrossPortalPing(listener: () => void): () => void {
  crossPortalPingListeners.add(listener)
  return () => {
    crossPortalPingListeners.delete(listener)
  }
}

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
/** 圖台上是否顯示四個口的途經點代號／別名；預設不顯示 */
export const CROSS_SHOW_PORTAL_LABELS_KEY = 'crossShowPortalLabels'

/** 圖台上要不要畫四個口的標籤（代號或別名） */
export function getCrossShowPortalLabels(facility: FacilityObject): boolean {
  return facility.parameters?.[CROSS_SHOW_PORTAL_LABELS_KEY] === true
}

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

/** 拓樸節點 id 前綴：xcwp:<facilityId>:lt|lb|rt|rb */
export const CROSS_PORTAL_TOPOLOGY_ID_PREFIX = 'xcwp:'

export function crossPortalTopologyNodeId(
  facilityId: string,
  key: CrossPortalKey,
): string {
  return `${CROSS_PORTAL_TOPOLOGY_ID_PREFIX}${facilityId}:${key}`
}

export function parseCrossPortalTopologyNodeId(
  nodeId: string,
): { facilityId: string; key: CrossPortalKey } | null {
  if (!nodeId.startsWith(CROSS_PORTAL_TOPOLOGY_ID_PREFIX)) return null
  const rest = nodeId.slice(CROSS_PORTAL_TOPOLOGY_ID_PREFIX.length)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0) return null
  const facilityId = rest.slice(0, lastColon).trim()
  const key = rest.slice(lastColon + 1).trim()
  if (!facilityId || !(CROSS_PORTAL_KEYS as readonly string[]).includes(key)) return null
  return { facilityId, key: key as CrossPortalKey }
}

export function resolveCrossPortalDisplayName(portal: CrossPortalState): string {
  const alias = typeof portal.alias === 'string' ? portal.alias.trim() : ''
  if (alias) return alias
  const code = portal.waypointCode?.trim() ?? ''
  return code || '途經點'
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

/** 斜行虛線顏色（左上↘右下；對應 diagDown） */
export const CROSS_DIAG_STROKE_DOWN_KEY = 'crossDiagStrokeColorDown'
/** 斜行虛線顏色（左下↗右上；對應 diagUp） */
export const CROSS_DIAG_STROKE_UP_KEY = 'crossDiagStrokeColorUp'

export const DEFAULT_CROSS_DIAG_STROKE_DOWN = '#86efac'
export const DEFAULT_CROSS_DIAG_STROKE_UP = '#fbbf24'

function readCssColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const s = raw.trim()
  if (!s || s === 'transparent') return fallback
  return s
}

/** 交叉軌道兩組斜行虛線顏色（未設則用預設綠／琥珀） */
export function getCrossDiagStrokeColors(f: FacilityObject): {
  down: string
  up: string
} {
  const p = f.parameters ?? {}
  return {
    down: readCssColor(p[CROSS_DIAG_STROKE_DOWN_KEY], DEFAULT_CROSS_DIAG_STROKE_DOWN),
    up: readCssColor(p[CROSS_DIAG_STROKE_UP_KEY], DEFAULT_CROSS_DIAG_STROKE_UP),
  }
}
