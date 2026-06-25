import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  DOCKING_POINT_NODE_ID_KEY,
  DOCKING_POINT_NODE_ROLE_KEY,
  DOCKING_POINT_STATION_NAME_KEY,
  defaultDockingStationDisplayName,
  getDockingPointLeg,
  getDockingPointNodeId,
  getDockingPointNodeRole,
  getDockingPointRouteStation,
  getDockingPointStationName,
  getDockingPointStationToken,
} from './dockingPointFacility'

const NODE_ID_PATTERN = /^ND-[A-Z0-9_]+-[A-Z0-9_]+-\d{2}$/

export function normalizeStationNameInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** 站點名稱 → 節點 ID 代碼（大寫、底線） */
export function stationNameToNodeToken(stationName: string): string {
  const n = normalizeStationNameInput(stationName)
  if (!n) return ''
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(n)) {
    return n.toUpperCase().replace(/-/g, '_')
  }
  const slug = n
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 24)
  return slug || 'STATION'
}

export function isValidOperationNodeId(id: string): boolean {
  return NODE_ID_PATTERN.test(id.trim())
}

function effectiveStationName(facility: FacilityObject): string {
  const name = getDockingPointStationName(facility)
  if (name) return name
  const leg = getDockingPointLeg(facility)
  const routeStation = getDockingPointRouteStation(facility)
  if (leg && routeStation) return defaultDockingStationDisplayName(leg, routeStation)
  return ''
}

export function collectOperationNodeIds(areas: MapAreaObject[]): Set<string> {
  const ids = new Set<string>()
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'DockingPoint') continue
      const nodeId = getDockingPointNodeId(f)
      if (nodeId) ids.add(nodeId)
    }
  }
  return ids
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

/**
 * 系統產生營運節點 ID（協議 task_params.node_id）。
 * 格式：ND-{站點代碼}-{節點角色}-{序號}，例 ND-T3-STOP-01
 */
export function generateOperationNodeId(
  stationToken: string,
  existingIds: ReadonlySet<string>,
  nodeRole = 'STOP',
): string {
  const station = stationNameToNodeToken(stationToken)
  if (!station) {
    throw new Error('站點代碼不可為空')
  }
  const base = `ND-${station}-${nodeRole}`
  let seq = 1
  let id = `${base}-${String(seq).padStart(2, '0')}`
  while (existingIds.has(id)) {
    seq += 1
    id = `${base}-${String(seq).padStart(2, '0')}`
  }
  return id
}

function assignDockingNodeId(
  facility: FacilityObject,
  areas: MapAreaObject[],
  canonicalByStationRole = new Map<string, string>(),
): FacilityObject {
  if (facility.type !== 'DockingPoint') return facility
  if (getDockingPointNodeId(facility)) return facility

  const stationToken = getDockingPointStationToken(facility)
  if (!stationToken) return facility

  const ids = collectOperationNodeIds(areas)
  const nodeRole = getDockingPointNodeRole(facility)
  const canonKey = `${stationToken}|${nodeRole}`
  let nodeId = canonicalByStationRole.get(canonKey)
  if (!nodeId) {
    nodeId = generateOperationNodeId(stationToken, ids, nodeRole)
    canonicalByStationRole.set(canonKey, nodeId)
  }
  return {
    ...facility,
    parameters: {
      ...(facility.parameters ?? {}),
      [DOCKING_POINT_NODE_ROLE_KEY]: nodeRole,
      [DOCKING_POINT_NODE_ID_KEY]: nodeId,
    },
  }
}

export function ensureDockingPointNodeId(
  facility: FacilityObject,
  areas: MapAreaObject[],
): FacilityObject {
  return assignDockingNodeId(facility, areas)
}

/** 載入地圖時：已有站名或 route station 但缺 node_id 的停靠點自動補齊 */
export function ensureDockingPointNodeIdsInAreas(
  areas: MapAreaObject[],
): MapAreaObject[] {
  const ids = collectOperationNodeIds(areas)
  const canonicalByStationRole = new Map<string, string>()
  let changed = false
  const nextAreas = areas.map((area) => {
    let areaChanged = false
    const facilities = area.facilities.map((f) => {
      if (f.type !== 'DockingPoint') return f
      if (getDockingPointNodeId(f)) {
        const stationToken = getDockingPointStationToken(f)
        const nodeRole = getDockingPointNodeRole(f)
        if (stationToken) {
          canonicalByStationRole.set(`${stationToken}|${nodeRole}`, getDockingPointNodeId(f))
        }
        return f
      }

      const stationToken = getDockingPointStationToken(f)
      if (!stationToken) return f

      try {
        const nodeRole = getDockingPointNodeRole(f)
        const canonKey = `${stationToken}|${nodeRole}`
        let nodeId = canonicalByStationRole.get(canonKey)
        if (!nodeId) {
          nodeId = generateOperationNodeId(stationToken, ids, nodeRole)
          canonicalByStationRole.set(canonKey, nodeId)
        }
        ids.add(nodeId)
        areaChanged = true
        changed = true

        const params = { ...(f.parameters ?? {}) }
        if (!getDockingPointStationName(f)) {
          const leg = getDockingPointLeg(f)
          const routeStation = getDockingPointRouteStation(f)
          if (leg && routeStation) {
            params[DOCKING_POINT_STATION_NAME_KEY] =
              defaultDockingStationDisplayName(leg, routeStation)
          }
        }

        return {
          ...f,
          parameters: {
            ...params,
            [DOCKING_POINT_NODE_ROLE_KEY]: nodeRole,
            [DOCKING_POINT_NODE_ID_KEY]: nodeId,
          },
        }
      } catch {
        return f
      }
    })
    return areaChanged ? { ...area, facilities } : area
  })
  return changed ? nextAreas : areas
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

  const params = { ...(facility.parameters ?? {}) }
  params[DOCKING_POINT_STATION_NAME_KEY] = stationName

  let nextFacility: FacilityObject = { ...facility, parameters: params }
  if (!getDockingPointNodeId(nextFacility)) {
    const ids = collectOperationNodeIds(areas)
    const stationToken = getDockingPointStationToken(nextFacility)
    const nodeRole = getDockingPointNodeRole(nextFacility)
    const nodeId = generateOperationNodeId(stationToken, ids, nodeRole)
    nextFacility = {
      ...nextFacility,
      parameters: {
        ...params,
        [DOCKING_POINT_NODE_ROLE_KEY]: nodeRole,
        [DOCKING_POINT_NODE_ID_KEY]: nodeId,
      },
    }
  }
  return { facility: nextFacility }
}

/** 匯出給後端／路線對照用 */
export function collectOperationNodesFromAreas(areas: MapAreaObject[]) {
  const nodes: Array<{
    nodeId: string
    nodeRole: string
    stationName: string
    routeStation?: string
    dockingLeg?: string
    actionType: string
    xM: number
    yM: number
    facilityId: string
    areaId: string
  }> = []

  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'DockingPoint') continue
      const params = f.parameters ?? {}
      const xM = params.refFieldXM
      const yM = params.refFieldYM
      if (typeof xM !== 'number' || typeof yM !== 'number') continue
      const nodeId = getDockingPointNodeId(f)
      if (!nodeId) continue
      const nodeRole = getDockingPointNodeRole(f)
      nodes.push({
        nodeId,
        nodeRole,
        stationName: effectiveStationName(f),
        routeStation: getDockingPointRouteStation(f) ?? undefined,
        dockingLeg: getDockingPointLeg(f) ?? undefined,
        actionType: nodeRole === 'DEP' ? 'STATION_DEPARTURE' : 'PLATFORM_DOCKING',
        xM,
        yM,
        facilityId: f.id,
        areaId: area.id,
      })
    }
  }
  return nodes
}
