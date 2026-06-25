import type { FacilityObject } from '../types/facility'
import { resolveMapEditorAssetUrl } from './mapEditorAssetUrl'

export const DOCKING_POINT_STATION_NAME_KEY = 'stationName'
/** 系統產生、對應營運協議 task_params.node_id（使用者不可編輯） */
export const DOCKING_POINT_NODE_ID_KEY = 'operationNodeId'
export const DOCKING_POINT_NODE_ROLE_KEY = 'nodeRole'
export const DOCKING_POINT_LEG_KEY = 'dockingLeg'
export const DOCKING_POINT_STATION_KEY = 'dockingStation'
export const DOCKING_POINT_ICON_MODE_KEY = 'iconMode'
export const DOCKING_POINT_CUSTOM_ICON_KEY = 'customIconUrl'

export const DOCKING_POINT_BUILTIN_ICON = '/map-editor-icons/facility/station.svg'

export type DockingPointIconMode = 'dot' | 'builtin' | 'custom'

export function parseDockingPointIconMode(raw: unknown): DockingPointIconMode {
  if (raw === 'builtin' || raw === 'custom') return raw
  return 'dot'
}

export function getDockingPointStationName(facility: FacilityObject): string {
  if (facility.type !== 'DockingPoint') return ''
  const raw = facility.parameters?.[DOCKING_POINT_STATION_NAME_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
}

export function getDockingPointLeg(facility: FacilityObject): 'down' | 'up' | null {
  if (facility.type !== 'DockingPoint') return null
  const raw = facility.parameters?.[DOCKING_POINT_LEG_KEY]
  return raw === 'down' || raw === 'up' ? raw : null
}

export function getDockingPointRouteStation(
  facility: FacilityObject,
): 'N2W' | 'T3' | 'S2W' | null {
  if (facility.type !== 'DockingPoint') return null
  const raw = facility.parameters?.[DOCKING_POINT_STATION_KEY]
  if (raw === 'N2W' || raw === 'T3' || raw === 'S2W') return raw
  return null
}

export function getDockingPointNodeRole(facility: FacilityObject): string {
  if (facility.type !== 'DockingPoint') return 'STOP'
  const raw = facility.parameters?.[DOCKING_POINT_NODE_ROLE_KEY]
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase()
  const leg = getDockingPointLeg(facility)
  const station = getDockingPointRouteStation(facility)
  if (leg && station) {
    return MAINLINE_DOCKING_NODE_ROLES[leg]?.[station] ?? 'STOP'
  }
  return 'STOP'
}

/** 節點 ID 站點代碼：優先 route station（N2W/T3/S2W），否則站點名稱 slug */
export function getDockingPointStationToken(facility: FacilityObject): string {
  if (facility.type !== 'DockingPoint') return ''
  const routeStation = getDockingPointRouteStation(facility)
  if (routeStation) return routeStation
  return stationNameToNodeToken(getDockingPointStationName(facility))
}

const MAINLINE_DOCKING_NODE_ROLES: Record<
  'down' | 'up',
  Record<'N2W' | 'T3' | 'S2W', string>
> = {
  down: { N2W: 'DEP', T3: 'STOP', S2W: 'STOP' },
  up: { N2W: 'STOP', T3: 'STOP', S2W: 'DEP' },
}

function stationNameToNodeToken(stationName: string): string {
  const n = stationName.trim().replace(/\s+/g, ' ')
  if (!n) return ''
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(n)) {
    return n.toUpperCase().replace(/-/g, '_')
  }
  return (
    n
      .normalize('NFKD')
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 24) || 'STATION'
  )
}

export function defaultDockingStationDisplayName(
  leg: 'down' | 'up',
  routeStation: 'N2W' | 'T3' | 'S2W',
): string {
  return `${routeStation}${leg === 'down' ? '下行' : '上行'}`
}

export function getDockingPointNodeId(facility: FacilityObject): string {
  if (facility.type !== 'DockingPoint') return ''
  const raw = facility.parameters?.[DOCKING_POINT_NODE_ID_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
}

export function resolveDockingPointMapLabel(facility: FacilityObject): string {
  const stationName = getDockingPointStationName(facility)
  if (stationName) return stationName
  const custom = facility.customName.trim()
  if (custom) return custom
  return ''
}

/** 自訂／內建站點圖示 URL；dot 模式回傳 null */
export function resolveDockingPointIconUrl(facility: FacilityObject): string | null {
  if (facility.type !== 'DockingPoint') return null
  const mode = parseDockingPointIconMode(
    facility.parameters?.[DOCKING_POINT_ICON_MODE_KEY],
  )
  if (mode === 'builtin') {
    return resolveMapEditorAssetUrl(DOCKING_POINT_BUILTIN_ICON)
  }
  if (mode === 'custom') {
    const raw = facility.parameters?.[DOCKING_POINT_CUSTOM_ICON_KEY]
    if (typeof raw === 'string' && raw.trim()) {
      return resolveMapEditorAssetUrl(raw.trim())
    }
  }
  return null
}

export function dockingPointUsesDot(facility: FacilityObject): boolean {
  return facility.type === 'DockingPoint' && !resolveDockingPointIconUrl(facility)
}
