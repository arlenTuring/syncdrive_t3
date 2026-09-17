import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  fieldPositionToFacilityAreaLocal,
  fieldPositionToTrackAreaLocal,
} from '../vehicles/resolveVehicleTrackPlacement'
import { areaPositionToCssTopLeft, meterToAreaLocalPx } from './areaCoords'
import { getComponentPurpose } from './facilityArea'
import {
  getDockingPointStationName,
} from './dockingPointFacility'
import {
  getFacilityDockingPoint,
  resolveFacilityDockingPointListTitle,
} from './facilityDockingPoint'
import { getWaypointCode, resolveWaypointDisplayName } from './waypointFacility'
import {
  CROSS_PORTAL_UI_ORDER,
  getCrossPortals,
  resolveCrossPortalDisplayName,
  resolveCrossPortalFields,
} from './crossTrackPortals'
import {
  CROSSOVER_PORTAL_KEYS,
  crossoverPortalFieldMeters,
  getCrossoverPortals,
  resolveCrossoverPortalDisplayName,
} from './trackCrossoverFacility'
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
  /** 點位分類：正線停靠點、設施內停靠點、途經點 */
  pointKind?: 'docking' | 'facility-docking' | 'waypoint'
}

function resolveListTitle(f: FacilityObject): string {
  if (f.type === 'DockingPoint') {
    const custom = f.customName.trim()
    if (custom) return custom
    const station = getDockingPointStationName(f)
    if (station) return station
  }
  if (f.type === 'Waypoint') {
    const name = resolveWaypointDisplayName(f)
    if (name) return name
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
    return { text: '未設定場域範圍', key: 'unset-bounds' }
  }
  const ref = getRefFieldPosition(facility.parameters)
  if (ref.xM !== null && ref.yM !== null) {
    const text = `${ref.xM.toFixed(2)}, ${ref.yM.toFixed(2)} m`
    return { text, key: `${ref.xM}|${ref.yM}` }
  }
  const text = `${facility.position.x.toFixed(2)}, ${facility.position.y.toFixed(2)} m`
  return { text, key: `${facility.position.x}|${facility.position.y}` }
}

/** 設施在地圖上的實際場域座標（公尺）；有 bounds 時取中心 */
export function resolveFacilityFieldMeters(
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
  const { xM, yM } = resolveFacilityFieldMeters(facility)

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
  if (f.type === 'DockingPoint' || f.type === 'Waypoint') {
    return ''
  }
  return getComponentPurpose(f)
}

function toListEntry(
  area: MapAreaObject,
  f: FacilityObject,
  overrides?: Partial<FacilityListEntry>,
): FacilityListEntry {
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
    pointKind: f.type === 'DockingPoint' ? 'docking' : undefined,
    ...overrides,
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

/** 大型設施內設定的設施停靠點（點位清單分類用） */
export function collectFacilityDockingPointEntries(
  areas: MapAreaObject[],
): FacilityListEntry[] {
  const out: FacilityListEntry[] = []
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'Facility' || f.name !== 'FacilityArea') continue
      const point = getFacilityDockingPoint(f)
      if (!point) continue
      const local = fieldPositionToFacilityAreaLocal(point.xM, point.yM, f, area, {
        extrapolate: false,
      })
      const pxX = local?.x ?? facilityAreaPx(area, f).pxX
      const pxY = local?.y ?? facilityAreaPx(area, f).pxY
      const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
      out.push(
        toListEntry(area, f, {
          name: resolveFacilityDockingPointListTitle(f),
          purpose: getComponentPurpose(f) || '設施停靠點',
          refFieldText: `${fmt(point.xM)}, ${fmt(point.yM)} m`,
          refFieldKey: `fdock|${point.xM}|${point.yM}`,
          pxX,
          pxY,
          pointKind: 'facility-docking',
        }),
      )
    }
  }
  return sortEntries(out)
}

/**
 * 途經點清單。
 *
 * 途經點原本<strong>哪裡都列不到</strong>：點位清單只有停靠點與設施停靠點兩節，
 * 設施清單只收 type = Facility。放下去的途經點只有在路網拓撲編輯器裡看得到，
 * 於是「我明明加了兩個」跟「清單裡沒有」同時成立。
 *
 * 三種來源都算途經點，功能一樣，只是存的地方不同：
 * - 元件庫放下去的 Waypoint
 * - 交叉軌道（RailCross）的四個口
 * - 舊圖虛擬渡線（TrackCrossover）的兩個端點
 */
export function collectWaypointEntries(
  areas: MapAreaObject[],
): FacilityListEntry[] {
  const out: FacilityListEntry[] = []
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type === 'Waypoint') {
        out.push(
          toListEntry(area, f, {
            purpose: getWaypointCode(f),
            pointKind: 'waypoint',
          }),
        )
        continue
      }

      if (f.name === 'RailCross') {
        const portals = getCrossPortals(f)
        const fields = resolveCrossPortalFields(f, area)
        for (const key of CROSS_PORTAL_UI_ORDER) {
          const code = portals[key].waypointCode?.trim()
          if (!code) continue
          const field = fields[key]
          const known = field.xM !== null && field.yM !== null
          const px = known
            ? meterToAreaLocalPx(field.xM as number, field.yM as number, area.domain, area.layout)
            : null
          out.push(
            toListEntry(area, f, {
              name: resolveCrossPortalDisplayName(portals[key]),
              purpose: code,
              refFieldText: known
                ? `${fmt(field.xM as number)}, ${fmt(field.yM as number)} m`
                : '未設定場域座標',
              refFieldKey: `xcwp|${f.id}|${key}|${field.xM}|${field.yM}`,
              ...(px ? { pxX: px.x, pxY: px.y } : {}),
              pointKind: 'waypoint',
            }),
          )
        }
        continue
      }

      if (f.type === 'TrackCrossover') {
        const portals = getCrossoverPortals(f)
        if (!portals) continue
        for (const key of CROSSOVER_PORTAL_KEYS) {
          const portal = portals[key]
          const code = portal.waypointCode?.trim()
          if (!code) continue
          const { xM, yM } = crossoverPortalFieldMeters(portal)
          const px = meterToAreaLocalPx(xM, yM, area.domain, area.layout)
          out.push(
            toListEntry(area, f, {
              name: resolveCrossoverPortalDisplayName(portal),
              purpose: code,
              refFieldText: `${fmt(xM)}, ${fmt(yM)} m`,
              refFieldKey: `xowp|${f.id}|${key}|${xM}|${yM}`,
              pxX: px.x,
              pxY: px.y,
              pointKind: 'waypoint',
            }),
          )
        }
      }
    }
  }

  return sortEntries(out)
}

export function collectFacilityEntries(
  areas: MapAreaObject[],
): FacilityListEntry[] {
  /** 設施清單：大型區塊（充電格／停車格／維修格等） */
  return collectByType(areas, ['Facility'])
}

export function collectEquipmentEntries(areas: MapAreaObject[]): {
  signals: FacilityListEntry[]
  poles: FacilityListEntry[]
  psds: FacilityListEntry[]
} {
  /** 設備清單：紅綠燈、智慧桿、月台門 */
  return {
    signals: collectByType(areas, ['Signal']),
    poles: collectByType(areas, ['Pole']),
    psds: collectByType(areas, ['PSD']),
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

  // 有設施停靠點時，清單／對焦優先對準該點
  if (facility.type === 'Facility' && facility.name === 'FacilityArea') {
    const dock = getFacilityDockingPoint(facility)
    if (dock) {
      const local = fieldPositionToFacilityAreaLocal(
        dock.xM,
        dock.yM,
        facility,
        area,
        { extrapolate: false },
      )
      if (local) {
        const css = areaPositionToCssTopLeft(local, { w: 0, h: 0 }, area.layout.hPx)
        return {
          x: area.layout.xPx + css.left,
          y: area.layout.yPx + css.top,
        }
      }
    }
  }

  const local = facilityAreaPx(area, facility)
  return {
    x: area.layout.xPx + local.pxX,
    y: area.layout.yPx + local.pxY,
  }
}
