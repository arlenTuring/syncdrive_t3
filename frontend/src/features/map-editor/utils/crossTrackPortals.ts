import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveFacilityAreaSize } from './facilityAreaCoords'
import { fieldMetersAtAreaLocal } from './fieldFromArea'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'
import { getValidRefFieldBounds } from './facilityRefFieldBounds'
import { getTrackGenPaths } from './trackGenPaths'
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

/** 口與隔壁方塊端點視為同一點的圖面距離（區域座標）。交叉的外框不大，超過就不是鄰居了。 */
export const CROSS_PORTAL_NEAR_PX = 30

/** 鄰居端點與方框內插的估計值最多差多少公尺（內插實測差 2–6 公尺）。 */
export const CROSS_PORTAL_FIELD_SLACK_M = 15

/**
 * 貼著這個口的隔壁軌道，取它中心線的那一端在現場的位置。
 *
 * 口的定義是「這裡接上隔壁那一塊」，答案在隔壁：外接方框的角不是軌道的端點——照方框
 * 內插算出來的座標實測差 2–6 公尺，上下兩個口甚至會對調（圖面的左上口，現場其實貼著
 * 目錄裡的左下口）。找不到隔壁回 null，由呼叫端退回方框內插。
 */
export function neighbourEndField(
  facility: FacilityObject,
  area: MapAreaObject,
  handle: { x: number; y: number },
  estimate: { xM: number; yM: number },
): { xM: number; yM: number } | null {
  let best: { d: number; xM: number; yM: number } | null = null
  for (const other of area.facilities ?? []) {
    if (other.id === facility.id) continue
    const paths = getTrackGenPaths(other.parameters)
    if (!paths) continue
    const ends: Array<[number, number][]> = [
      [paths.local[0]!, paths.real[0]!],
      [paths.local[paths.local.length - 1]!, paths.real[paths.real.length - 1]!],
    ]
    for (const [uv, field] of ends) {
      const at = trackLocalPathPointToAreaLocal(other, area, { x: uv![0], y: uv![1] })
      const d = Math.hypot(at.x - handle.x, at.y - handle.y)
      if (d > CROSS_PORTAL_NEAR_PX) continue
      if (best && d >= best.d) continue
      // 圖面上貼著、現場卻差很遠：那一塊的現場座標是別處抄來的，不算鄰居
      if (Math.hypot(field![0] - estimate.xM, field![1] - estimate.yM) > CROSS_PORTAL_FIELD_SLACK_M) continue
      best = { d, xM: field![0], yM: field![1] }
    }
  }
  return best ? { xM: best.xM, yM: best.yM } : null
}

/**
 * 四個口<strong>現在</strong>在現場的哪裡。
 *
 * 人工填過以人工為準；否則取貼著這個口的隔壁軌道的端點；都沒有才照外接方框內插。
 */
/** 內插估計離中心線頭尾多近（公尺）才改用中心線頭尾 */
const CROSS_PORT_SNAP_M = 15

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
    /*
     * 口若已綁在接點上，現場座標就是接點的——接點只存一份，見 utils/trackJoints。
     * 這裡直接讀資料而不 import trackJoints（那支會反過來依賴本檔）。
     */
    const ends = facility.parameters?.trackGenEnds as Record<string, unknown> | undefined
    const jointId = typeof ends?.[key] === 'string' ? (ends[key] as string) : null
    const joint = jointId ? area.trackJoints?.find((j) => j.id === jointId) : undefined
    if (joint) {
      out[key] = { xM: joint.xM, yM: joint.yM, auto: true }
      continue
    }
    const h = handles[key]
    const local = trackLocalPathPointToAreaLocal(facility, area, {
      x: h.x / Math.max(1e-6, size.w),
      y: h.y / Math.max(1e-6, size.h),
    })
    const field = fieldMetersAtAreaLocal(area, local.x, local.y, {
      preferTrackId: facility.id,
    })
    const unit = { x: h.x / Math.max(1e-6, size.w), y: h.y / Math.max(1e-6, size.h) }
    const neighbour = neighbourEndField(facility, area, local, field)
    if (neighbour) {
      out[key] = { ...neighbour, auto: true }
      continue
    }
    /*
     * 沒有鄰居：照參照場域範圍內插——模擬器與站點目錄用的就是這個，兩邊的途經點座標
     * 才會一致。範圍不可信才退回圖面換算。
     */
    const bounds = getValidRefFieldBounds(facility.parameters)
    const interpolated = bounds
      ? {
          xM: bounds.xMinM + (bounds.xMaxM - bounds.xMinM) * unit.x,
          yM: bounds.yMaxM - (bounds.yMaxM - bounds.yMinM) * unit.y,
        }
      : { xM: field.xM, yM: field.yM }
    /*
     * 範圍內插只是粗估（範圍是外接方框，不是口的位置；T3 的 lt 口估到 y = −2.6，實際在 −14.6）。
     * 交叉軌道自己的中心線頭尾就是兩個斜向的口，離估計值夠近就用它——新拉的軌道接到還沒有鄰居的
     * 口時，才不會把錯的估計值傳給隔壁、再存成接點。
     */
    const real = getTrackGenPaths(facility.parameters)?.real
    const realEnds = real ? [real[0]!, real[real.length - 1]!] : []
    let best: [number, number] | null = null
    let bestD = CROSS_PORT_SNAP_M
    for (const e of realEnds) {
      const d = Math.hypot(e[0] - interpolated.xM, e[1] - interpolated.yM)
      if (d < bestD) {
        best = e
        bestD = d
      }
    }
    out[key] = best
      ? { xM: best[0], yM: best[1], auto: true }
      : { ...interpolated, auto: true }
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
