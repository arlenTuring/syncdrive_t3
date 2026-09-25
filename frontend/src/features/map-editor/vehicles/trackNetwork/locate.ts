import type {
  VehicleNetworkFix,
  VehiclePlacementAcrossAreas,
  VehicleTrackPlacement,
} from '../resolveVehicleTrackPlacement';
import {
  fieldPositionToTrackAreaLocal,
  trackAreaLocalAt,
} from '../resolveVehicleTrackPlacement';
import type { TrackNetwork, TrackNetworkSegment } from './types';
import { getTrackGenPaths, trackGenPickScore } from '../../utils/trackGenPaths';
import { TRACK_HALF_WIDTH_M } from '../quantisedTrackCell';
import { locateByField, type LocateOptions } from '../../utils/trackGenLocate';

/** 定位的旁證：車頭、車速，以及上一筆判給這台車的軌道 */
export type TrackLocateOptions = LocateOptions & {
  /** 上一筆判給這台車的軌道（設施 id）；偏向留在原地或走到相連的下一塊 */
  previousTrackId?: string;
};

function toLocateOptions(input?: number | TrackLocateOptions): LocateOptions {
  if (typeof input === 'number') return { headingRad: input };
  if (!input) return {};
  const { previousTrackId, ...rest } = input;
  return { ...rest, previousFacilityId: input.previousFacilityId ?? previousTrackId };
}

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
  // 只讀 segments，所以不要求整份索引——呼叫端常常只手上有一組段
  network: Pick<TrackNetwork, 'segments'>,
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
 * 「找候選」與「接受為軌道定位」是兩件事。
 *
 * 候選由生成軌道的格網去找（座標所在格與相鄰格，範圍本來就比軌道寬）；但<strong>找到最近的
 * 軌道不等於車就在那條軌道上</strong>。原本只要橫向偏移不超過 25 公尺就接受，場區裡離主軌道
 * 十幾、二十幾公尺的車也被判成「在主軌道上、偏了 −24.73 m」，再依偏移往旁邊外插畫出來。
 *
 * 接受條件：對該段中心線的<strong>完整距離</strong>（distanceM，含端點外的縱向距離；不能只看
 * |offsetM|）不超過「有效半寬＋定位容差」。
 */


/**
 * 定位容差（公尺）。依據：2026-09-25 本機實錄 560 筆正線上的判位，車端座標離所選中心線的
 * 距離 99% 在 0.48 m 以內（最大 1.52 m，發生在彎道），見 __fixtures__/locate-anomalies-20260925.json。
 */
export const LOCATE_TOLERANCE_M = 0.5;

/**
 * 這條軌道接受為定位的最大距離：有效半寬＋定位容差。
 *
 * 有效半寬：圖資在軌道參數帶 `trackWidthM`（有效寬度）就用它的一半；目前圖資沒有這個欄位，
 * 沿用既有的保守預設 {@link TRACK_HALF_WIDTH_M}（1.675 m）。在函式裡讀常數，不在模組載入時
 * 讀——這支與 quantisedTrackCell 之間有循環引用，載入當下可能還拿不到值。
 */
export function trackAcceptDistanceM(track: { parameters?: Record<string, unknown> } | undefined): number {
  const width = Number(track?.parameters?.trackWidthM);
  const half = Number.isFinite(width) && width > 0 ? width / 2 : TRACK_HALF_WIDTH_M;
  return half + LOCATE_TOLERANCE_M;
}

/** 是不是生成軌道（有真實中心線）；生成軌道被距離檢查拒絕後，不能再經手工軌道的後備路徑選回來 */
function isGeneratedTrack(seg: TrackNetworkSegment): boolean {
  return getTrackGenPaths(seg.track.parameters) !== null;
}

/**
 * 生成軌道：格網找候選，只在接受範圍內的候選之間挑（路線、上一筆、車頭都只能在這些之間選）。
 * 沒有任何候選在範圍內就回 null——最近的軌道太遠，車不在軌道上。
 */
function locateGeneratedSegment(
  network: TrackNetwork,
  xM: number,
  yM: number,
  options?: number | TrackLocateOptions,
): { segment: TrackNetworkSegment; fix: VehicleNetworkFix } | null {
  if (!network.genIndex) return null;
  const acceptOf = (branchId: string) => trackAcceptDistanceM(network.byTrackId.get(branchId)?.track);
  const hit = locateByField(network.genIndex, xM, yM, { ...toLocateOptions(options), maxDistanceM: acceptOf });
  if (!hit) return null;
  const segment = network.byTrackId.get(hit.facilityId);
  if (!segment) return null;
  // 再檢查一次：接受與否只看完整距離，不看 |offsetM|
  if (hit.distanceM > acceptOf(hit.facilityId)) return null;
  return {
    segment,
    fix: {
      roadId: hit.road,
      laneId: hit.lane,
      sM: hit.sM,
      offsetM: hit.offsetM,
      alongFrac: hit.along,
      distanceM: hit.distanceM,
      branchId: hit.branchId,
      identity: hit.identity,
      distanceMarginM: hit.distanceMarginM,
      scoreMargin: hit.scoreMargin,
      offRoute: hit.offRoute,
      headingConflict: hit.headingConflict,
      travelRad: hit.travelRad,
    },
  };
}

/**
 * 場域 (x,y) → 軌道上的圖台座標。沒有有效的軌道匹配就回 null，交給呼叫端改用場區分區或
 * 區域座標；不外插、不硬吸到最近的軌道。
 *
 * 生成軌道只接受通過距離檢查的；後備的「落在場域範圍內」只給<strong>手工軌道</strong>（沒有
 * 生成中心線的），生成軌道被拒絕後不會從這裡被選回來。
 */
export function locateOnTrackNetwork(
  network: TrackNetwork,
  xM: number,
  yM: number,
  options?: number | TrackLocateOptions,
): VehiclePlacementAcrossAreas | null {
  const generated = locateGeneratedSegment(network, xM, yM, options);
  if (generated) {
    // 位置照挑塊時算好的「走了幾成、偏了多少」換算，不再對整條折線重投影
    const local = trackAreaLocalAt(
      generated.segment.track,
      generated.segment.renderArea,
      generated.fix.alongFrac,
      generated.fix.offsetM,
    );
    if (!local) return null;
    const placement: VehicleTrackPlacement = {
      areaLocalX: local.x,
      areaLocalY: local.y,
      trackId: generated.segment.trackId,
      score: 1,
      network: generated.fix,
      source: 'generated',
    };
    return { area: generated.segment.renderArea, placement };
  }

  const manual = pickRefFieldSegment(
    findRefFieldSegmentsAtPoint(network, xM, yM).filter((seg) => !isGeneratedTrack(seg)),
    { xM, yM },
  );
  if (!manual) return null;
  const local = fieldPositionToTrackAreaLocal(xM, yM, manual.track, manual.renderArea, {
    extrapolate: false,
  });
  if (!local) return null;
  const placement: VehicleTrackPlacement = {
    areaLocalX: local.x,
    areaLocalY: local.y,
    trackId: manual.trackId,
    score: 1,
    source: 'manual',
  };
  return { area: manual.renderArea, placement };
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
