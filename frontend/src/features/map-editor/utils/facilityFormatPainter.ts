import { getFacilitySizeMeters } from '../constants/facilityDimensions'
import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import type { FacilityName, FacilityObject, GeofenceFacility, RotationDeg } from '../types/facility'
import type { FacilityType } from '../types/facility'
import { resolveFacilityAreaSize } from './facilityAreaCoords'
import {
  bboxMeters,
  getGeofenceParams,
  syncGeofenceFacility,
  type GeofenceTextLabel,
} from './geofence'
import {
  getFacilityLabelStyle,
  labelStyleToParameters,
  type FacilityLabelStyle,
} from './facilityLabelStyle'
import {
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'
import { TRACK_CORNER_RADIUS_KEY } from './trackCornerRadius'

export type FacilityFrameStrokeSnapshot = {
  /** 是否顯示框線（與屬性面板「顯示框線」一致） */
  enabled: boolean
  widthPx: number
  color: string
  style: 'solid' | 'dashed' | 'dotted'
}

export type FacilityFormatSnapshot = {
  facilityType: FacilityType
  facilityName: FacilityName
  /** 元件旋轉角度（度） */
  rotation: RotationDeg
  /** 圖台顯示尺寸（絕對畫素；跨 Area 貼格式不換算） */
  canvasSizePx: { w: number; h: number }
  /** 圍籬頂點縮放用（公尺語意） */
  layoutSizeM: { w: number; h: number }
  parameters: Record<string, unknown>
  /** Track / Facility 等元件框線（有無、粗細、顏色、線型） */
  frameStroke?: FacilityFrameStrokeSnapshot
}

type DomainSpan = { w: number; h: number }

function cloneLabelStyle(style: FacilityLabelStyle): FacilityLabelStyle {
  return { ...style }
}

function extractFrameStroke(
  params: Record<string, unknown>,
): FacilityFrameStrokeSnapshot {
  const strokeWidthPx =
    typeof params.strokeWidthPx === 'number' ? Math.max(0, params.strokeWidthPx) : 0
  const strokeColor =
    typeof params.strokeColor === 'string' ? params.strokeColor.trim() : 'transparent'
  const strokeStyle =
    params.strokeStyle === 'dashed' ||
    params.strokeStyle === 'dotted' ||
    params.strokeStyle === 'solid'
      ? params.strokeStyle
      : 'solid'
  const enabled = strokeWidthPx > 0 && strokeColor !== 'transparent'
  return {
    enabled,
    widthPx: enabled ? strokeWidthPx : 0,
    color: enabled ? strokeColor : 'transparent',
    style: strokeStyle,
  }
}

function applyFrameStroke(
  nextParams: Record<string, unknown>,
  stroke: FacilityFrameStrokeSnapshot,
): void {
  if (!stroke.enabled) {
    delete nextParams.strokeWidthPx
    delete nextParams.strokeColor
    delete nextParams.strokeStyle
    return
  }
  nextParams.strokeWidthPx = stroke.widthPx
  nextParams.strokeColor = stroke.color
  nextParams.strokeStyle = stroke.style
}

/** 是否為相同 palette 元件（type + name） */
export function canApplyFacilityFormat(
  snapshot: FacilityFormatSnapshot,
  target: FacilityObject,
): boolean {
  return (
    snapshot.facilityType === target.type &&
    snapshot.facilityName === target.name
  )
}

export function extractFacilityFormat(
  facility: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: DomainSpan,
): FacilityFormatSnapshot {
  const canvasSizePx = resolveFacilityAreaSize(facility, domain, layout, domainSpan)
  const layoutSizeM = getFacilitySizeMeters(facility, domainSpan)
  const parameters: Record<string, unknown> = {}

  if (facility.type === 'Geofence') {
    const p = getGeofenceParams(facility)
    parameters.strokeColor = p.strokeColor
    parameters.fillColor = p.fillBaseColor
    parameters.fillOpacity = p.fillOpacity
    parameters.strokeWidthPx = p.strokeWidthPx
    parameters.strokeStyle = p.strokeStyle
    parameters.fillEnabled = p.fillEnabled
    // 圍籬框線一律帶入有效值（含預設），貼上時還原線型與粗細
    const firstLabel = p.labels[0]
    if (firstLabel) {
      parameters.geofenceLabelFont = {
        fontSizePx: firstLabel.fontSizePx,
        fontWeight: firstLabel.fontWeight,
      }
    }
    const gfParams = facility.parameters ?? {}
    for (const key of [
      REF_FIELD_X_MIN_M,
      REF_FIELD_X_MAX_M,
      REF_FIELD_Y_MIN_M,
      REF_FIELD_Y_MAX_M,
    ] as const) {
      if (typeof gfParams[key] === 'number') {
        parameters[key] = gfParams[key]
      }
    }
  } else {
    const params = facility.parameters ?? {}
    if (typeof params.defaultFillColor === 'string') {
      parameters.defaultFillColor = params.defaultFillColor
    }

    const labelStyle = getFacilityLabelStyle(facility)
    if (Object.keys(labelStyle).length > 0) {
      parameters.labelStyle = cloneLabelStyle(labelStyle)
    }

    for (const key of [
      REF_FIELD_X_MIN_M,
      REF_FIELD_X_MAX_M,
      REF_FIELD_Y_MIN_M,
      REF_FIELD_Y_MAX_M,
    ] as const) {
      if (typeof params[key] === 'number') {
        parameters[key] = params[key]
      }
    }

    const trackCorners = params[TRACK_CORNER_RADIUS_KEY]
    if (trackCorners && typeof trackCorners === 'object') {
      parameters[TRACK_CORNER_RADIUS_KEY] = trackCorners
    }
  }

  const frameStroke =
    facility.type !== 'Geofence'
      ? extractFrameStroke(facility.parameters ?? {})
      : undefined

  return {
    facilityType: facility.type,
    facilityName: facility.name,
    rotation: facility.rotation ?? 0,
    canvasSizePx: { w: canvasSizePx.w, h: canvasSizePx.h },
    layoutSizeM: { w: layoutSizeM.w, h: layoutSizeM.h },
    parameters,
    frameStroke,
  }
}

function scaleGeofenceVerticesToSize(
  verticesMeters: { x: number; y: number }[],
  targetSize: { w: number; h: number },
): { x: number; y: number }[] {
  const box = bboxMeters(verticesMeters)
  if (box.w < 1e-9 || box.h < 1e-9) return verticesMeters
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const sx = targetSize.w / box.w
  const sy = targetSize.h / box.h
  return verticesMeters.map((v) => ({
    x: cx + (v.x - cx) * sx,
    y: cy + (v.y - cy) * sy,
  }))
}

function applyGeofenceLabelFont(
  labels: GeofenceTextLabel[],
  font: { fontSizePx?: number; fontWeight?: 'normal' | 'bold' } | undefined,
): GeofenceTextLabel[] {
  if (!font) return labels
  return labels.map((lb) => ({
    ...lb,
    ...(typeof font.fontSizePx === 'number'
      ? { fontSizePx: font.fontSizePx }
      : {}),
    ...(font.fontWeight ? { fontWeight: font.fontWeight } : {}),
  }))
}

function withCanvasSizePx(
  facility: FacilityObject,
  canvasSizePx: { w: number; h: number },
): FacilityObject {
  return { ...facility, areaSizePx: canvasSizePx }
}

export function applyFacilityFormat(
  target: FacilityObject,
  snapshot: FacilityFormatSnapshot,
  _domain: MapAreaDomain,
  _layout: MapAreaLayout,
  _domainSpan?: DomainSpan,
): FacilityObject {
  if (!canApplyFacilityFormat(snapshot, target)) return target

  if (target.type === 'Geofence') {
    const gf = target as GeofenceFacility
    const cur = getGeofenceParams(gf)
    const font = snapshot.parameters.geofenceLabelFont as
      | { fontSizePx?: number; fontWeight?: 'normal' | 'bold' }
      | undefined
    const scaledVerts = scaleGeofenceVerticesToSize(
      cur.verticesMeters,
      snapshot.layoutSizeM,
    )
    const nextLabels = applyGeofenceLabelFont(cur.labels, font)
    const gfParams: Record<string, unknown> = { ...(gf.parameters ?? {}) }
    for (const key of [
      REF_FIELD_X_MIN_M,
      REF_FIELD_X_MAX_M,
      REF_FIELD_Y_MIN_M,
      REF_FIELD_Y_MAX_M,
    ] as const) {
      if (snapshot.parameters[key] !== undefined) {
        gfParams[key] = snapshot.parameters[key]
      }
    }
    const synced = syncGeofenceFacility({
      ...gf,
      parameters: {
        ...gfParams,
        verticesMeters: scaledVerts,
        strokeColor: snapshot.parameters.strokeColor as string | undefined,
        fillColor: snapshot.parameters.fillColor as string | undefined,
        fillOpacity: snapshot.parameters.fillOpacity as number | undefined,
        strokeWidthPx: snapshot.parameters.strokeWidthPx as number | undefined,
        strokeStyle: snapshot.parameters.strokeStyle as
          | 'solid'
          | 'dashed'
          | 'dotted'
          | undefined,
        fillEnabled: snapshot.parameters.fillEnabled as boolean | undefined,
        labels: nextLabels,
      },
    })
    return withCanvasSizePx(
      { ...synced, rotation: snapshot.rotation },
      snapshot.canvasSizePx,
    )
  }

  const nextParams = { ...(target.parameters ?? {}) }
  if (snapshot.parameters.defaultFillColor !== undefined) {
    nextParams.defaultFillColor = snapshot.parameters.defaultFillColor
  }

  if (snapshot.frameStroke) {
    applyFrameStroke(nextParams, snapshot.frameStroke)
  } else {
    // 舊版快照相容：parameters 內仍有 stroke 欄位時一併貼上
    if (snapshot.parameters.strokeColor !== undefined) {
      nextParams.strokeColor = snapshot.parameters.strokeColor
    }
    if (snapshot.parameters.strokeWidthPx !== undefined) {
      nextParams.strokeWidthPx = snapshot.parameters.strokeWidthPx
    }
    if (snapshot.parameters.strokeStyle !== undefined) {
      nextParams.strokeStyle = snapshot.parameters.strokeStyle
    }
  }

  if (snapshot.parameters.labelStyle !== undefined) {
    Object.assign(
      nextParams,
      labelStyleToParameters(
        snapshot.parameters.labelStyle as FacilityLabelStyle,
      ),
    )
  }

  for (const key of [
    REF_FIELD_X_MIN_M,
    REF_FIELD_X_MAX_M,
    REF_FIELD_Y_MIN_M,
    REF_FIELD_Y_MAX_M,
  ] as const) {
    if (snapshot.parameters[key] !== undefined) {
      nextParams[key] = snapshot.parameters[key]
    }
  }

  if (snapshot.parameters[TRACK_CORNER_RADIUS_KEY] !== undefined) {
    nextParams[TRACK_CORNER_RADIUS_KEY] =
      snapshot.parameters[TRACK_CORNER_RADIUS_KEY]
  }

  return withCanvasSizePx(
    {
      ...target,
      rotation: snapshot.rotation,
      parameters: Object.keys(nextParams).length > 0 ? nextParams : undefined,
    } as FacilityObject,
    snapshot.canvasSizePx,
  )
}
