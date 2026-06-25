import type { RefFieldOverlapReport, TrackNetwork, TrackNetworkSegment } from './types';

function overlapLength(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const lo = Math.max(aMin, bMin);
  const hi = Math.min(aMax, bMax);
  return Math.max(0, hi - lo);
}

function interiorOverlapAreaM2(
  a: TrackNetworkSegment['bounds'],
  b: TrackNetworkSegment['bounds'],
): number {
  const w = overlapLength(a.xMinM, a.xMaxM, b.xMinM, b.xMaxM);
  const h = overlapLength(a.yMinM, a.yMaxM, b.yMinM, b.yMaxM);
  return w * h;
}

/** 報告 refField 內部重疊（僅共邊相貼允許；重疊面積 > ε 視為地圖錯） */
export function findRefFieldOverlaps(
  network: TrackNetwork,
  epsilonM2 = 1e-6,
): RefFieldOverlapReport[] {
  const reports: RefFieldOverlapReport[] = [];
  const segments = network.segments;

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]!;
      const b = segments[j]!;
      const area = interiorOverlapAreaM2(a.bounds, b.bounds);
      if (area > epsilonM2) {
        reports.push({
          segmentAId: a.trackId,
          segmentBId: b.trackId,
          overlapAreaM2: area,
        });
      }
    }
  }

  return reports;
}
