import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  getValidRefFieldBounds,
  refFieldSubslotCenterMeters,
} from './facilityRefFieldBounds'

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
])

export const PARKING_PLATFORM_CAPACITY: Record<string, number> = {
  P1: 2,
  P2: 2,
}

/** P1/P2 月台內兩格並排（沿 Y 切分） */
export const PARKING_PLATFORM_SLOT_ORDER: Array<{
  platform: 'P1' | 'P2'
  subIndex: number
}> = [
  { platform: 'P1', subIndex: 1 },
  { platform: 'P1', subIndex: 0 },
  { platform: 'P2', subIndex: 1 },
  { platform: 'P2', subIndex: 0 },
]

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
    const subRaw = payload.yard_sub_index ?? payload.yardSubIndex
    const subIndex =
      typeof subRaw === 'number' && Number.isFinite(subRaw) ? subRaw : undefined
    return subIndex !== undefined ? { slotId, subIndex } : { slotId }
  }

  const segment = payload.segment_label
  if (typeof segment !== 'string') return null
  const parts = segment.trim().split(/\s+/)
  if (parts.length < 2) return null
  const slotId = parts[parts.length - 1]?.trim()
  if (!slotId || !isYardParkableFacilityId(slotId)) return null
  return { slotId }
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

function resolvePlatformSubslotFieldMeters(
  platformId: 'P1' | 'P2',
  subIndex: number,
  areas: MapAreaObject[],
): { xM: number; yM: number; facility: FacilityObject; area: MapAreaObject } | null {
  const hit = findFacilityByName(areas, platformId)
  if (!hit) return null
  const bounds = getValidRefFieldBounds(hit.facility.parameters)
  if (!bounds) return null
  const capacity = PARKING_PLATFORM_CAPACITY[platformId] ?? 1
  const { xM, yM } = refFieldSubslotCenterMeters(bounds, subIndex, capacity, {
    splitAxis: 'y',
  })
  return { xM, yM, facility: hit.facility, area: hit.area }
}

/** 依設施格代號（E1、P1、H1…）解析場域座標；P1/P2 需 subIndex 指定月台內子格 */
export function resolveYardFacilityFieldMeters(
  slotId: string,
  areas: MapAreaObject[],
  options?: { subIndex?: number },
): { xM: number; yM: number; facility: FacilityObject; area: MapAreaObject } | null {
  const id = slotId.trim()
  if (!isYardParkableFacilityId(id)) return null

  if (id === 'P1' || id === 'P2') {
    const subIndex = options?.subIndex ?? 0
    return resolvePlatformSubslotFieldMeters(id, subIndex, areas)
  }

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
