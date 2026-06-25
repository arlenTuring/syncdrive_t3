import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  usesRefFieldBounds,
  usesRefFieldPoint,
} from './facilityRefFieldBinding'
import {
  getRefFieldBounds,
  hasValidRefFieldBounds,
  isZeroRefFieldBoundsSpan,
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'
import {
  getRefFieldPosition,
  hasValidRefFieldPosition,
  REF_FIELD_X_M,
  REF_FIELD_Y_M,
} from './facilityRefFieldPosition'
import { applyZeroRefFieldBoundsToFacility } from './refFieldZeroPolicy'
import type { ParsedMapFile } from './mapFileJson'

function localNeedsRefFields(
  facility: FacilityObject,
): boolean {
  const { type, parameters } = facility
  /** Track 占位 0 仍須從內建檔補 refField，否則 MQTT 無法定位 */
  if (type === 'Track' && isZeroRefFieldBoundsSpan(parameters)) return true
  /** Facility／Geofence 缺有效範圍（含 unset、0 占位）時向內建檔補 */
  if (type === 'Facility' || type === 'Geofence') {
    return !hasValidRefFieldBounds(parameters)
  }
  if (isZeroRefFieldBoundsSpan(parameters)) return false
  if (usesRefFieldPoint(type)) return !hasValidRefFieldPosition(parameters)
  if (usesRefFieldBounds(type)) return !hasValidRefFieldBounds(parameters)
  return false
}

function refFieldPatchFromRemote(
  facility: FacilityObject,
): Record<string, number> | null {
  const { type, parameters } = facility
  if (usesRefFieldPoint(type)) {
    if (!hasValidRefFieldPosition(parameters)) return null
    const { xM, yM } = getRefFieldPosition(parameters)
    return { [REF_FIELD_X_M]: xM!, [REF_FIELD_Y_M]: yM! }
  }
  if (usesRefFieldBounds(type)) {
    if (!hasValidRefFieldBounds(parameters)) return null
    const b = getRefFieldBounds(parameters)
    return {
      [REF_FIELD_X_MIN_M]: b.xMinM!,
      [REF_FIELD_X_MAX_M]: b.xMaxM!,
      [REF_FIELD_Y_MIN_M]: b.yMinM!,
      [REF_FIELD_Y_MAX_M]: b.yMaxM!,
    }
  }
  return null
}

function mergeFacilitiesInArea(
  localFacilities: FacilityObject[],
  remoteFacilities: FacilityObject[],
  options?: { forceTrackRefFields?: boolean },
): FacilityObject[] {
  return localFacilities.map((lf) => {
    const normalized = applyZeroRefFieldBoundsToFacility(lf)
    const rf = remoteFacilities.find((f) => f.id === lf.id && f.type === lf.type)
    if (!rf) return normalized
    if (options?.forceTrackRefFields && lf.type === 'Track') {
      const patch = refFieldPatchFromRemote(rf)
      if (patch) {
        return {
          ...normalized,
          parameters: { ...(normalized.parameters ?? {}), ...patch },
        }
      }
    }
    if (!localNeedsRefFields(normalized)) return normalized
    const patch = refFieldPatchFromRemote(rf)
    if (!patch) return normalized
    return {
      ...normalized,
      parameters: { ...(normalized.parameters ?? {}), ...patch },
    }
  })
}

/** 內建檔已有參照場域，但本機副本仍缺值時需合併 */
export function builtinRefFieldsNeedMerge(
  local: ParsedMapFile,
  remote: ParsedMapFile,
): boolean {
  for (const remoteArea of remote.areas) {
    const localArea = local.areas.find((a) => a.id === remoteArea.id)
    if (!localArea) continue
    for (const rf of remoteArea.facilities) {
      const lf = localArea.facilities.find(
        (f) => f.id === rf.id && f.type === rf.type,
      )
      if (!lf) continue
      if (!refFieldPatchFromRemote(rf)) continue
      if (localNeedsRefFields(lf)) return true
    }
  }
  return false
}

/** 將內建檔的參照場域欄位併入本機副本（保留像素／版面編輯） */
export function mergeBuiltinRefFieldsIntoParsed(
  local: ParsedMapFile,
  remote: ParsedMapFile,
): ParsedMapFile {
  const areas: MapAreaObject[] = local.areas.map((localArea) => {
    const remoteArea = remote.areas.find((a) => a.id === localArea.id)
    if (!remoteArea) {
      return {
        ...localArea,
        facilities: (localArea.facilities ?? []).map(
          applyZeroRefFieldBoundsToFacility,
        ),
      }
    }
    return {
      ...localArea,
      facilities: mergeFacilitiesInArea(
        localArea.facilities,
        remoteArea.facilities,
      ),
    }
  })
  return { ...local, areas }
}

/**
 * 圖台 MQTT 定位：一律以內建檔覆寫 Track refField（保留本機像素版面）。
 * 避免本機地圖庫占位 0 或過期 refField 導致車輛無法放置。
 */
export function mergePlatformRefFieldsFromBuiltin(
  local: ParsedMapFile,
  remote: ParsedMapFile,
): ParsedMapFile {
  const areas: MapAreaObject[] = local.areas.map((localArea) => {
    const remoteArea = remote.areas.find((a) => a.id === localArea.id)
    if (!remoteArea) {
      return {
        ...localArea,
        facilities: (localArea.facilities ?? []).map(
          applyZeroRefFieldBoundsToFacility,
        ),
      }
    }
    return {
      ...localArea,
      facilities: mergeFacilitiesInArea(
        localArea.facilities,
        remoteArea.facilities,
        { forceTrackRefFields: true },
      ),
    }
  })
  return { ...local, areas }
}

/** 載入內建／遠端地圖後套用 refField 零值政策 */
export function applyRefFieldZeroPolicyToParsed(
  parsed: ParsedMapFile,
): ParsedMapFile {
  return {
    ...parsed,
    areas: parsed.areas.map((area) => ({
      ...area,
      facilities: (area.facilities ?? []).map(applyZeroRefFieldBoundsToFacility),
    })),
  }
}
