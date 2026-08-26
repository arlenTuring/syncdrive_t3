import { LABEL_STYLE_PARAM_KEY } from './facilityLabelStyle'
import type { FacilityObject } from '../types/facility'
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'

export const TRACK_CROSSOVER_COLOR_KEY = 'trackCrossoverColor'
/** 邊緣線色透明度 0–100 */
export const TRACK_CROSSOVER_COLOR_OPACITY_KEY = 'trackCrossoverColorOpacity'
export const TRACK_CROSSOVER_STROKE_PX_KEY = 'trackCrossoverStrokePx'
/** 中間線段消失程度 0–100（從中心向兩端對稱張開） */
export const TRACK_CROSSOVER_CENTER_GAP_PCT_KEY = 'trackCrossoverCenterGapPct'
/** 線徑走廊背景色；缺省／空＝無背景 */
export const TRACK_CROSSOVER_BG_COLOR_KEY = 'trackCrossoverBgColor'
/** 背景透明度 0–100（僅在有背景色時生效） */
export const TRACK_CROSSOVER_BG_OPACITY_KEY = 'trackCrossoverBgOpacity'
export const TRACK_CROSSOVER_PORTALS_KEY = 'trackCrossoverPortals'

export const DEFAULT_TRACK_CROSSOVER_COLOR = '#94a3b8'
export const DEFAULT_TRACK_CROSSOVER_COLOR_OPACITY = 100
export const MIN_TRACK_CROSSOVER_COLOR_OPACITY = 5
export const MAX_TRACK_CROSSOVER_COLOR_OPACITY = 100
/** 線徑總寬（兩邊緣線間距），非單線粗細 */
export const DEFAULT_TRACK_CROSSOVER_STROKE_PX = 12
export const MIN_TRACK_CROSSOVER_STROKE_PX = 6
export const MAX_TRACK_CROSSOVER_STROKE_PX = 48
/** 邊緣線本身固定線粗（調寬時不變） */
export const TRACK_CROSSOVER_EDGE_STROKE_PX = 2
export const DEFAULT_TRACK_CROSSOVER_CENTER_GAP_PCT = 0
export const MIN_TRACK_CROSSOVER_CENTER_GAP_PCT = 0
export const MAX_TRACK_CROSSOVER_CENTER_GAP_PCT = 95
/** 預設無背景；使用者選色後才寫入 */
export const DEFAULT_TRACK_CROSSOVER_BG_OPACITY = 35
export const MIN_TRACK_CROSSOVER_BG_OPACITY = 0
export const MAX_TRACK_CROSSOVER_BG_OPACITY = 100

/** 吸附接合／拉開斷開（場域公尺） */
export const CROSSOVER_ATTACH_SNAP_M = 3.5
export const CROSSOVER_DETACH_SNAP_M = 5.5
/** 拖曳時標示鄰近軌道／顯示勾子的預覽距離 */
export const CROSSOVER_HOOK_PREVIEW_M = 16

/** 單一條線徑的兩端 */
export type CrossoverPortalKey = 'a' | 'b'

export const CROSSOVER_PORTAL_KEYS: readonly CrossoverPortalKey[] = [
  'a',
  'b',
] as const

export type CrossoverPortalState = {
  /**
   * 端點在<strong>圖面</strong>上的位置（公尺）。渲染、AABB、路徑幾何都用這一對。
   * 拖動端點或磁吸接合時更新。
   */
  xM: number
  yM: number
  /**
   * 端點在<strong>現場</strong>的位置（公尺）。
   *
   * 與 xM／yM 分開，理由和設施的 refField 一樣：圖面位置是畫給人看的，現場位置
   * 是實際量到的，兩者本來就可以不一致。共用同一對數值時，改一個現場座標就會把
   * 圖上的端點拉走——那不是使用者的意思。
   *
   * 舊圖資沒有這一對，讀取時退回 xM／yM（見 {@link crossoverPortalFieldMeters}）。
   */
  refFieldXM?: number
  refFieldYM?: number
  /** 已接合軌道；null＝未接合 */
  attachedTrackId: string | null
  /** 端點內建途經點代號（路線／拓樸對外 ID） */
  waypointCode: string
  /** 別名；空則顯示代號 */
  alias?: string
}

export type CrossoverPortals = Record<CrossoverPortalKey, CrossoverPortalState>

/** 拓樸節點 id 前綴：xowp:<facilityId>:a|b */
export const CROSSOVER_PORTAL_TOPOLOGY_ID_PREFIX = 'xowp:'

export function crossoverPortalTopologyNodeId(
  facilityId: string,
  key: CrossoverPortalKey,
): string {
  return `${CROSSOVER_PORTAL_TOPOLOGY_ID_PREFIX}${facilityId}:${key}`
}

export function parseCrossoverPortalTopologyNodeId(
  nodeId: string,
): { facilityId: string; key: CrossoverPortalKey } | null {
  if (!nodeId.startsWith(CROSSOVER_PORTAL_TOPOLOGY_ID_PREFIX)) return null
  const rest = nodeId.slice(CROSSOVER_PORTAL_TOPOLOGY_ID_PREFIX.length)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0) return null
  const facilityId = rest.slice(0, lastColon).trim()
  const key = rest.slice(lastColon + 1).trim()
  if (!facilityId || (key !== 'a' && key !== 'b')) return null
  return { facilityId, key }
}

export function resolveCrossoverPortalDisplayName(
  portal: CrossoverPortalState,
): string {
  const alias = typeof portal.alias === 'string' ? portal.alias.trim() : ''
  if (alias) return alias
  const code = portal.waypointCode?.trim() ?? ''
  return code || '途經點'
}

export function parseTrackCrossoverColor(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return DEFAULT_TRACK_CROSSOVER_COLOR
}

export function parseTrackCrossoverColorOpacity(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampTrackCrossoverColorOpacity(raw)
  }
  return DEFAULT_TRACK_CROSSOVER_COLOR_OPACITY
}

export function clampTrackCrossoverColorOpacity(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_TRACK_CROSSOVER_COLOR_OPACITY
  return Math.min(
    MAX_TRACK_CROSSOVER_COLOR_OPACITY,
    Math.max(MIN_TRACK_CROSSOVER_COLOR_OPACITY, raw),
  )
}

/** null＝無背景（預設） */
export function parseTrackCrossoverBgColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t === 'none' || t === 'transparent') return null
  return t
}

export function parseTrackCrossoverBgOpacity(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampTrackCrossoverBgOpacity(raw)
  }
  return DEFAULT_TRACK_CROSSOVER_BG_OPACITY
}

export function clampTrackCrossoverBgOpacity(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_TRACK_CROSSOVER_BG_OPACITY
  return Math.min(
    MAX_TRACK_CROSSOVER_BG_OPACITY,
    Math.max(MIN_TRACK_CROSSOVER_BG_OPACITY, raw),
  )
}

export function parseTrackCrossoverStrokePx(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(
      MAX_TRACK_CROSSOVER_STROKE_PX,
      Math.max(MIN_TRACK_CROSSOVER_STROKE_PX, raw),
    )
  }
  return DEFAULT_TRACK_CROSSOVER_STROKE_PX
}

export function clampTrackCrossoverStrokePx(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_TRACK_CROSSOVER_STROKE_PX
  return Math.min(
    MAX_TRACK_CROSSOVER_STROKE_PX,
    Math.max(MIN_TRACK_CROSSOVER_STROKE_PX, raw),
  )
}

export function parseTrackCrossoverCenterGapPct(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampTrackCrossoverCenterGapPct(raw)
  }
  return DEFAULT_TRACK_CROSSOVER_CENTER_GAP_PCT
}

export function clampTrackCrossoverCenterGapPct(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_TRACK_CROSSOVER_CENTER_GAP_PCT
  return Math.min(
    MAX_TRACK_CROSSOVER_CENTER_GAP_PCT,
    Math.max(MIN_TRACK_CROSSOVER_CENTER_GAP_PCT, raw),
  )
}

function parsePortal(raw: unknown): CrossoverPortalState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const xM = typeof o.xM === 'number' && Number.isFinite(o.xM) ? o.xM : null
  const yM = typeof o.yM === 'number' && Number.isFinite(o.yM) ? o.yM : null
  if (xM == null || yM == null) return null
  const attachedTrackId =
    typeof o.attachedTrackId === 'string' && o.attachedTrackId.trim()
      ? o.attachedTrackId.trim()
      : null
  const waypointCode =
    typeof o.waypointCode === 'string' && o.waypointCode.trim()
      ? o.waypointCode.trim()
      : ''
  const aliasRaw = typeof o.alias === 'string' ? o.alias.trim() : ''
  // 現場座標是選填：舊圖資沒有，讀取端會退回圖面座標。這裡必須原樣帶出來——
  // 這支是重建物件而不是就地修改，漏掉的欄位等於被靜靜地丟掉。
  const refFieldXM =
    typeof o.refFieldXM === 'number' && Number.isFinite(o.refFieldXM)
      ? o.refFieldXM
      : null
  const refFieldYM =
    typeof o.refFieldYM === 'number' && Number.isFinite(o.refFieldYM)
      ? o.refFieldYM
      : null
  return {
    xM,
    yM,
    attachedTrackId,
    waypointCode,
    ...(refFieldXM != null ? { refFieldXM } : {}),
    ...(refFieldYM != null ? { refFieldYM } : {}),
    ...(aliasRaw ? { alias: aliasRaw } : {}),
  }
}

/** 舊版 XX 四端點 → 取 nw↔se 一條線徑 */
function migrateLegacyFourPortals(
  o: Record<string, unknown>,
): CrossoverPortals | null {
  const nw = parsePortal(o.nw)
  const se = parsePortal(o.se)
  const ne = parsePortal(o.ne)
  const sw = parsePortal(o.sw)
  if (nw && se) return { a: nw, b: se }
  if (ne && sw) return { a: ne, b: sw }
  return null
}

export function parseCrossoverPortals(raw: unknown): CrossoverPortals | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const a = parsePortal(o.a)
  const b = parsePortal(o.b)
  if (a && b) return { a, b }
  return migrateLegacyFourPortals(o)
}

export function getCrossoverPortals(
  facility: FacilityObject,
): CrossoverPortals | null {
  if (facility.type !== 'TrackCrossover') return null
  return parseCrossoverPortals(facility.parameters?.[TRACK_CROSSOVER_PORTALS_KEY])
}

/** 以設施中心建立預設單一線徑兩端（尚未接合） */
export function createDefaultCrossoverPortals(
  centerXM: number,
  centerYM: number,
  halfLenM = 12,
  halfSpreadM = 2.5,
  codes: { a: string; b: string } = { a: 'xo_a', b: 'xo_b' },
): CrossoverPortals {
  return {
    a: {
      xM: centerXM - halfLenM,
      yM: centerYM + halfSpreadM,
      attachedTrackId: null,
      waypointCode: codes.a,
    },
    b: {
      xM: centerXM + halfLenM,
      yM: centerYM - halfSpreadM,
      attachedTrackId: null,
      waypointCode: codes.b,
    },
  }
}

export function defaultTrackCrossoverParameters(
  centerXM = 0,
  centerYM = 0,
  portalCodes?: { a: string; b: string },
): Record<string, unknown> {
  return {
    [LABEL_STYLE_PARAM_KEY]: { visible: false },
    [TRACK_CROSSOVER_COLOR_KEY]: DEFAULT_TRACK_CROSSOVER_COLOR,
    [TRACK_CROSSOVER_COLOR_OPACITY_KEY]: DEFAULT_TRACK_CROSSOVER_COLOR_OPACITY,
    [TRACK_CROSSOVER_STROKE_PX_KEY]: DEFAULT_TRACK_CROSSOVER_STROKE_PX,
    [TRACK_CROSSOVER_CENTER_GAP_PCT_KEY]: DEFAULT_TRACK_CROSSOVER_CENTER_GAP_PCT,
    // 預設不寫入背景色＝無背景
    [TRACK_CROSSOVER_BG_OPACITY_KEY]: DEFAULT_TRACK_CROSSOVER_BG_OPACITY,
    [TRACK_CROSSOVER_PORTALS_KEY]: createDefaultCrossoverPortals(
      centerXM,
      centerYM,
      12,
      2.5,
      portalCodes,
    ),
  }
}

export function crossoverPortalsAabb(portals: CrossoverPortals): {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
} {
  let xMinM = Infinity
  let xMaxM = -Infinity
  let yMinM = Infinity
  let yMaxM = -Infinity
  for (const key of CROSSOVER_PORTAL_KEYS) {
    const p = portals[key]
    xMinM = Math.min(xMinM, p.xM)
    xMaxM = Math.max(xMaxM, p.xM)
    yMinM = Math.min(yMinM, p.yM)
    yMaxM = Math.max(yMaxM, p.yM)
  }
  if (!Number.isFinite(xMinM)) {
    return { xMinM: 0, xMaxM: 1, yMinM: 0, yMaxM: 1 }
  }
  const pad = 0.6
  return {
    xMinM: xMinM - pad,
    xMaxM: xMaxM + pad,
    yMinM: yMinM - pad,
    yMaxM: yMaxM + pad,
  }
}

export function projectPointOntoTrackSegment(
  xM: number,
  yM: number,
  seg: TrackNetworkSegment,
): { xM: number; yM: number; dist: number } {
  const b = seg.bounds
  // 點落在軌道可見包圍盒內（含小幅外擴）＝碰撞命中，距離以到中心線為準但視為可接合
  const pad = 0.35
  const inside =
    xM >= b.xMinM - pad &&
    xM <= b.xMaxM + pad &&
    yM >= b.yMinM - pad &&
    yM <= b.yMaxM + pad

  if (seg.horizontal) {
    const cy = (b.yMinM + b.yMaxM) / 2
    const cx = Math.min(b.xMaxM, Math.max(b.xMinM, xM))
    const dist = Math.hypot(xM - cx, yM - cy)
    return { xM: cx, yM: cy, dist: inside ? Math.min(dist, 0.05) : dist }
  }
  const cx = (b.xMinM + b.xMaxM) / 2
  const cy = Math.min(b.yMaxM, Math.max(b.yMinM, yM))
  const dist = Math.hypot(xM - cx, yM - cy)
  return { xM: cx, yM: cy, dist: inside ? Math.min(dist, 0.05) : dist }
}

export function snapPortalToNearestTrack(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
  maxDistM = CROSSOVER_ATTACH_SNAP_M,
): { xM: number; yM: number; trackId: string; dist: number } | null {
  let best: { xM: number; yM: number; trackId: string; dist: number } | null =
    null
  for (const seg of segmentById.values()) {
    const p = projectPointOntoTrackSegment(xM, yM, seg)
    if (p.dist > maxDistM) continue
    if (!best || p.dist < best.dist) {
      best = { xM: p.xM, yM: p.yM, trackId: seg.trackId, dist: p.dist }
    }
  }
  return best
}

/** 拖曳端點時：鄰近軌道上的勾子預覽／接合目標 */
export type CrossoverHookTarget = {
  trackId: string
  xM: number
  yM: number
  dist: number
  horizontal: boolean
  /** 勾子開口朝向（單位法線，由軌道指向接近中的端點） */
  openNx: number
  openNy: number
  /** true＝已磁吸接合（在接合距離內或已 attached） */
  engaged: boolean
}

function openNormalTowardPoint(
  seg: TrackNetworkSegment,
  onTrack: { xM: number; yM: number },
  fromXM: number,
  fromYM: number,
): { openNx: number; openNy: number } {
  if (seg.horizontal) {
    const s = Math.sign(fromYM - onTrack.yM)
    return { openNx: 0, openNy: s === 0 ? 1 : s }
  }
  const s = Math.sign(fromXM - onTrack.xM)
  return { openNx: s === 0 ? 1 : s, openNy: 0 }
}

/**
 * 依游標／端點位置解析鄰近軌道勾子。
 * 預覽距離內顯示勾子；進入接合距離則 engaged。
 */
export function resolveCrossoverHookTarget(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
  attachedTrackId: string | null = null,
): CrossoverHookTarget | null {
  if (attachedTrackId) {
    const seg = segmentById.get(attachedTrackId)
    if (seg) {
      const p = projectPointOntoTrackSegment(xM, yM, seg)
      const open = openNormalTowardPoint(seg, p, xM, yM)
      return {
        trackId: attachedTrackId,
        xM: p.xM,
        yM: p.yM,
        dist: p.dist,
        horizontal: seg.horizontal,
        openNx: open.openNx,
        openNy: open.openNy,
        engaged: true,
      }
    }
  }

  const snap = snapPortalToNearestTrack(
    xM,
    yM,
    segmentById,
    CROSSOVER_HOOK_PREVIEW_M,
  )
  if (!snap) return null
  const seg = segmentById.get(snap.trackId)
  if (!seg) return null
  const open = openNormalTowardPoint(seg, snap, xM, yM)
  return {
    trackId: snap.trackId,
    xM: snap.xM,
    yM: snap.yM,
    dist: snap.dist,
    horizontal: seg.horizontal,
    openNx: open.openNx,
    openNy: open.openNy,
    engaged: snap.dist <= CROSSOVER_ATTACH_SNAP_M,
  }
}

export function reprojectPortalOntoAttachedTrack(
  portal: CrossoverPortalState,
  desiredXM: number,
  desiredYM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): CrossoverPortalState {
  if (!portal.attachedTrackId) {
    return { ...portal, xM: desiredXM, yM: desiredYM }
  }
  const seg = segmentById.get(portal.attachedTrackId)
  if (!seg) {
    return { ...portal, xM: desiredXM, yM: desiredYM, attachedTrackId: null }
  }
  const p = projectPointOntoTrackSegment(desiredXM, desiredYM, seg)
  return {
    ...portal,
    xM: p.xM,
    yM: p.yM,
    attachedTrackId: portal.attachedTrackId,
  }
}

/** 中心拖移：平移端點；已接合者仍鎖在原軌道上（沿軌滑動） */
export function translateCrossoverPortals(
  portals: CrossoverPortals,
  dxM: number,
  dyM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): CrossoverPortals {
  const next = {} as CrossoverPortals
  for (const key of CROSSOVER_PORTAL_KEYS) {
    const p = portals[key]
    next[key] = reprojectPortalOntoAttachedTrack(
      p,
      p.xM + dxM,
      p.yM + dyM,
      segmentById,
    )
  }
  return next
}

/** 拖單一端點：近軌磁吸；已接合時也可切到更近的相鄰軌道物件 */
export function dragCrossoverPortal(
  portals: CrossoverPortals,
  key: CrossoverPortalKey,
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): CrossoverPortals {
  const current = portals[key]
  let nextPortal: CrossoverPortalState

  if (current.attachedTrackId) {
    const seg = segmentById.get(current.attachedTrackId)
    if (seg) {
      const onTrack = projectPointOntoTrackSegment(xM, yM, seg)
      const nearest = snapPortalToNearestTrack(
        xM,
        yM,
        segmentById,
        CROSSOVER_HOOK_PREVIEW_M,
      )
      // 相鄰軌道更近（或游標已進入其範圍）→ 切換接合
      if (
        nearest &&
        nearest.trackId !== current.attachedTrackId &&
        (nearest.dist <= CROSSOVER_ATTACH_SNAP_M ||
          nearest.dist + 0.25 < onTrack.dist)
      ) {
        nextPortal =
          nearest.dist <= CROSSOVER_ATTACH_SNAP_M
            ? {
                ...current,
                xM: nearest.xM,
                yM: nearest.yM,
                attachedTrackId: nearest.trackId,
              }
            : resolveFreePortalWithMagnet(current, xM, yM, segmentById)
      } else if (onTrack.dist <= CROSSOVER_DETACH_SNAP_M) {
        nextPortal = {
          ...current,
          xM: onTrack.xM,
          yM: onTrack.yM,
          attachedTrackId: current.attachedTrackId,
        }
      } else {
        nextPortal = resolveFreePortalWithMagnet(current, xM, yM, segmentById)
      }
    } else {
      nextPortal = resolveFreePortalWithMagnet(current, xM, yM, segmentById)
    }
  } else {
    nextPortal = resolveFreePortalWithMagnet(current, xM, yM, segmentById)
  }

  return { ...portals, [key]: nextPortal }
}

function resolveFreePortalWithMagnet(
  identity: CrossoverPortalState,
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): CrossoverPortalState {
  const hard = snapPortalToNearestTrack(
    xM,
    yM,
    segmentById,
    CROSSOVER_ATTACH_SNAP_M,
  )
  if (hard) {
    return {
      ...identity,
      xM: hard.xM,
      yM: hard.yM,
      attachedTrackId: hard.trackId,
    }
  }
  const soft = snapPortalToNearestTrack(
    xM,
    yM,
    segmentById,
    CROSSOVER_HOOK_PREVIEW_M,
  )
  if (!soft) {
    return { ...identity, xM, yM, attachedTrackId: null }
  }
  // 進入勾子預覽區後輕微拉向軌道，越近拉力越強
  const span = Math.max(0.01, CROSSOVER_HOOK_PREVIEW_M - CROSSOVER_ATTACH_SNAP_M)
  const t = 1 - (soft.dist - CROSSOVER_ATTACH_SNAP_M) / span
  const pull = Math.min(1, Math.max(0, t)) ** 2 * 0.45
  return {
    ...identity,
    xM: xM + (soft.xM - xM) * pull,
    yM: yM + (soft.yM - yM) * pull,
    attachedTrackId: null,
  }
}

export function ensureCrossoverPortals(
  facility: FacilityObject,
): CrossoverPortals {
  const existing = getCrossoverPortals(facility)
  if (existing) {
    return {
      a: {
        ...existing.a,
        waypointCode: existing.a.waypointCode || 'xo_a',
      },
      b: {
        ...existing.b,
        waypointCode: existing.b.waypointCode || 'xo_b',
      },
    }
  }
  const size = { w: 20, h: 10 }
  return createDefaultCrossoverPortals(
    facility.position.x + size.w / 2,
    facility.position.y + size.h / 2,
    size.w / 3,
    size.h / 3,
  )
}

/**
 * 端點的<strong>現場</strong>座標。舊圖資沒有 refField 時退回圖面座標，
 * 因為在分家之前那一對本來就同時扮演兩個角色。
 */
export function crossoverPortalFieldMeters(portal: CrossoverPortalState): {
  xM: number
  yM: number
} {
  return {
    xM:
      typeof portal.refFieldXM === 'number' && Number.isFinite(portal.refFieldXM)
        ? portal.refFieldXM
        : portal.xM,
    yM:
      typeof portal.refFieldYM === 'number' && Number.isFinite(portal.refFieldYM)
        ? portal.refFieldYM
        : portal.yM,
  }
}

/**
 * 端點<strong>真的移動了</strong>才把圖面座標同步進現場座標。
 *
 * 為什麼要比對前後而不是無條件同步：點一下渡線選取它，也會走完一次「拖曳」的
 * 生命週期（位移為零）。無條件同步的話，那一下就把使用者剛在屬性面板手打的
 * 現場座標蓋回幾何值——症狀是數字打了會自己還原。
 *
 * 沒動的端點原樣保留，包含它的現場座標。
 */
export function syncMovedCrossoverPortalsFieldMeters(
  previous: CrossoverPortals | null,
  next: CrossoverPortals,
): CrossoverPortals {
  const syncOne = (
    key: CrossoverPortalKey,
  ): CrossoverPortalState => {
    const after = next[key]
    const before = previous?.[key]
    const moved =
      !before || before.xM !== after.xM || before.yM !== after.yM
    if (!moved) return after
    return { ...after, refFieldXM: after.xM, refFieldYM: after.yM }
  }
  return { a: syncOne('a'), b: syncOne('b') }
}
