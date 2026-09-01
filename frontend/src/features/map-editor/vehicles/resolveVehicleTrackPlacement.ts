import type { MapAreaObject } from '../types/area';
import type { FacilityObject } from '../types/facility';
import { isMeterInDomain, meterToAreaLocalPx } from '../utils/areaCoords';
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from '../utils/facilityAreaCoords';
import {
  getValidRefFieldBounds,
  hasValidRefFieldBounds,
  refFieldBoundsSpanMeters,
} from '../utils/facilityRefFieldBounds';
import {
  isYardParkableFacilityId,
  parseYardSlotFromPayload,
  resolveYardFacilityFieldMeters,
} from '../utils/yardFacilitySlots';
import {
  buildTrackNetwork,
  getTrackNetwork,
} from './trackNetwork/scanMap';
import type { TrackNetwork } from './trackNetwork/types';
import { locateOnCrossover } from './trackNetwork/crossoverLocate';
import { locateOnTrackNetwork, trackCodeAtFieldPoint } from './trackNetwork/locate';

export type VehicleTrackPlacement = {
  areaLocalX: number;
  areaLocalY: number;
  trackId: string;
  /** @deprecated 巢狀定位不再使用分數；保留欄位相容舊型別 */
  score: number;
};

export type VehiclePlacementAcrossAreas = {
  area: MapAreaObject;
  placement: VehicleTrackPlacement;
};

/** MQTT 整備／充電／臨停：應顯示在格位區，不吸附主軌道 */
export function isYardVehiclePayload(
  payload: Record<string, unknown> | undefined,
): boolean {
  if (!payload) return false;
  const yardSlot = payload.yard_slot_id ?? payload.yardSlotId;
  if (typeof yardSlot === 'string' && yardSlot.trim()) return true;
  const leg = payload.current_leg;
  if (leg === 'yard') return true;
  const trip = payload.trip_code ?? payload.tripCode;
  if (trip === 'YARD') return true;
  const segment = payload.segment_label;
  if (typeof segment === 'string') {
    const label = segment.trim();
    if (/^(E\d+|P[1-4]|H\d+|M\d+|W\d+)$/i.test(label)) return true;
    return (
      label.startsWith('充電 ') ||
      label.startsWith('充電等候 ') ||
      label.startsWith('臨停 ') ||
      label.startsWith('整備 ')
    );
  }
  return false;
}

function locateInAreaDomain(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
): VehiclePlacementAcrossAreas | null {
  for (const area of areas) {
    if (!isMeterInDomain(xM, yM, area.domain)) continue;
    const local = meterToAreaLocalPx(xM, yM, area.domain, area.layout);
    return {
      area,
      placement: {
        areaLocalX: local.x,
        areaLocalY: local.y,
        trackId: 'yard',
        score: 1,
      },
    };
  }
  return null;
}

/** 從 MQTT 解析整備格代號（充電 E1、臨停 P1、整備 H1） */
export function parseYardSlotIdFromPayload(
  payload: Record<string, unknown> | undefined,
): string | null {
  return parseYardSlotFromPayload(payload)?.slotId ?? null;
}

function placementAtFieldMeters(
  facility: FacilityObject,
  area: MapAreaObject,
  xM: number,
  yM: number,
): VehiclePlacementAcrossAreas | null {
  if (facility.type === 'Track') {
    const local = fieldPositionToTrackAreaLocal(xM, yM, facility, area, {
      extrapolate: false,
    });
    if (!local) return null;
    return {
      area,
      placement: {
        areaLocalX: local.x,
        areaLocalY: local.y,
        trackId: facility.id,
        score: 1,
      },
    };
  }

  const local = fieldPositionToFacilityAreaLocal(xM, yM, facility, area, {
    extrapolate: false,
  });
  if (!local) return null;
  return {
    area,
    placement: {
      areaLocalX: local.x,
      areaLocalY: local.y,
      trackId: facility.id,
      score: 1,
    },
  };
}

function placementAtFacilityAreaCenter(
  facility: FacilityObject,
  area: MapAreaObject,
): VehiclePlacementAcrossAreas {
  const areaPos = resolveFacilityAreaPosition(facility, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(facility, area.domain, area.layout);
  return {
    area,
    placement: {
      areaLocalX: areaPos.x + areaSize.w / 2,
      areaLocalY: areaPos.y + areaSize.h / 2,
      trackId: facility.id,
      score: 1,
    },
  };
}

/** 整備／充電／臨停：對齊地圖格子的參照場域或元件外框中心 */
export function resolveYardFacilityPlacement(
  areas: MapAreaObject[],
  payload: Record<string, unknown> | undefined,
): VehiclePlacementAcrossAreas | null {
  const yardSlot = parseYardSlotFromPayload(payload);
  if (!yardSlot || !isYardParkableFacilityId(yardSlot.slotId)) return null;

  const field = resolveYardFacilityFieldMeters(yardSlot.slotId, areas, {
    subIndex: yardSlot.subIndex,
  });
  if (!field) return null;

  const refFieldPlacement = placementAtFieldMeters(
    field.facility,
    field.area,
    field.xM,
    field.yM,
  );
  if (refFieldPlacement) return refFieldPlacement;
  return placementAtFacilityAreaCenter(field.facility, field.area);
}

function normalizeSegmentToken(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  const arrow = trimmed.split('→').pop()?.trim();
  return arrow || trimmed;
}

function fieldPointInRefField(
  xM: number,
  yM: number,
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): boolean {
  return (
    xM >= bounds.xMinM &&
    xM <= bounds.xMaxM &&
    yM >= bounds.yMinM &&
    yM <= bounds.yMaxM
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function readRotationDeg(track: FacilityObject): number {
  const deg = track.rotation ?? 0;
  return Number.isFinite(deg) ? deg : 0;
}

/** 依 MQTT segment_label 對應軌道元件（customName / segmentId） */
export function findTrackBySegmentLabel(
  area: MapAreaObject,
  segmentLabel: string | undefined,
): FacilityObject | null {
  if (!segmentLabel?.trim()) return null;
  const label = segmentLabel.trim();
  const token = normalizeSegmentToken(label);
  const tracks = (area.facilities ?? []).filter((f) => f.type === 'Track');

  for (const track of tracks) {
    if (track.customName === label || track.customName === token) return track;
    const segId = track.parameters?.segmentId;
    if (typeof segId === 'string' && (segId === label || segId === token)) return track;
  }

  const prefix = label.split('→')[0]?.trim();
  if (prefix) {
    for (const track of tracks) {
      if (track.customName === prefix) return track;
      const segId = track.parameters?.segmentId;
      if (typeof segId === 'string' && segId === prefix) return track;
    }
  }

  return null;
}

/**
 * 場域 (x,y) 公尺 → 設施元件在 Area 內的區域座標（依參照場域範圍參數化映射）。
 * extrapolate=false 時 along 箝制在 0–1（範圍外不應呼叫）。
 */
export function fieldPositionToFacilityAreaLocal(
  xM: number,
  yM: number,
  facility: FacilityObject,
  area: MapAreaObject,
  options?: { extrapolate?: boolean },
): { x: number; y: number } | null {
  if (!hasValidRefFieldBounds(facility.parameters)) return null;

  const bounds = getValidRefFieldBounds(facility.parameters);
  if (!bounds) return null;

  const span = refFieldBoundsSpanMeters(bounds);
  if (!span) return null;

  const areaPos = resolveFacilityAreaPosition(facility, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(facility, area.domain, area.layout);

  let alongX = (xM - bounds.xMinM) / span.w;
  let alongY = (yM - bounds.yMinM) / span.h;
  if (!options?.extrapolate) {
    alongX = clamp01(alongX);
    alongY = clamp01(alongY);
  }

  let localX = areaPos.x + alongX * areaSize.w;
  let localY = areaPos.y + alongY * areaSize.h;

  const rotDeg = readRotationDeg(facility);
  if (Math.abs(rotDeg) > 0.001) {
    const cx = areaPos.x + areaSize.w / 2;
    const cy = areaPos.y + areaSize.h / 2;
    const rad = (rotDeg * Math.PI) / 180;
    const dx = localX - cx;
    const dy = localY - cy;
    localX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    localY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }

  return { x: localX, y: localY };
}

/**
 * 將 MQTT 場域座標（公尺）換算成圖台上該軌道段的區域座標。
 * extrapolate=false 時 along 箝制在 0–1（段外不應呼叫）。
 */
export function fieldPositionToTrackAreaLocal(
  xM: number,
  yM: number,
  track: FacilityObject,
  area: MapAreaObject,
  options?: { extrapolate?: boolean },
): { x: number; y: number } | null {
  if (!hasValidRefFieldBounds(track.parameters)) return null;

  const bounds = getValidRefFieldBounds(track.parameters);
  if (!bounds) return null;

  const span = refFieldBoundsSpanMeters(bounds);
  if (!span) return null;

  const areaPos = resolveFacilityAreaPosition(track, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(track, area.domain, area.layout);
  const horizontal = span.w >= span.h;

  let along = horizontal
    ? (xM - bounds.xMinM) / span.w
    : (yM - bounds.yMinM) / span.h;
  if (!options?.extrapolate) {
    along = clamp01(along);
  }

  let localX: number;
  let localY: number;
  if (horizontal) {
    localX = areaPos.x + along * areaSize.w;
    localY = areaPos.y + areaSize.h / 2;
  } else {
    localY = areaPos.y + (1 - along) * areaSize.h;
    localX = areaPos.x + areaSize.w / 2;
  }

  const rotDeg = readRotationDeg(track);
  if (Math.abs(rotDeg) > 0.001) {
    const cx = areaPos.x + areaSize.w / 2;
    const cy = areaPos.y + areaSize.h / 2;
    const rad = (rotDeg * Math.PI) / 180;
    const dx = localX - cx;
    const dy = localY - cy;
    localX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    localY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }

  return { x: localX, y: localY };
}

function placementFromTrackInArea(
  xM: number,
  yM: number,
  area: MapAreaObject,
  track: FacilityObject,
): VehicleTrackPlacement | null {
  const local = fieldPositionToTrackAreaLocal(xM, yM, track, area, { extrapolate: false });
  if (!local) return null;
  return {
    areaLocalX: local.x,
    areaLocalY: local.y,
    trackId: track.id,
    score: 1,
  };
}

/** 在單一 Area 內：僅 refField 段內命中才換算（不吸附、不用 domain） */
export function resolveVehicleTrackPlacementInArea(
  xM: number,
  yM: number,
  area: MapAreaObject,
): VehicleTrackPlacement | null {
  for (const track of area.facilities ?? []) {
    if (track.type !== 'Track') continue;
    const bounds = getValidRefFieldBounds(track.parameters);
    if (!bounds || !fieldPointInRefField(xM, yM, bounds)) continue;
    return placementFromTrackInArea(xM, yM, area, track);
  }
  return null;
}

/**
 * 全圖定位：橫渡線優先，再掃 Track refField。
 *
 * 橫渡線與軌道帶在場域上重疊——若先吸到軌道中心線，轉線途中的車會在上下行之間
 * 「飄／跳」。模擬器路徑點正確、圖台卻飄，多半就是這裡少了橫渡線這一步。
 */
export function resolveVehiclePlacementAcrossAreas(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
  network?: TrackNetwork,
  options?: {
    preferYardPlacement?: boolean;
    payload?: Record<string, unknown>;
  },
): VehiclePlacementAcrossAreas | null {
  const net = network ?? getTrackNetwork(areas);
  const preferYard = options?.preferYardPlacement === true;

  if (preferYard) {
    return resolveYardFacilityPlacement(areas, options?.payload);
  }

  // 緊貼橫渡線（2 m）：即使同時落在軌道帶 AABB 裡，也畫在渡線上
  const onCrossover = locateOnCrossover(areas, xM, yM, 2);
  if (onCrossover) return onCrossover;

  const onTrack = locateOnTrackNetwork(net, xM, yM);
  if (onTrack) return onTrack;

  // 略寬：portal 外緣、尚未落入任何 refField 的點
  const onCrossoverLoose = locateOnCrossover(areas, xM, yM, 6);
  if (onCrossoverLoose) return onCrossoverLoose;

  return locateInAreaDomain(areas, xM, yM);
}

/** 圖台標籤：僅在 refField 段內時回傳軌道代碼 */
export function resolveTrackCodeForDisplay(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
  network?: TrackNetwork,
): string | null {
  const net = network ?? getTrackNetwork(areas);
  return trackCodeAtFieldPoint(net, xM, yM);
}

export { buildTrackNetwork, getTrackNetwork, type TrackNetwork };
export { findRefFieldOverlaps } from './trackNetwork/validate';
