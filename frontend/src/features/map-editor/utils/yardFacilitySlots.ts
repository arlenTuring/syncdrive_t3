import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { getValidRefFieldBounds } from './facilityRefFieldBounds'

/** 場下可停車的設施格（軌道 T 不算） */
export const YARD_PARKABLE_FACILITY_IDS = new Set([
  'E1',
  'E2',
  'E3',
  'E4',
  'H1',
  'H2',
  'H3',
  'M1',
  'M2',
  'M3',
  'M4',
  'W1',
  'P1',
  'P2',
  'P3',
  'P4',
])

/** 臨停格 P1–P4（v0.1.10：每格獨立設施，容量 1） */
export const PARKING_SLOT_IDS = ['P1', 'P2', 'P3', 'P4'] as const

export function isYardParkableFacilityId(slotId: string): boolean {
  return YARD_PARKABLE_FACILITY_IDS.has(slotId.trim())
}

export function parseYardSlotFromPayload(
  payload: Record<string, unknown> | undefined,
): { slotId: string; subIndex?: number } | null {
  if (!payload) return null

  const explicit = payload.yard_slot_id ?? payload.yardSlotId
  if (typeof explicit === 'string' && explicit.trim()) {
    const slotId = explicit.trim()
    if (!isYardParkableFacilityId(slotId)) return null
    return { slotId }
  }

  const segment = payload.segment_label
  if (typeof segment === 'string') {
    const trimmed = segment.trim()
    if (isYardParkableFacilityId(trimmed)) {
      return { slotId: trimmed }
    }
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const slotId = parts[parts.length - 1]?.trim()
      if (slotId && isYardParkableFacilityId(slotId)) return { slotId }
    }
  }

  return null
}

function findFacilityByName(
  areas: MapAreaObject[],
  name: string,
): { facility: FacilityObject; area: MapAreaObject } | null {
  for (const area of areas) {
    const facility = (area.facilities ?? []).find(
      (f) => f.customName?.trim() === name,
    )
    if (facility) return { facility, area }
  }
  return null
}

/** 依設施格代號（E1、P1、H1…）解析場域座標 */
export function resolveYardFacilityFieldMeters(
  slotId: string,
  areas: MapAreaObject[],
  _options?: { subIndex?: number },
): { xM: number; yM: number; facility: FacilityObject; area: MapAreaObject } | null {
  const id = slotId.trim()
  if (!isYardParkableFacilityId(id)) return null

  const hit = findFacilityByName(areas, id)
  if (!hit) return null
  if (hit.facility.type === 'Track') return null

  const bounds = getValidRefFieldBounds(hit.facility.parameters)
  if (!bounds) return null

  return {
    xM: (bounds.xMinM + bounds.xMaxM) / 2,
    yM: (bounds.yMinM + bounds.yMaxM) / 2,
    facility: hit.facility,
    area: hit.area,
  }
}

/** @deprecated 請改用 resolveYardFacilityFieldMeters */
export function resolveParkingSlotFieldMeters(
  slotId: string,
  areas: MapAreaObject[],
  options?: { subIndex?: number },
) {
  return resolveYardFacilityFieldMeters(slotId, areas, options)
}
