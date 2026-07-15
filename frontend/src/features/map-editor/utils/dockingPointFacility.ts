import type { FacilityObject } from '../types/facility'
import { resolveMapEditorAssetUrl } from './mapEditorAssetUrl'

export const DOCKING_POINT_STATION_ID_KEY = 'stationId'
export const DOCKING_POINT_STATION_NAME_KEY = 'stationName'
/** @deprecated 舊欄位，載入時遷移後不再寫入 */
export const DOCKING_POINT_NODE_ID_KEY = 'operationNodeId'
export const DOCKING_POINT_NODE_ROLE_KEY = 'nodeRole'
export const DOCKING_POINT_LEG_KEY = 'dockingLeg'
/** @deprecated 舊欄位，載入時遷移後不再寫入 */
export const DOCKING_POINT_STATION_KEY = 'dockingStation'
export const DOCKING_POINT_ICON_MODE_KEY = 'iconMode'
export const DOCKING_POINT_CUSTOM_ICON_KEY = 'customIconUrl'

export const DOCKING_POINT_BUILTIN_ICON = '/map-editor-icons/facility/station.svg'

export type DockingPointIconMode = 'dot' | 'builtin' | 'custom'

export function parseDockingPointIconMode(raw: unknown): DockingPointIconMode {
  if (raw === 'builtin' || raw === 'custom') return raw
  return 'dot'
}

export function getDockingPointStationId(facility: FacilityObject): string {
  if (facility.type !== 'DockingPoint') return ''
  const raw = facility.parameters?.[DOCKING_POINT_STATION_ID_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
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

/** @deprecated 僅供舊地圖遷移推斷預設別名 */
export function getDockingPointRouteStation(
  facility: FacilityObject,
): 'N2W' | 'T3' | 'S2W' | null {
  if (facility.type !== 'DockingPoint') return null
  const raw = facility.parameters?.[DOCKING_POINT_STATION_KEY]
  if (raw === 'N2W' || raw === 'T3' || raw === 'S2W') return raw
  return null
}

export function defaultDockingStationDisplayName(
  leg: 'down' | 'up',
  routeStation: 'N2W' | 'T3' | 'S2W',
): string {
  return `${routeStation}${leg === 'down' ? '下行' : '上行'}`
}

export function resolveDockingPointMapLabel(facility: FacilityObject): string {
  const stationName = getDockingPointStationName(facility)
  if (stationName) return stationName
  const stationId = getDockingPointStationId(facility)
  if (stationId) return stationId
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
