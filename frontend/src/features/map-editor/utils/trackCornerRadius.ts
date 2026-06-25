import type { FacilityObject } from '../types/facility'

export type TrackCornerKey = 'tl' | 'tr' | 'br' | 'bl'

export type TrackCornerRadiiMeters = Record<TrackCornerKey, number>

export const TRACK_CORNER_RADIUS_KEY = 'trackCornerRadiusMeters'

export function getTrackCornerRadiiMeters(
  parameters: Record<string, unknown> | undefined,
): TrackCornerRadiiMeters {
  const raw = parameters?.[TRACK_CORNER_RADIUS_KEY]
  const parsed =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const read = (k: TrackCornerKey) => {
    const v = parsed?.[k]
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0
  }
  return { tl: read('tl'), tr: read('tr'), br: read('br'), bl: read('bl') }
}

export function clampTrackCornerRadii(
  radii: TrackCornerRadiiMeters,
  sizeMeters: { w: number; h: number },
): TrackCornerRadiiMeters {
  const cap = Math.max(0, Math.min(sizeMeters.w, sizeMeters.h))
  const clamp = (v: number) => Math.min(Math.max(0, v), cap)
  return {
    tl: clamp(radii.tl),
    tr: clamp(radii.tr),
    br: clamp(radii.br),
    bl: clamp(radii.bl),
  }
}

export function patchTrackCornerRadii(
  parameters: Record<string, unknown> | undefined,
  patch: Partial<TrackCornerRadiiMeters>,
  sizeMeters: { w: number; h: number },
): Record<string, unknown> {
  const base = getTrackCornerRadiiMeters(parameters)
  const merged = clampTrackCornerRadii({ ...base, ...patch }, sizeMeters)
  const allZero =
    merged.tl === 0 && merged.tr === 0 && merged.br === 0 && merged.bl === 0
  const next = { ...(parameters ?? {}) }
  if (allZero) {
    delete next[TRACK_CORNER_RADIUS_KEY]
  } else {
    next[TRACK_CORNER_RADIUS_KEY] = merged
  }
  return next
}

/** 圓角矩形：四角皆為可設定的最大圓角（min(寬,高)） */
export function roundedRectTrackCornerRadii(sizeMeters: {
  w: number
  h: number
}): TrackCornerRadiiMeters {
  const r = Math.max(0, Math.min(sizeMeters.w, sizeMeters.h))
  return { tl: r, tr: r, br: r, bl: r }
}

export function uniformTrackCornerRadii(
  radiusM: number,
  sizeMeters: { w: number; h: number },
): TrackCornerRadiiMeters {
  const r = Math.max(0, radiusM)
  const capped = clampTrackCornerRadii(
    { tl: r, tr: r, br: r, bl: r },
    sizeMeters,
  )
  return capped
}

export function getTrackCornerRadiiForFacility(
  facility: FacilityObject,
  sizeMeters: { w: number; h: number },
): TrackCornerRadiiMeters {
  if (facility.type !== 'Track') {
    return { tl: 0, tr: 0, br: 0, bl: 0 }
  }
  return clampTrackCornerRadii(
    getTrackCornerRadiiMeters(facility.parameters),
    sizeMeters,
  )
}
