import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  DOCKING_POINT_LEG_KEY,
  DOCKING_POINT_NODE_ID_KEY,
  DOCKING_POINT_STATION_ID_KEY,
  DOCKING_POINT_STATION_KEY,
  DOCKING_POINT_STATION_NAME_KEY,
  defaultDockingStationDisplayName,
  getDockingPointLeg,
  getDockingPointRouteStation,
  getDockingPointStationId,
  getDockingPointStationName,
} from './dockingPointFacility'

const STATION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const DEFAULT_STATION_ID_PATTERN = /^station_(\d+)$/

export function normalizeStationNameInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function normalizeStationIdInput(raw: string): string {
  return raw.trim()
}

export function isValidStationIdFormat(stationId: string): boolean {
  const id = normalizeStationIdInput(stationId)
  if (!id) return false
  return STATION_ID_PATTERN.test(id)
}

export function collectStationIds(areas: MapAreaObject[]): Set<string> {
  const ids = new Set<string>()
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'DockingPoint') continue
      const stationId = getDockingPointStationId(f)
      if (stationId) ids.add(stationId)
    }
  }
  return ids
}

export function generateNextStationId(areas: MapAreaObject[]): string {
  const ids = collectStationIds(areas)
  let max = 0
  for (const id of ids) {
    const match = DEFAULT_STATION_ID_PATTERN.exec(id)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  let next = max + 1
  let candidate = `station_${next}`
  while (ids.has(candidate)) {
    next += 1
    candidate = `station_${next}`
  }
  return candidate
}

export function isStationIdTaken(
  areas: MapAreaObject[],
  stationId: string,
  excludeFacilityId?: string,
): boolean {
  const norm = normalizeStationIdInput(stationId).toLowerCase()
  if (!norm) return false
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'DockingPoint') continue
      if (excludeFacilityId && f.id === excludeFacilityId) continue
      const other = normalizeStationIdInput(getDockingPointStationId(f)).toLowerCase()
      if (other && other === norm) return true
    }
  }
  return false
}

function effectiveStationName(facility: FacilityObject): string {
  const custom = facility.customName.trim()
  if (custom) return custom
  // 舊圖 stationName 僅作遷移備援
  const legacy = getDockingPointStationName(facility)
  if (legacy) return legacy
  return ''
}

export function isDockingStationNameTaken(
  areas: MapAreaObject[],
  stationName: string,
  excludeFacilityId?: string,
): boolean {
  const norm = normalizeStationNameInput(stationName).toLowerCase()
  if (!norm) return false
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'DockingPoint') continue
      if (excludeFacilityId && f.id === excludeFacilityId) continue
      const other = normalizeStationNameInput(effectiveStationName(f)).toLowerCase()
      if (other && other === norm) return true
    }
  }
  return false
}

function stripLegacyDockingParams(params: Record<string, unknown>): Record<string, unknown> {
  const next = { ...params }
  delete next[DOCKING_POINT_NODE_ID_KEY]
  delete next[DOCKING_POINT_STATION_KEY]
  delete next[DOCKING_POINT_LEG_KEY]
  delete next.nodeRole
  return next
}

function nextAvailableStationId(assignedIds: Set<string>): string {
  let seq = 1
  let candidate = `station_${seq}`
  while (assignedIds.has(candidate)) {
    seq += 1
    candidate = `station_${seq}`
  }
  assignedIds.add(candidate)
  return candidate
}

function migrateDockingPointFacility(
  facility: FacilityObject,
  assignedIds: Set<string>,
): { facility: FacilityObject; changed: boolean } {
  if (facility.type !== 'DockingPoint') {
    return { facility, changed: false }
  }

  let params = { ...(facility.parameters ?? {}) }
  let nextFacility = facility
  let changed = false

  // 舊站點別名 → 自訂顯示名稱，並移除 stationName
  const legacyName = getDockingPointStationName({ ...facility, parameters: params })
  if (!facility.customName.trim()) {
    if (legacyName) {
      nextFacility = { ...nextFacility, customName: legacyName }
      changed = true
    } else {
      const leg = getDockingPointLeg({ ...facility, parameters: params })
      const routeStation = getDockingPointRouteStation({ ...facility, parameters: params })
      if (leg && routeStation) {
        nextFacility = {
          ...nextFacility,
          customName: defaultDockingStationDisplayName(leg, routeStation),
        }
        changed = true
      }
    }
  }
  if (DOCKING_POINT_STATION_NAME_KEY in params) {
    delete params[DOCKING_POINT_STATION_NAME_KEY]
    changed = true
  }

  if (!getDockingPointStationId({ ...nextFacility, parameters: params })) {
    params[DOCKING_POINT_STATION_ID_KEY] = nextAvailableStationId(assignedIds)
    changed = true
  } else {
    assignedIds.add(getDockingPointStationId({ ...nextFacility, parameters: params }))
  }

  const hadLegacy =
    DOCKING_POINT_NODE_ID_KEY in params
    || DOCKING_POINT_STATION_KEY in params
    || DOCKING_POINT_LEG_KEY in params
    || 'nodeRole' in params
  if (hadLegacy) {
    params = stripLegacyDockingParams(params)
    changed = true
  }

  if (!changed) {
    return { facility, changed: false }
  }

  return {
    facility: { ...nextFacility, parameters: params },
    changed: true,
  }
}

/** 載入地圖時：補齊 stationId、遷移舊 operationNodeId / dockingStation */
export function ensureDockingPointStationIdsInAreas(
  areas: MapAreaObject[],
): MapAreaObject[] {
  const assignedIds = collectStationIds(areas)
  let changed = false
  const nextAreas = areas.map((area) => {
    let areaChanged = false
    const facilities = area.facilities.map((f) => {
      const result = migrateDockingPointFacility(f, assignedIds)
      if (result.changed) areaChanged = true
      return result.facility
    })
    return areaChanged ? { ...area, facilities } : area
  })
  changed = nextAreas.some((area, i) => area !== areas[i])
  return changed ? nextAreas : areas
}

export function ensureDockingPointStationId(
  facility: FacilityObject,
  areas: MapAreaObject[],
): FacilityObject {
  const assignedIds = collectStationIds(areas)
  return migrateDockingPointFacility(facility, assignedIds).facility
}

export function patchDockingPointStationId(
  facility: FacilityObject,
  areas: MapAreaObject[],
  rawId: string,
): { facility: FacilityObject; error?: string } {
  if (facility.type !== 'DockingPoint') {
    return { facility }
  }

  const stationId = normalizeStationIdInput(rawId)
  if (!stationId) {
    return { facility, error: '請輸入站點 ID' }
  }
  if (!isValidStationIdFormat(stationId)) {
    return {
      facility,
      error: '站點 ID 須以英文字母開頭，僅能使用英數、底線、連字號',
    }
  }
  if (isStationIdTaken(areas, stationId, facility.id)) {
    return { facility, error: '此站點 ID 已存在，請改用其他 ID' }
  }

  const params = stripLegacyDockingParams({
    ...(facility.parameters ?? {}),
    [DOCKING_POINT_STATION_ID_KEY]: stationId,
  })

  return { facility: { ...facility, parameters: params } }
}

export function patchDockingPointStationName(
  facility: FacilityObject,
  areas: MapAreaObject[],
  rawName: string,
): { facility: FacilityObject; error?: string } {
  if (facility.type !== 'DockingPoint') {
    return { facility }
  }

  const stationName = normalizeStationNameInput(rawName)
  if (!stationName) {
    return {
      facility: {
        ...facility,
        parameters: {
          ...(facility.parameters ?? {}),
          [DOCKING_POINT_STATION_NAME_KEY]: undefined,
        },
      },
    }
  }
  if (isDockingStationNameTaken(areas, stationName, facility.id)) {
    return { facility, error: '站點名稱不可與其他停靠點重複' }
  }

  let nextFacility: FacilityObject = {
    ...facility,
    parameters: {
      ...(facility.parameters ?? {}),
      [DOCKING_POINT_STATION_NAME_KEY]: stationName,
    },
  }

  if (!getDockingPointStationId(nextFacility)) {
    nextFacility = ensureDockingPointStationId(nextFacility, areas)
  }

  return { facility: nextFacility }
}

/** 匯出給後端／路線對照用 */
export function collectStationsFromAreas(areas: MapAreaObject[]) {
  const stations: Array<{
    stationId: string
    stationName: string
    xM: number
    yM: number
    facilityId: string
    areaId: string
  }> = []

  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'DockingPoint') continue
      const stationId = getDockingPointStationId(f)
      if (!stationId) continue
      const params = f.parameters ?? {}
      // 與途經點一致：參照場域未填時回退到圖台 position，避免新建停靠點從清單消失
      const xM =
        typeof params.refFieldXM === 'number' && Number.isFinite(params.refFieldXM)
          ? params.refFieldXM
          : f.position.x
      const yM =
        typeof params.refFieldYM === 'number' && Number.isFinite(params.refFieldYM)
          ? params.refFieldYM
          : f.position.y
      if (!Number.isFinite(xM) || !Number.isFinite(yM)) continue
      stations.push({
        stationId,
        stationName: effectiveStationName(f) || stationId,
        xM,
        yM,
        facilityId: f.id,
        areaId: area.id,
      })
    }
  }
  return stations
}

/** @deprecated 請改用 ensureDockingPointStationIdsInAreas */
export const ensureDockingPointNodeIdsInAreas = ensureDockingPointStationIdsInAreas
