import type {
  VehicleNetworkFix,
  VehiclePlacementAcrossAreas,
  VehicleTrackPlacement,
} from '../resolveVehicleTrackPlacement';
import { fieldPositionToTrackAreaLocal } from '../resolveVehicleTrackPlacement';
import type { TrackNetwork, TrackNetworkSegment } from './types';
import { trackGenPickScore } from '../../utils/trackGenPaths';
import { locateByField } from '../../utils/trackGenLocate';

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
 * 車子離軌道多遠<strong>還算得出位置</strong>（公尺）。
 *
 * 生成的軌道不再要求車子落在那一塊的參照場域範圍裡——那個範圍只有中心線兩側各 1.675
 * 公尺，車子一偏出軌道就整台消失，而「它偏出去了」正是要看見的事。改成看偏移量：偏多少
 * 就往旁邊畫多少。
 */
const MAX_OFF_TRACK_M = 25;

/** 生成軌道：格網找候選；順便帶回它落在路網的哪一點與偏移量 */
function locateGeneratedSegment(
  network: TrackNetwork,
  xM: number,
  yM: number,
  headingRad?: number,
): { segment: TrackNetworkSegment; fix: VehicleNetworkFix } | null {
  if (!network.genIndex) return null;
  const hit = locateByField(network.genIndex, xM, yM, headingRad);
  if (!hit) return null;
  const segment = network.byTrackId.get(hit.facilityId);
  if (!segment) return null;
  if (Math.abs(hit.offsetM) > MAX_OFF_TRACK_M) return null;
  return {
    segment,
    fix: { roadId: hit.road, laneId: hit.lane, sM: hit.sM, offsetM: hit.offsetM },
  };
}

/**
 * 場域 (x,y) 定位：僅 refField 段內命中才回傳圖台座標。
 * 段外不吸附、不外插；Area 不作空間查詢。
 */
export function locateOnTrackNetwork(
  network: TrackNetwork,
  xM: number,
  yM: number,
  headingRad?: number,
): VehiclePlacementAcrossAreas | null {
  const generated = locateGeneratedSegment(network, xM, yM, headingRad);
  const segment =
    generated?.segment ??
    pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM), {
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
    ...(generated ? { network: generated.fix } : {}),
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
