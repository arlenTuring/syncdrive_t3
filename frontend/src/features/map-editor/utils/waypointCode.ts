import type { MapAreaObject } from '../types/area'
import {
  CROSS_PORTAL_KEYS,
  crossPortalTopologyNodeId,
  getCrossPortals,
  resolveCrossPortalDisplayName,
  resolveCrossPortalFields,
  type CrossPortalKey,
} from './crossTrackPortals'
import type { FacilityObject } from '../types/facility'
import {
  WAYPOINT_CODE_KEY,
  WAYPOINT_NAME_KEY,
  getWaypointCode,
  getWaypointName,
  resolveWaypointDisplayName,
} from './waypointFacility'

const WAYPOINT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const DEFAULT_WAYPOINT_CODE_PATTERN = /^waypoint_(\d+)$/

export function normalizeWaypointCodeInput(raw: string): string {
  return raw.trim()
}

export function normalizeWaypointNameInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function isValidWaypointCodeFormat(code: string): boolean {
  const normalized = normalizeWaypointCodeInput(code)
  if (!normalized) return false
  return WAYPOINT_CODE_PATTERN.test(normalized)
}

/** 一般途經點 + 交叉軌道四個口的途經點代號 */
export function collectWaypointCodes(areas: MapAreaObject[]): Set<string> {
  const codes = new Set<string>()
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type === 'Waypoint') {
        const code = getWaypointCode(facility)
        if (code) codes.add(code)
        continue
      }
      // 交叉軌道的四個口也各是一個途經點，代號不能跟別人撞
      if (facility.name === 'RailCross') {
        const cross = getCrossPortals(facility)
        for (const key of CROSS_PORTAL_KEYS) {
          const code = cross[key].waypointCode?.trim()
          if (code) codes.add(code)
        }
        continue
      }
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

export type WaypointCodeExclude = {
  facilityId?: string
  /** 排除交叉軌道某一口自身（編輯該口代號時） */
  crossPortal?: { facilityId: string; key: CrossPortalKey }
}

export function isWaypointCodeTaken(
  areas: MapAreaObject[],
  code: string,
  excludeFacilityIdOrOpts?: string | WaypointCodeExclude,
): boolean {
  const norm = normalizeWaypointCodeInput(code).toLowerCase()
  if (!norm) return false
  const exclude: WaypointCodeExclude =
    typeof excludeFacilityIdOrOpts === 'string'
      ? { facilityId: excludeFacilityIdOrOpts }
      : (excludeFacilityIdOrOpts ?? {})

  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type === 'Waypoint') {
        if (exclude.facilityId && facility.id === exclude.facilityId) continue
        const other = normalizeWaypointCodeInput(
          getWaypointCode(facility),
        ).toLowerCase()
        if (other && other === norm) return true
        continue
      }
      if (facility.name === 'RailCross') {
        const portals = getCrossPortals(facility)
        for (const key of CROSS_PORTAL_KEYS) {
          if (
            exclude.crossPortal &&
            exclude.crossPortal.facilityId === facility.id &&
            exclude.crossPortal.key === key
          ) {
            continue
          }
          const other = normalizeWaypointCodeInput(
            portals[key].waypointCode ?? '',
          ).toLowerCase()
          if (other && other === norm) return true
        }
        continue
      }
    }
  }
  return false
}

export function isWaypointNameTaken(
  areas: MapAreaObject[],
  name: string,
  excludeFacilityId?: string,
): boolean {
  const norm = normalizeWaypointNameInput(name).toLowerCase()
  if (!norm) return false
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Waypoint') continue
      if (excludeFacilityId && facility.id === excludeFacilityId) continue
      const other = normalizeWaypointNameInput(getWaypointName(facility)).toLowerCase()
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
  let nextFacility = facility
  let changed = false

  if (!getWaypointCode({ ...facility, parameters: params })) {
    params[WAYPOINT_CODE_KEY] = nextAvailableWaypointCode(assignedCodes)
    changed = true
  } else {
    const code = getWaypointCode({ ...facility, parameters: params })
    if (code) assignedCodes.add(code)
  }

  // 舊途經點別名 → 自訂顯示名稱，並移除 waypointName
  const legacyName = getWaypointName({ ...facility, parameters: params })
  if (!facility.customName.trim() && legacyName) {
    nextFacility = { ...nextFacility, customName: legacyName }
    changed = true
  }
  if (WAYPOINT_NAME_KEY in params) {
    delete params[WAYPOINT_NAME_KEY]
    changed = true
  }

  if (!changed) return { facility, changed: false }

  return {
    facility: {
      ...nextFacility,
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
      if (facility.type === 'Waypoint') {
        return migrateWaypointFacility(facility, assignedCodes).facility
      }
      return facility
    }),
  }))
}

/** 匯出給路線清單／拓撲對照用；stationId = waypointCode */
export function collectWaypointsFromAreas(areas: MapAreaObject[]) {
  const out: Array<{
    stationId: string
    stationName: string
    facilityId: string
    areaId: string
    xM: number
    yM: number
    kind: 'waypoint'
  }> = []

  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Waypoint') continue
      const code = getWaypointCode(facility)
      if (!code) continue
      const params = facility.parameters ?? {}
      const xM = params.refFieldXM
      const yM = params.refFieldYM
      out.push({
        stationId: code,
        stationName: resolveWaypointDisplayName(facility),
        facilityId: facility.id,
        areaId: area.id,
        xM: typeof xM === 'number' && Number.isFinite(xM) ? xM : facility.position.x,
        yM: typeof yM === 'number' && Number.isFinite(yM) ? yM : facility.position.y,
        kind: 'waypoint',
      })
    }
  }
  return out
}

/** 交叉軌道四口途經點（stationId = waypointCode） */
export function collectCrossPortalWaypointsFromAreas(areas: MapAreaObject[]) {
  const out: Array<{
    stationId: string
    stationName: string
    facilityId: string
    areaId: string
    portalKey: CrossPortalKey
    topologyNodeId: string
    xM: number
    yM: number
    kind: 'cross-waypoint'
  }> = []

  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Track' || facility.name !== 'RailCross') continue
      const portals = getCrossPortals(facility)
      const fields = resolveCrossPortalFields(facility, area)
      for (const key of CROSS_PORTAL_KEYS) {
        const portal = portals[key]
        const code = portal.waypointCode?.trim()
        if (!code) continue
        const field = fields[key]
        const xM = field.xM
        const yM = field.yM
        if (xM == null || yM == null || !Number.isFinite(xM) || !Number.isFinite(yM)) continue
        out.push({
          stationId: code,
          stationName: resolveCrossPortalDisplayName(portal),
          facilityId: facility.id,
          areaId: area.id,
          portalKey: key,
          topologyNodeId: crossPortalTopologyNodeId(facility.id, key),
          xM,
          yM,
          kind: 'cross-waypoint',
        })
      }
    }
  }
  return out
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

export function patchWaypointName(
  facility: FacilityObject,
  areas: MapAreaObject[],
  rawName: string,
): { facility: FacilityObject; error: string | null } {
  if (facility.type !== 'Waypoint') {
    return { facility, error: null }
  }

  const name = normalizeWaypointNameInput(rawName)
  if (!name) {
    const params = { ...(facility.parameters ?? {}) }
    delete params[WAYPOINT_NAME_KEY]
    return {
      facility: { ...facility, parameters: params },
      error: null,
    }
  }
  if (isWaypointNameTaken(areas, name, facility.id)) {
    return { facility, error: '此別名已被其他途經點使用' }
  }

  return {
    facility: {
      ...facility,
      parameters: {
        ...(facility.parameters ?? {}),
        [WAYPOINT_NAME_KEY]: name,
      },
    },
    error: null,
  }
}
