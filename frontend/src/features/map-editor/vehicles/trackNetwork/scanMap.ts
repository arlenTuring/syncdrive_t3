import type { MapAreaObject } from '../../types/area';
import type { FacilityObject } from '../../types/facility';
import {
  getValidRefFieldBounds,
  isZeroRefFieldBoundsSpan,
  refFieldBoundsSpanMeters,
} from '../../utils/facilityRefFieldBounds';
import type { TrackNetwork, TrackNetworkSegment } from './types';

function trackCodeFromFacility(track: FacilityObject): string | null {
  const fromName = track.customName?.trim();
  if (fromName) return fromName;
  const segId = track.parameters?.segmentId;
  if (typeof segId === 'string' && segId.trim()) return segId.trim();
  return null;
}

/** 同時以 segmentId 註冊別名（如 D06 / R06）供 MQTT 定位 */
function trackCodesFromFacility(track: FacilityObject): string[] {
  const codes = new Set<string>();
  const primary = trackCodeFromFacility(track);
  if (primary) codes.add(primary);
  const segId = track.parameters?.segmentId;
  if (typeof segId === 'string' && segId.trim()) codes.add(segId.trim());
  return [...codes];
}

/**
 * 掃描全圖 Track refField，建立場域座標網路。
 * Area 只帶出各 Track 的 canvas 渲染錨點，不作分區或定位依據。
 */
export function buildTrackNetwork(areas: MapAreaObject[]): TrackNetwork {
  const segments: TrackNetworkSegment[] = [];

  for (const area of areas) {
    for (const track of area.facilities ?? []) {
      if (track.type !== 'Track') continue;
      if (isZeroRefFieldBoundsSpan(track.parameters)) continue;
      const bounds = getValidRefFieldBounds(track.parameters);
      if (!bounds) continue;
      const span = refFieldBoundsSpanMeters(bounds);
      if (!span) continue;

      segments.push({
        trackId: track.id,
        trackCode: trackCodeFromFacility(track),
        bounds,
        horizontal: span.w >= span.h,
        track,
        renderArea: area,
      });
      const aliases = trackCodesFromFacility(track);
      const primary = trackCodeFromFacility(track);
      for (const alias of aliases) {
        if (alias === primary) continue;
        segments.push({
          trackId: track.id,
          trackCode: alias,
          bounds,
          horizontal: span.w >= span.h,
          track,
          renderArea: area,
        });
      }
    }
  }

  return { segments };
}

const networkByAreas = new WeakMap<MapAreaObject[], TrackNetwork>();

export function getTrackNetwork(areas: MapAreaObject[]): TrackNetwork {
  let network = networkByAreas.get(areas);
  if (!network) {
    network = buildTrackNetwork(areas);
    networkByAreas.set(areas, network);
  }
  return network;
}

export function invalidateTrackNetworkCache(areas: MapAreaObject[]): void {
  networkByAreas.delete(areas);
}
