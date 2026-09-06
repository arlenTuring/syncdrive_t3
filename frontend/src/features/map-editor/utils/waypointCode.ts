import type { MapAreaObject } from '../types/area'
import { CROSS_PORTAL_KEYS, getCrossPortals } from './crossTrackPortals'
import type { FacilityObject } from '../types/facility'
import {
  CROSSOVER_PORTAL_KEYS,
  TRACK_CROSSOVER_PORTALS_KEY,
  crossoverPortalTopologyNodeId,
  getCrossoverPortals,
  resolveCrossoverPortalDisplayName,
  type CrossoverPortalKey,
  crossoverPortalFieldMeters,
  type CrossoverPortalState,
  type CrossoverPortals,
} from './trackCrossoverFacility'
import {
  WAYPOINT_CODE_KEY,
  WAYPOINT_NAME_KEY,
  getWaypointCode,
  getWaypointName,
  resolveWaypointDisplayName,
} from './waypointFacility'

const WAYPOINT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const DEFAULT_WAYPOINT_CODE_PATTERN = /^waypoint_(\d+)$/
const DEFAULT_XO_CODE_PATTERN = /^xo_(\d+)_([ab])$/

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

/** 一般途經點 + 虛擬渡線端點途經點代號 */
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
      if (facility.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      if (!portals) continue
      for (const key of CROSSOVER_PORTAL_KEYS) {
        const code = portals[key].waypointCode?.trim()
        if (code) codes.add(code)
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

/** 產生一對虛擬渡線端點途經點代號（xo_N_a / xo_N_b） */
export function generateNextCrossoverPortalCodes(
  areas: MapAreaObject[],
): { a: string; b: string } {
  const codes = collectWaypointCodes(areas)
  let max = 0
  for (const code of codes) {
    const match = DEFAULT_XO_CODE_PATTERN.exec(code)
    if (match) max = Math.max(max, Number(match[1]))
  }
  let next = max + 1
  for (;;) {
    const a = `xo_${next}_a`
    const b = `xo_${next}_b`
    if (!codes.has(a) && !codes.has(b)) return { a, b }
    next += 1
  }
}

export type WaypointCodeExclude = {
  facilityId?: string
  /** 排除虛擬渡線某一端點自身（編輯該端代號時） */
  crossoverPortal?: { facilityId: string; key: CrossoverPortalKey }
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
      if (facility.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      if (!portals) continue
      for (const key of CROSSOVER_PORTAL_KEYS) {
        if (
          exclude.crossoverPortal &&
          exclude.crossoverPortal.facilityId === facility.id &&
          exclude.crossoverPortal.key === key
        ) {
          continue
        }
        const other = normalizeWaypointCodeInput(
          portals[key].waypointCode ?? '',
        ).toLowerCase()
        if (other && other === norm) return true
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
      if (facility.type === 'TrackCrossover') {
        return migrateCrossoverPortalCodes(facility, assignedCodes).facility
      }
      return facility
    }),
  }))
}

function migrateCrossoverPortalCodes(
  facility: FacilityObject,
  assignedCodes: Set<string>,
): { facility: FacilityObject; changed: boolean } {
  if (facility.type !== 'TrackCrossover') {
    return { facility, changed: false }
  }
  const portals = getCrossoverPortals(facility)
  if (!portals) return { facility, changed: false }

  const fixed = ensureBothPortalCodes(portals, assignedCodes)
  if (!fixed.changed) return { facility, changed: false }
  return {
    facility: {
      ...facility,
      parameters: {
        ...(facility.parameters ?? {}),
        [TRACK_CROSSOVER_PORTALS_KEY]: fixed.portals,
      },
    },
    changed: true,
  }
}

function allocateXoPair(assignedCodes: Set<string>): { a: string; b: string } {
  let max = 0
  for (const code of assignedCodes) {
    const match = DEFAULT_XO_CODE_PATTERN.exec(code)
    if (match) max = Math.max(max, Number(match[1]))
  }
  let next = max + 1
  for (;;) {
    const a = `xo_${next}_a`
    const b = `xo_${next}_b`
    if (!assignedCodes.has(a) && !assignedCodes.has(b)) {
      assignedCodes.add(a)
      assignedCodes.add(b)
      return { a, b }
    }
    next += 1
  }
}

function ensureBothPortalCodes(
  portals: CrossoverPortals,
  assignedCodes: Set<string>,
): { portals: CrossoverPortals; changed: boolean } {
  let changed = false
  const next: CrossoverPortals = {
    a: { ...portals.a },
    b: { ...portals.b },
  }
  const needA = !next.a.waypointCode?.trim()
  const needB = !next.b.waypointCode?.trim()
  if (needA && needB) {
    const pair = allocateXoPair(assignedCodes)
    next.a.waypointCode = pair.a
    next.b.waypointCode = pair.b
    changed = true
  } else if (needA || needB) {
    const pair = allocateXoPair(assignedCodes)
    if (needA) {
      next.a.waypointCode = pair.a
      changed = true
    } else {
      assignedCodes.add(next.a.waypointCode)
    }
    if (needB) {
      next.b.waypointCode = pair.b
      changed = true
    } else {
      assignedCodes.add(next.b.waypointCode)
    }
  } else {
    assignedCodes.add(next.a.waypointCode)
    assignedCodes.add(next.b.waypointCode)
  }
  return { portals: next, changed }
}

export function patchCrossoverPortalWaypointCode(
  facility: FacilityObject,
  areas: MapAreaObject[],
  key: CrossoverPortalKey,
  nextCode: string,
): { facility: FacilityObject; error: string | null } {
  if (facility.type !== 'TrackCrossover') {
    return { facility, error: null }
  }
  const portals = getCrossoverPortals(facility)
  if (!portals) return { facility, error: '找不到虛擬渡線端點' }

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
  if (
    isWaypointCodeTaken(areas, normalized, {
      crossoverPortal: { facilityId: facility.id, key },
    })
  ) {
    return { facility, error: '此代號已被其他途經點使用' }
  }

  const nextPortals: CrossoverPortals = {
    ...portals,
    [key]: { ...portals[key], waypointCode: normalized },
  }
  return {
    facility: {
      ...facility,
      parameters: {
        ...(facility.parameters ?? {}),
        [TRACK_CROSSOVER_PORTALS_KEY]: nextPortals,
      },
    },
    error: null,
  }
}

export function patchCrossoverPortalAlias(
  facility: FacilityObject,
  key: CrossoverPortalKey,
  rawAlias: string,
): FacilityObject {
  if (facility.type !== 'TrackCrossover') return facility
  const portals = getCrossoverPortals(facility)
  if (!portals) return facility
  const alias = normalizeWaypointNameInput(rawAlias)
  const nextPortal: CrossoverPortalState = { ...portals[key] }
  if (alias) nextPortal.alias = alias
  else delete nextPortal.alias
  return {
    ...facility,
    parameters: {
      ...(facility.parameters ?? {}),
      [TRACK_CROSSOVER_PORTALS_KEY]: {
        ...portals,
        [key]: nextPortal,
      },
    },
  }
}

/**
 * 途經點的<strong>現場</strong>參照座標（公尺）。
 *
 * 只寫 refField，<strong>不動 xM／yM</strong>——那一對是圖面位置。現場座標是實際
 * 量到的值，修正它不該把圖上的端點拉走。要移動圖上的端點請直接拖它。
 */
export function patchCrossoverPortalFieldMeters(
  facility: FacilityObject,
  key: CrossoverPortalKey,
  patch: { xM?: number; yM?: number },
): FacilityObject {
  if (facility.type !== 'TrackCrossover') return facility
  const portals = getCrossoverPortals(facility)
  if (!portals) return facility
  const current = portals[key]
  const fallback = crossoverPortalFieldMeters(current)
  const nextPortal: CrossoverPortalState = {
    ...current,
    refFieldXM:
      typeof patch.xM === 'number' && Number.isFinite(patch.xM)
        ? patch.xM
        : fallback.xM,
    refFieldYM:
      typeof patch.yM === 'number' && Number.isFinite(patch.yM)
        ? patch.yM
        : fallback.yM,
  }
  return {
    ...facility,
    parameters: {
      ...(facility.parameters ?? {}),
      [TRACK_CROSSOVER_PORTALS_KEY]: {
        ...portals,
        [key]: nextPortal,
      },
    },
  }
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

/** 虛擬渡線途經點（stationId = waypointCode；kind 與一般途經點分開） */
export function collectCrossoverPortalWaypointsFromAreas(areas: MapAreaObject[]) {
  const out: Array<{
    stationId: string
    stationName: string
    facilityId: string
    areaId: string
    portalKey: CrossoverPortalKey
    topologyNodeId: string
    xM: number
    yM: number
    kind: 'crossover-waypoint'
  }> = []

  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      if (!portals) continue
      for (const key of CROSSOVER_PORTAL_KEYS) {
        const portal = portals[key]
        const code = portal.waypointCode?.trim()
        if (!code) continue
        out.push({
          stationId: code,
          stationName: resolveCrossoverPortalDisplayName(portal),
          facilityId: facility.id,
          areaId: area.id,
          portalKey: key,
          topologyNodeId: crossoverPortalTopologyNodeId(facility.id, key),
          ...crossoverPortalFieldMeters(portal),
          kind: 'crossover-waypoint',
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
