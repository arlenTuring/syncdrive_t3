import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  fieldPositionToFacilityAreaLocal,
  fieldPositionToTrackAreaLocal,
} from '../vehicles/resolveVehicleTrackPlacement'
import { meterToAreaLocalPx } from './areaCoords'
import { getComponentPurpose } from './facilityArea'
import {
  getDockingPointNodeId,
  getDockingPointStationName,
} from './dockingPointFacility'
import { usesRefFieldBounds } from './facilityRefFieldBinding'
import { getValidRefFieldBounds, isZeroRefFieldBoundsSpan } from './facilityRefFieldBounds'
import { getRefFieldPosition } from './facilityRefFieldPosition'

export type FacilityListEntry = {
  areaId: string
  areaName: string
  facilityId: string
  facilityType: FacilityObject['type']
  /** 清單標題：自訂顯示名稱，否則 ID */
  name: string
  /** 用途（parameters.purpose），顯示於清單描述列 */
  purpose: string
  /** 清單「場域」列：有範圍則 min–max，單點則 x,y */
  refFieldText: string
  /** 用於列表 key，隨 refField 變更而更新 */
  refFieldKey: string
  pxX: number
  pxY: number
}

function resolveListTitle(f: FacilityObject): string {
  if (f.type === 'DockingPoint') {
    const station = getDockingPointStationName(f)
    if (station) return station
  }
  const custom = f.customName.trim()
  if (custom) return custom
  const purpose = getComponentPurpose(f)
  if (purpose) return purpose
  return f.id
}

function formatMeters(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function resolveListRefField(
  facility: FacilityObject,
): { text: string; key: string } {
  const bounds = getValidRefFieldBounds(facility.parameters)
  if (bounds) {
    const text = `X ${formatMeters(bounds.xMinM)}–${formatMeters(bounds.xMaxM)} m · Y ${formatMeters(bounds.yMinM)}–${formatMeters(bounds.yMaxM)} m`
    const key = `${bounds.xMinM}|${bounds.xMaxM}|${bounds.yMinM}|${bounds.yMaxM}`
    return { text, key }
  }
  if (isZeroRefFieldBoundsSpan(facility.parameters)) {
    return { text: '0（占位）', key: 'zero' }
  }
  if (usesRefFieldBounds(facility.type)) {
    return { text: '未設定參照場域', key: 'unset-bounds' }
  }
  const ref = getRefFieldPosition(facility.parameters)
  if (ref.xM !== null && ref.yM !== null) {
    const text = `${ref.xM.toFixed(2)}, ${ref.yM.toFixed(2)} m`
    return { text, key: `${ref.xM}|${ref.yM}` }
  }
  const text = `${facility.position.x.toFixed(2)}, ${facility.position.y.toFixed(2)} m`
  return { text, key: `${facility.position.x}|${facility.position.y}` }
}

function resolveListFieldMeters(
  facility: FacilityObject,
): { xM: number; yM: number } {
  const bounds = getValidRefFieldBounds(facility.parameters)
  if (bounds) {
    return {
      xM: (bounds.xMinM + bounds.xMaxM) / 2,
      yM: (bounds.yMinM + bounds.yMaxM) / 2,
    }
  }
  const ref = getRefFieldPosition(facility.parameters)
  if (ref.xM !== null && ref.yM !== null) {
    return { xM: ref.xM, yM: ref.yM }
  }
  return { xM: facility.position.x, yM: facility.position.y }
}

function facilityAreaPx(
  area: MapAreaObject,
  facility: FacilityObject,
): { pxX: number; pxY: number } {
  const { xM, yM } = resolveListFieldMeters(facility)

  if (facility.type === 'Track') {
    const local = fieldPositionToTrackAreaLocal(xM, yM, facility, area, {
      extrapolate: false,
    })
    if (local) return { pxX: local.x, pxY: local.y }
  } else if (facility.type === 'Facility' || facility.type === 'Geofence') {
    const local = fieldPositionToFacilityAreaLocal(xM, yM, facility, area, {
      extrapolate: false,
    })
    if (local) return { pxX: local.x, pxY: local.y }
  }

  const local = meterToAreaLocalPx(xM, yM, area.domain, area.layout)
  return { pxX: local.x, pxY: local.y }
}

function resolveListPurpose(f: FacilityObject): string {
  if (f.type === 'DockingPoint') {
    const nodeId = getDockingPointNodeId(f)
    if (nodeId) return nodeId
  }
  return getComponentPurpose(f)
}

function toListEntry(area: MapAreaObject, f: FacilityObject): FacilityListEntry {
  const { pxX, pxY } = facilityAreaPx(area, f)
  const { text: refFieldText, key: refFieldKey } = resolveListRefField(f)
  return {
    areaId: area.id,
    areaName: area.customName.trim() || area.id,
    facilityId: f.id,
    facilityType: f.type,
    name: resolveListTitle(f),
    purpose: resolveListPurpose(f),
    refFieldText,
    refFieldKey,
    pxX,
    pxY,
  }
}

function sortEntries(entries: FacilityListEntry[]): FacilityListEntry[] {
  return entries.sort((a, b) => {
    const areaCmp = a.areaName.localeCompare(b.areaName, 'zh-Hant')
    if (areaCmp !== 0) return areaCmp
    const nameCmp = a.name.localeCompare(b.name, 'zh-Hant')
    if (nameCmp !== 0) return nameCmp
    return a.purpose.localeCompare(b.purpose, 'zh-Hant')
  })
}

function collectByType(
  areas: MapAreaObject[],
  types: FacilityObject['type'][],
): FacilityListEntry[] {
  const out: FacilityListEntry[] = []
  for (const area of areas) {
    for (const f of area.facilities) {
      if (!types.includes(f.type)) continue
      out.push(toListEntry(area, f))
    }
  }
  return sortEntries(out)
}

export function collectDockingPointEntries(
  areas: MapAreaObject[],
): FacilityListEntry[] {
  return collectByType(areas, ['DockingPoint'])
}

export function collectFacilityEntries(
  areas: MapAreaObject[],
): FacilityListEntry[] {
  return collectByType(areas, ['Facility'])
}

export function collectEquipmentEntries(areas: MapAreaObject[]): {
  signals: FacilityListEntry[]
  poles: FacilityListEntry[]
} {
  return {
    signals: collectByType(areas, ['Signal']),
    poles: collectByType(areas, ['Pole']),
  }
}

export function resolveFacilityFocusPx(
  areas: MapAreaObject[],
  areaId: string,
  facilityId: string,
): { x: number; y: number } | null {
  const area = areas.find((a) => a.id === areaId)
  if (!area) return null
  const facility = area.facilities.find((f) => f.id === facilityId)
  if (!facility) return null
  const local = facilityAreaPx(area, facility)
  return {
    x: area.layout.xPx + local.pxX,
    y: area.layout.yPx + local.pxY,
  }
}
