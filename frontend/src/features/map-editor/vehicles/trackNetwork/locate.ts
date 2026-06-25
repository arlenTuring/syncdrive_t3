import type { VehiclePlacementAcrossAreas, VehicleTrackPlacement } from '../resolveVehicleTrackPlacement';
import { fieldPositionToTrackAreaLocal } from '../resolveVehicleTrackPlacement';
import type { TrackNetwork, TrackNetworkSegment } from './types';

function fieldPointInRefField(
  xM: number,
  yM: number,
  bounds: TrackNetworkSegment['bounds'],
): boolean {
  return (
    xM >= bounds.xMinM &&
    xM <= bounds.xMaxM &&
    yM >= bounds.yMinM &&
    yM <= bounds.yMaxM
  );
}

/** 命中 refField 的段；重疊視為地圖資料錯誤，以 trackId 決定性取一 */
export function findRefFieldSegmentsAtPoint(
  network: TrackNetwork,
  xM: number,
  yM: number,
): TrackNetworkSegment[] {
  return network.segments.filter((seg) => fieldPointInRefField(xM, yM, seg.bounds));
}

export function pickRefFieldSegment(
  matches: TrackNetworkSegment[],
): TrackNetworkSegment | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return matches.slice().sort((a, b) => a.trackId.localeCompare(b.trackId))[0] ?? null;
}

/**
 * 場域 (x,y) 定位：僅 refField 段內命中才回傳圖台座標。
 * 段外不吸附、不外插；Area 不作空間查詢。
 */
export function locateOnTrackNetwork(
  network: TrackNetwork,
  xM: number,
  yM: number,
): VehiclePlacementAcrossAreas | null {
  const segment = pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM));
  if (!segment) return null;

  const local = fieldPositionToTrackAreaLocal(xM, yM, segment.track, segment.renderArea, {
    extrapolate: false,
  });
  if (!local) return null;

  const placement: VehicleTrackPlacement = {
    areaLocalX: local.x,
    areaLocalY: local.y,
    trackId: segment.trackId,
    score: 1,
  };

  return { area: segment.renderArea, placement };
}

export function trackCodeAtFieldPoint(
  network: TrackNetwork,
  xM: number,
  yM: number,
): string | null {
  const segment = pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM));
  return segment?.trackCode ?? null;
}
