import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  WAYPOINT_CODE_KEY,
  getWaypointCode,
} from './waypointFacility'

const WAYPOINT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const DEFAULT_WAYPOINT_CODE_PATTERN = /^waypoint_(\d+)$/

export function normalizeWaypointCodeInput(raw: string): string {
  return raw.trim()
}

export function isValidWaypointCodeFormat(code: string): boolean {
  const normalized = normalizeWaypointCodeInput(code)
  if (!normalized) return false
  return WAYPOINT_CODE_PATTERN.test(normalized)
}

export function collectWaypointCodes(areas: MapAreaObject[]): Set<string> {
  const codes = new Set<string>()
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Waypoint') continue
      const code = getWaypointCode(facility)
      if (code) codes.add(code)
    }
  }
  return codes
}

export function generateNextWaypointCode(areas: MapAreaObject[]): string {
  const codes = collectWaypointCodes(areas)
  let max = 0
  for (const code of codes) {
    const match = DEFAULT_WAYPOINT_CODE_PATTERN.exec(code)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  let next = max + 1
  let candidate = `waypoint_${next}`
  while (codes.has(candidate)) {
    next += 1
    candidate = `waypoint_${next}`
  }
  return candidate
}

export function isWaypointCodeTaken(
  areas: MapAreaObject[],
  code: string,
  excludeFacilityId?: string,
): boolean {
  const norm = normalizeWaypointCodeInput(code).toLowerCase()
  if (!norm) return false
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Waypoint') continue
      if (excludeFacilityId && facility.id === excludeFacilityId) continue
      const other = normalizeWaypointCodeInput(getWaypointCode(facility)).toLowerCase()
      if (other && other === norm) return true
    }
  }
  return false
}

function nextAvailableWaypointCode(assignedCodes: Set<string>): string {
  let seq = 1
  let candidate = `waypoint_${seq}`
  while (assignedCodes.has(candidate)) {
    seq += 1
    candidate = `waypoint_${seq}`
  }
  assignedCodes.add(candidate)
  return candidate
}

function migrateWaypointFacility(
  facility: FacilityObject,
  assignedCodes: Set<string>,
): { facility: FacilityObject; changed: boolean } {
  if (facility.type !== 'Waypoint') {
    return { facility, changed: false }
  }

  const params = { ...(facility.parameters ?? {}) }
  let changed = false

  if (!getWaypointCode({ ...facility, parameters: params })) {
    params[WAYPOINT_CODE_KEY] = nextAvailableWaypointCode(assignedCodes)
    changed = true
  } else {
    const code = getWaypointCode({ ...facility, parameters: params })
    if (code) assignedCodes.add(code)
  }

  if (!changed) return { facility, changed: false }

  return {
    facility: {
      ...facility,
      parameters: params,
    },
    changed: true,
  }
}

export function ensureWaypointCodesInAreas(
  areas: MapAreaObject[],
): MapAreaObject[] {
  const assignedCodes = collectWaypointCodes(areas)
  return areas.map((area) => ({
    ...area,
    facilities: area.facilities.map((facility) => {
      const result = migrateWaypointFacility(facility, assignedCodes)
      return result.facility
    }),
  }))
}

export function ensureWaypointCode(
  facility: FacilityObject,
  areas: MapAreaObject[],
): FacilityObject {
  const assignedCodes = collectWaypointCodes(areas)
  return migrateWaypointFacility(facility, assignedCodes).facility
}

export function patchWaypointCode(
  facility: FacilityObject,
  areas: MapAreaObject[],
  nextCode: string,
): { facility: FacilityObject; error: string | null } {
  if (facility.type !== 'Waypoint') {
    return { facility, error: null }
  }

  const normalized = normalizeWaypointCodeInput(nextCode)
  if (!normalized) {
    return { facility, error: '請輸入途經點代號' }
  }
  if (!isValidWaypointCodeFormat(normalized)) {
    return {
      facility,
      error: '代號須以英文字母開頭，僅可含英數、底線與連字號',
    }
  }
  if (isWaypointCodeTaken(areas, normalized, facility.id)) {
    return { facility, error: '此代號已被其他途經點使用' }
  }

  return {
    facility: {
      ...facility,
      parameters: {
        ...(facility.parameters ?? {}),
        [WAYPOINT_CODE_KEY]: normalized,
      },
    },
    error: null,
  }
}
