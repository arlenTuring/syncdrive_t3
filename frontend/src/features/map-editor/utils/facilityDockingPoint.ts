import type { FacilityObject } from '../types/facility'
import {
  getValidRefFieldBounds,
  type RefFieldBoundsMeters,
} from './facilityRefFieldBounds'
import { getComponentPurpose } from './facilityArea'

/** Facility.parameters 內的設施停靠點（場域絕對公尺，須落在場域範圍內） */
export const FACILITY_DOCKING_POINT_KEY = 'facilityDockingPoint'

export type FacilityDockingPoint = {
  /** 場域橫向座標（公尺） */
  xM: number
  /** 場域縱向座標（公尺） */
  yM: number
  /**
   * 顯示別名（選填）。
   * 未設定／空白時以「設施名＋停靠點」為預設顯示名。
   */
  alias?: string
}

function readFinite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readOptionalAlias(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}

export function parseFacilityDockingPoint(
  parameters: Record<string, unknown> | undefined,
): FacilityDockingPoint | null {
  const raw = parameters?.[FACILITY_DOCKING_POINT_KEY]
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const xM = readFinite(obj.xM)
  const yM = readFinite(obj.yM)
  if (xM === null || yM === null) return null
  const alias = readOptionalAlias(obj.alias)
  return alias ? { xM, yM, alias } : { xM, yM }
}

/** 將點箝制在場域範圍內（含邊界）；保留別名 */
export function clampPointToRefFieldBounds(
  point: FacilityDockingPoint,
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): FacilityDockingPoint {
  const next: FacilityDockingPoint = {
    xM: Math.min(bounds.xMaxM, Math.max(bounds.xMinM, point.xM)),
    yM: Math.min(bounds.yMaxM, Math.max(bounds.yMinM, point.yM)),
  }
  if (point.alias?.trim()) next.alias = point.alias.trim()
  return next
}

/** 預設位置：設施左側約 1/3、上下置中（避開設施名稱） */
export function defaultFacilityDockingPoint(
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): FacilityDockingPoint {
  return alongToFacilityDockingPoint(1 / 3, 0.5, bounds)
}

/** @deprecated 請改用 defaultFacilityDockingPoint（左 1/3、上下置中） */
export function defaultFacilityDockingPointAtCenter(
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): FacilityDockingPoint {
  return defaultFacilityDockingPoint(bounds)
}

/**
 * 讀取並（若超出範圍）箝制設施停靠點。
 * 無有效場域範圍或未設定時回 null。
 */
export function getFacilityDockingPoint(
  facility: Pick<FacilityObject, 'type' | 'parameters'>,
): FacilityDockingPoint | null {
  if (facility.type !== 'Facility') return null
  const bounds = getValidRefFieldBounds(facility.parameters)
  if (!bounds) return null
  const point = parseFacilityDockingPoint(facility.parameters)
  if (!point) return null
  return clampPointToRefFieldBounds(point, bounds)
}

export function serializeFacilityDockingPoint(
  point: FacilityDockingPoint,
): { xM: number; yM: number; alias?: string } {
  const alias = point.alias?.trim()
  return alias
    ? { xM: point.xM, yM: point.yM, alias }
    : { xM: point.xM, yM: point.yM }
}

export function patchFacilityDockingPoint(
  parameters: Record<string, unknown> | undefined,
  point: FacilityDockingPoint | null,
): Record<string, unknown> {
  const next = { ...(parameters ?? {}) }
  if (point === null) {
    delete next[FACILITY_DOCKING_POINT_KEY]
    return next
  }
  next[FACILITY_DOCKING_POINT_KEY] = serializeFacilityDockingPoint(point)
  return next
}

/**
 * 將設施停靠點的場域座標換成設施本體上的相對位置（0–1）。
 * alongX：左→右；alongY：下→上（與場域範圍／Area 縱軸同向）。
 */
export function facilityDockingPointToAlong(
  point: FacilityDockingPoint,
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): { alongX: number; alongY: number } {
  const w = bounds.xMaxM - bounds.xMinM
  const h = bounds.yMaxM - bounds.yMinM
  const alongX = w > 0 ? (point.xM - bounds.xMinM) / w : 0.5
  const alongY = h > 0 ? (point.yM - bounds.yMinM) / h : 0.5
  return {
    alongX: Math.min(1, Math.max(0, alongX)),
    alongY: Math.min(1, Math.max(0, alongY)),
  }
}

/** 設施本體相對位置（0–1）→ 場域公尺，並箝制在範圍內 */
export function alongToFacilityDockingPoint(
  alongX: number,
  alongY: number,
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): FacilityDockingPoint {
  const ax = Math.min(1, Math.max(0, alongX))
  const ay = Math.min(1, Math.max(0, alongY))
  return {
    xM: bounds.xMinM + ax * (bounds.xMaxM - bounds.xMinM),
    yM: bounds.yMinM + ay * (bounds.yMaxM - bounds.yMinM),
  }
}

export function resolveFacilityDockingPointBaseName(
  facility: FacilityObject,
): string {
  const custom = facility.customName.trim()
  const purpose = getComponentPurpose(facility)
  return custom || purpose || facility.id
}

/** 預設別名：設施名稱＋「停靠點」 */
export function resolveFacilityDockingPointDefaultAlias(
  facility: FacilityObject,
): string {
  return `${resolveFacilityDockingPointBaseName(facility)}停靠點`
}

/**
 * 顯示用別名：有自訂別名用自訂，否則「設施名＋停靠點」。
 */
export function resolveFacilityDockingPointAlias(
  facility: FacilityObject,
): string {
  const stored = parseFacilityDockingPoint(facility.parameters)?.alias?.trim()
  if (stored) return stored
  return resolveFacilityDockingPointDefaultAlias(facility)
}

/**
 * 點位清單／路線選站顯示名。
 */
export function resolveFacilityDockingPointListTitle(
  facility: FacilityObject,
): string {
  return resolveFacilityDockingPointAlias(facility)
}

/**
 * 路網拓撲圓點標籤：與清單同用別名（預設為「設施名停靠點」）。
 */
export function resolveFacilityDockingPointTopologyLabel(
  facility: FacilityObject,
): string {
  return resolveFacilityDockingPointAlias(facility)
}

export function describeFacilityDockingPointBounds(
  bounds: RefFieldBoundsMeters | ReturnType<typeof getValidRefFieldBounds>,
): string {
  if (!bounds || bounds.xMinM == null || bounds.xMaxM == null) return ''
  const { xMinM, xMaxM, yMinM, yMaxM } = bounds as {
    xMinM: number
    xMaxM: number
    yMinM: number
    yMaxM: number
  }
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
  return `X ${fmt(xMinM)}–${fmt(xMaxM)} · Y ${fmt(yMinM)}–${fmt(yMaxM)}`
}
