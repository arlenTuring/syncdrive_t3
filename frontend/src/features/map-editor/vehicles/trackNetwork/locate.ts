import type { VehiclePlacementAcrossAreas, VehicleTrackPlacement } from '../resolveVehicleTrackPlacement';
import { fieldPositionToTrackAreaLocal } from '../resolveVehicleTrackPlacement';
import type { TrackNetwork, TrackNetworkSegment } from './types';
import { trackGenPickScore } from '../../utils/trackGenPaths';

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

/**
 * 重疊時挑哪一段。
 *
 * 參照場域範圍是外接方框，彎道與垂直段的方框本來就會蓋到鄰居——這不是地圖資料
 * 錯誤，是方框描述曲線的必然結果。生成的軌道自己帶著真實中心線，改成挑<strong>中心線
 * 最近</strong>的那一段；沒有中心線可比時才退回用 trackId 決定性取一。
 *
 * 少了這一步，上下行與轉角互相重疊的地方會照 trackId 排序任選一段，車子就會在
 * 兩條線之間跳——實測轉角處跳 138 像素。
 */
export function pickRefFieldSegment(
  matches: TrackNetworkSegment[],
  point?: { xM: number; yM: number },
): TrackNetworkSegment | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  if (point) {
    let best: TrackNetworkSegment | null = null;
    let bestD = Infinity;
    for (const seg of matches) {
      const score = trackGenPickScore(seg.track.parameters, point.xM, point.yM);
      if (score === null) continue;
      if (score < bestD) {
        bestD = score;
        best = seg;
      }
    }
    if (best) return best;
  }
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
  const segment = pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM), {
    xM,
    yM,
  });
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
  const segment = pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM), {
    xM,
    yM,
  });
  return segment?.trackCode ?? null;
}
