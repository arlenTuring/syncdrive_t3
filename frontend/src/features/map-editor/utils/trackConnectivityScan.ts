import type { MapAreaObject } from '../types/area';
import type { FacilityObject } from '../types/facility';
import { hasValidRefFieldBounds, isZeroRefFieldBoundsSpan } from './facilityRefFieldBounds';
import { areaPositionToCssTopLeft, domainHeightM, domainWidthM } from './areaCoords';
import { resolveFacilitySnapRectCss } from './facilityAreaCoords';
import { fieldPositionToTrackAreaLocal } from '../vehicles/resolveVehicleTrackPlacement';
import { buildTrackNetwork } from '../vehicles/trackNetwork/scanMap';
import { findRefFieldOverlaps } from '../vehicles/trackNetwork/validate';
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types';

/** refField 端點相接容差（公尺）：容許橫向／縱向 refField 輸入誤差 */
const REF_CONNECTION_EPS_M = 0.12;
const SAMPLE_STEP_M = 0.8;
/** 圖台元件邊框相鄰容差（像素）：容許人為擺放時貼合、略重疊或近距 */
const PHYSICAL_SLACK_PX = 16;

export type ConnectivityIssueKind =
  | 'missing_ref_field'
  | 'overlap'
  | 'endpoint_gap'
  | 'path_gap';

export type ConnectivityIssue = {
  kind: ConnectivityIssueKind;
  trackId: string;
  trackCode: string | null;
  areaId: string;
  message: string;
  fieldPoint: { xM: number; yM: number };
  neighborTrackId?: string;
};

export type ScanPathPoint = {
  xM: number;
  yM: number;
  trackId: string;
  /** 地圖像素（content 座標） */
  mapPx: { x: number; y: number };
};

export type ScanChainIssue = {
  issue: ConnectivityIssue;
  revealIndex: number;
  /** 沿 path 的像素距離，掃描點到達此距離才揭示 */
  revealDistancePx: number;
};

export type ScanChain = {
  id: string;
  label: string;
  segmentIds: string[];
  path: ScanPathPoint[];
  /** 按 revealIndex 排序；掃描動畫到達時才逐一揭示 */
  pendingIssues: ScanChainIssue[];
};

export type ConnectivityScanPlan = {
  chains: ScanChain[];
  issues: ConnectivityIssue[];
  segmentById: Map<string, TrackNetworkSegment>;
};

type FieldEndpoint = {
  xM: number;
  yM: number;
  end: 'min' | 'max';
};

type MapContentBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function segmentEndpoints(seg: TrackNetworkSegment): FieldEndpoint[] {
  const b = seg.bounds;
  if (seg.horizontal) {
    const yM = (b.yMinM + b.yMaxM) / 2;
    return [
      { xM: b.xMinM, yM, end: 'min' },
      { xM: b.xMaxM, yM, end: 'max' },
    ];
  }
  const xM = (b.xMinM + b.xMaxM) / 2;
  return [
    { xM, yM: b.yMinM, end: 'min' },
    { xM, yM: b.yMaxM, end: 'max' },
  ];
}

/** 圖台 content 座標下的元件視覺 AABB（含旋轉） */
function segmentMapContentBox(seg: TrackNetworkSegment): MapContentBox {
  const area = seg.renderArea;
  const domainSpan = {
    w: domainWidthM(area.domain),
    h: domainHeightM(area.domain),
  };
  const rect = resolveFacilitySnapRectCss(
    seg.track,
    area.domain,
    area.layout,
    domainSpan,
  );
  return {
    left: area.layout.xPx + rect.left,
    top: area.layout.yPx + rect.top,
    right: area.layout.xPx + rect.left + rect.width,
    bottom: area.layout.yPx + rect.top + rect.height,
  };
}

function expandContentBox(box: MapContentBox, slackPx: number): MapContentBox {
  return {
    left: box.left - slackPx,
    top: box.top - slackPx,
    right: box.right + slackPx,
    bottom: box.bottom + slackPx,
  };
}

/** 邊框近乎重疊、貼合或近距（人為擺放容差） */
function physicalBoxesNearTouch(
  a: MapContentBox,
  b: MapContentBox,
  slackPx: number,
): boolean {
  const ea = expandContentBox(a, slackPx);
  const eb = expandContentBox(b, slackPx);
  return (
    ea.left < eb.right &&
    ea.right > eb.left &&
    ea.top < eb.bottom &&
    ea.bottom > eb.top
  );
}

function endpointsTouch(a: FieldEndpoint, b: FieldEndpoint): boolean {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM) <= REF_CONNECTION_EPS_M;
}

/** 場域點落在橫向 refField 的厚度邊（ymin／ymax） */
function pointOnHorizontalTransverseEdge(
  point: { xM: number; yM: number },
  h: TrackNetworkSegment,
  eps: number,
): boolean {
  const b = h.bounds;
  const onYEdge =
    Math.abs(point.yM - b.yMinM) <= eps || Math.abs(point.yM - b.yMaxM) <= eps;
  if (!onYEdge) return false;
  return point.xM >= b.xMinM - eps && point.xM <= b.xMaxM + eps;
}

/** 場域點落在縱向 refField 的沿軌端點（ymin／ymax），非側邊 */
function pointOnVerticalAlongTrackEnd(
  point: { xM: number; yM: number },
  v: TrackNetworkSegment,
  eps: number,
): boolean {
  const b = v.bounds;
  const onYEnd =
    Math.abs(point.yM - b.yMinM) <= eps || Math.abs(point.yM - b.yMaxM) <= eps;
  if (!onYEnd) return false;
  return point.xM >= b.xMinM - eps && point.xM <= b.xMaxM + eps;
}

/** 轉角近接續容差：略大於 strict，用於偵測 refField 打偏 */
const RELAXED_JUNCTION_EPS_M = REF_CONNECTION_EPS_M * 3;
/** 同向平行長邊相貼：沿軌重疊需達較短段的一定比例 */
const PARALLEL_EDGE_OVERLAP_RATIO = 0.5;

function perpendicularRefFieldConnectWithEps(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
  eps: number,
): boolean {
  if (a.horizontal === b.horizontal) return false;

  const h = a.horizontal ? a : b;
  const v = a.horizontal ? b : a;
  const hEnds = segmentEndpoints(h);
  const vEnds = segmentEndpoints(v);

  for (const ve of vEnds) {
    if (pointOnHorizontalTransverseEdge(ve, h, eps)) return true;
  }
  for (const he of hEnds) {
    if (pointOnVerticalAlongTrackEnd(he, v, eps)) return true;
  }
  return false;
}

/** 同向股道僅長邊相貼（平行相鄰），非路徑接續 */
function sameOrientationParallelEdgeTouch(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): boolean {
  if (a.horizontal !== b.horizontal) return false;

  const ba = a.bounds;
  const bb = b.bounds;
  const eps = REF_CONNECTION_EPS_M;

  if (a.horizontal) {
    const yTouch =
      Math.abs(ba.yMaxM - bb.yMinM) <= eps ||
      Math.abs(bb.yMaxM - ba.yMinM) <= eps;
    const xOverlap =
      Math.min(ba.xMaxM, bb.xMaxM) - Math.max(ba.xMinM, bb.xMinM);
    const minAlongSpan = Math.min(
      ba.xMaxM - ba.xMinM,
      bb.xMaxM - bb.xMinM,
    );
    return yTouch && xOverlap >= minAlongSpan * PARALLEL_EDGE_OVERLAP_RATIO;
  }

  const xTouch =
    Math.abs(ba.xMaxM - bb.xMinM) <= eps ||
    Math.abs(bb.xMaxM - ba.xMinM) <= eps;
  const yOverlap =
    Math.min(ba.yMaxM, bb.yMaxM) - Math.max(ba.yMinM, bb.yMinM);
  const minAlongSpan = Math.min(
    ba.yMaxM - ba.yMinM,
    bb.yMaxM - bb.yMinM,
  );
  return xTouch && yOverlap >= minAlongSpan * PARALLEL_EDGE_OVERLAP_RATIO;
}

/** refField 端點接近但未接續（排除平行股道長邊貼合） */
const NEAR_ENDPOINT_GAP_M = REF_CONNECTION_EPS_M * 20;

/** refField 幾何顯示此兩段應在路徑上接續（非平行股道） */
function refFieldSuggestsPathContinuation(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): boolean {
  if (sameOrientationParallelEdgeTouch(a, b)) return false;

  if (a.horizontal === b.horizontal) {
    const aEnds = segmentEndpoints(a);
    const bEnds = segmentEndpoints(b);
    for (const ae of aEnds) {
      for (const be of bEnds) {
        if (Math.hypot(ae.xM - be.xM, ae.yM - be.yM) <= NEAR_ENDPOINT_GAP_M) {
          return true;
        }
      }
    }
    return false;
  }

  const strict = REF_CONNECTION_EPS_M;
  return (
    perpendicularRefFieldConnectWithEps(a, b, RELAXED_JUNCTION_EPS_M) &&
    !perpendicularRefFieldConnectWithEps(a, b, strict)
  );
}

function perpendicularRefFieldConnect(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): boolean {
  return perpendicularRefFieldConnectWithEps(a, b, REF_CONNECTION_EPS_M);
}

/** refField 路徑在場域座標下連續相接 */
function refFieldPathConnected(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): boolean {
  const aEnds = segmentEndpoints(a);
  const bEnds = segmentEndpoints(b);
  for (const ae of aEnds) {
    for (const be of bEnds) {
      if (endpointsTouch(ae, be)) return true;
    }
  }
  return perpendicularRefFieldConnect(a, b);
}

/** 圖台物理相鄰且 refField 路徑連續 */
function segmentsAdjacent(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): boolean {
  if (
    !physicalBoxesNearTouch(
      segmentMapContentBox(a),
      segmentMapContentBox(b),
      PHYSICAL_SLACK_PX,
    )
  ) {
    return false;
  }
  return refFieldPathConnected(a, b);
}

function fieldToMapPx(
  xM: number,
  yM: number,
  seg: TrackNetworkSegment,
): { x: number; y: number } | null {
  const local = fieldPositionToTrackAreaLocal(xM, yM, seg.track, seg.renderArea, {
    extrapolate: false,
  });
  if (!local) return null;
  const area = seg.renderArea;
  const css = areaPositionToCssTopLeft(local, { w: 0, h: 0 }, area.layout.hPx);
  return { x: area.layout.xPx + css.left, y: area.layout.yPx + css.top };
}

function sampleSegmentPath(seg: TrackNetworkSegment): ScanPathPoint[] {
  const b = seg.bounds;
  const points: ScanPathPoint[] = [];
  const push = (xM: number, yM: number) => {
    const mapPx = fieldToMapPx(xM, yM, seg);
    if (!mapPx) return;
    points.push({ xM, yM, trackId: seg.trackId, mapPx });
  };

  if (seg.horizontal) {
    const yM = (b.yMinM + b.yMaxM) / 2;
    const span = b.xMaxM - b.xMinM;
    const steps = Math.max(1, Math.ceil(span / SAMPLE_STEP_M));
    for (let i = 0; i <= steps; i++) {
      push(b.xMinM + (span * i) / steps, yM);
    }
    return points;
  }

  const xM = (b.xMinM + b.xMaxM) / 2;
  const span = b.yMaxM - b.yMinM;
  const steps = Math.max(1, Math.ceil(span / SAMPLE_STEP_M));
  for (let i = 0; i <= steps; i++) {
    push(xM, b.yMinM + (span * i) / steps);
  }
  return points;
}

/** 從指定端點出發，沿 refField 中心線採樣至另一端（避免鏈序反轉時來回掃） */
function sampleSegmentPathFromEnd(
  seg: TrackNetworkSegment,
  enterEnd: 'min' | 'max',
): ScanPathPoint[] {
  const forward = sampleSegmentPath(seg);
  if (forward.length <= 1) return forward;
  const atEnter = entryEndAtFieldPoint(seg, forward[0]!);
  return atEnter === enterEnd ? forward : [...forward].reverse();
}

function entryEndAtFieldPoint(
  seg: TrackNetworkSegment,
  point: Pick<ScanPathPoint, 'xM' | 'yM'>,
): 'min' | 'max' {
  const ends = segmentEndpoints(seg);
  let best: 'min' | 'max' = 'min';
  let bestDist = Infinity;
  for (const e of ends) {
    const d = Math.hypot(e.xM - point.xM, e.yM - point.yM);
    if (d < bestDist) {
      bestDist = d;
      best = e.end;
    }
  }
  return best;
}

function junctionEndTowardNeighbor(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): 'min' | 'max' | null {
  const aEnds = segmentEndpoints(a);
  const bEnds = segmentEndpoints(b);
  for (const ae of aEnds) {
    for (const be of bEnds) {
      if (endpointsTouch(ae, be)) return ae.end;
    }
  }

  const eps = REF_CONNECTION_EPS_M;
  if (!a.horizontal && b.horizontal) {
    for (const ve of aEnds) {
      if (pointOnHorizontalTransverseEdge(ve, b, eps)) return ve.end;
    }
  }
  if (a.horizontal && !b.horizontal) {
    for (const he of aEnds) {
      if (pointOnVerticalAlongTrackEnd(he, b, eps)) return he.end;
    }
  }
  return null;
}

/** 依鏈上鄰接關係決定每段掃描方向，單向連續路徑 */
function buildContinuousChainPath(
  orderedIds: string[],
  segmentById: Map<string, TrackNetworkSegment>,
): ScanPathPoint[] {
  const path: ScanPathPoint[] = [];

  for (let i = 0; i < orderedIds.length; i++) {
    const seg = segmentById.get(orderedIds[i]!);
    if (!seg) continue;

    let oriented: ScanPathPoint[];
    if (path.length === 0) {
      const next = orderedIds[i + 1]
        ? segmentById.get(orderedIds[i + 1]!)
        : null;
      if (next) {
        const junctionEnd = junctionEndTowardNeighbor(seg, next);
        const enterEnd =
          junctionEnd === 'min' ? 'max' : junctionEnd === 'max' ? 'min' : 'min';
        oriented = sampleSegmentPathFromEnd(seg, enterEnd);
      } else {
        oriented = sampleSegmentPath(seg);
      }
    } else {
      const last = path[path.length - 1]!;
      const enterEnd = entryEndAtFieldPoint(seg, last);
      oriented = sampleSegmentPathFromEnd(seg, enterEnd);
    }

    if (path.length > 0 && oriented.length > 0) {
      const last = path[path.length - 1]!;
      const first = oriented[0]!;
      if (
        Math.hypot(last.xM - first.xM, last.yM - first.yM) < REF_CONNECTION_EPS_M
      ) {
        path.push(...oriented.slice(1));
      } else {
        path.push(...oriented);
      }
    } else {
      path.push(...oriented);
    }
  }

  return path;
}

function segmentFieldOrigin(seg: TrackNetworkSegment): { xM: number; yM: number } {
  return { xM: seg.bounds.xMinM, yM: seg.bounds.yMinM };
}

/** 依 refField 原點排序；不依使用者自訂編號 */
function compareByFieldOrigin(
  aId: string,
  bId: string,
  segmentById: Map<string, TrackNetworkSegment>,
): number {
  const a = segmentById.get(aId);
  const b = segmentById.get(bId);
  if (!a || !b) return 0;
  const ao = segmentFieldOrigin(a);
  const bo = segmentFieldOrigin(b);
  if (ao.xM !== bo.xM) return ao.xM - bo.xM;
  return ao.yM - bo.yM;
}

/** 畫面上顯示用：自訂名稱優先，否則內部 id */
export function trackDisplayLabel(
  seg: TrackNetworkSegment | undefined,
  trackId: string,
): string {
  const name = seg?.track.customName?.trim();
  return name || `軌道 ${trackId}`;
}

/** 問題可能涉及的軌道（含鄰居，不單指單一元件） */
export function issueInvolvedTrackIds(issue: ConnectivityIssue): string[] {
  const ids = [issue.trackId];
  if (issue.neighborTrackId && !ids.includes(issue.neighborTrackId)) {
    ids.push(issue.neighborTrackId);
  }
  return ids;
}

/** 掃描停點附近說明（不認定問題歸屬哪個元件） */
export function issueVicinityLabel(
  issue: ConnectivityIssue,
  segmentById?: Map<string, TrackNetworkSegment> | null,
): string {
  const { xM, yM } = issue.fieldPoint;
  const coord = `(${xM.toFixed(2)}, ${yM.toFixed(2)}) m`;
  const involved = issueInvolvedTrackIds(issue)
    .map((id) => trackDisplayLabel(segmentById?.get(id), id))
    .join('、');
  if (issue.neighborTrackId) {
    return `${coord} 附近 · 可能涉及 ${involved}`;
  }
  return `${coord} 附近`;
}

function buildAdjacency(segments: TrackNetworkSegment[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const seg of segments) {
    adj.set(seg.trackId, new Set());
  }

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]!;
      const b = segments[j]!;
      if (segmentsAdjacent(a, b)) {
        adj.get(a.trackId)!.add(b.trackId);
        adj.get(b.trackId)!.add(a.trackId);
      }
    }
  }

  return adj;
}

function orderChainSegments(
  segmentIds: string[],
  adj: Map<string, Set<string>>,
  segmentById: Map<string, TrackNetworkSegment>,
): string[] {
  if (segmentIds.length <= 1) return segmentIds;

  const idSet = new Set(segmentIds);
  const degree = (id: string) =>
    [...(adj.get(id) ?? [])].filter((n) => idSet.has(n)).length;

  let start =
    segmentIds
      .filter((id) => degree(id) <= 1)
      .sort((a, b) => compareByFieldOrigin(a, b, segmentById))[0] ??
    segmentIds
      .slice()
      .sort((a, b) => compareByFieldOrigin(a, b, segmentById))[0]!;
  const ordered: string[] = [start];
  const used = new Set<string>([start]);

  while (ordered.length < segmentIds.length) {
    const neighbors = [...(adj.get(start) ?? [])]
      .filter((n) => idSet.has(n) && !used.has(n))
      .sort((a, b) => compareByFieldOrigin(a, b, segmentById));
    if (neighbors.length === 0) break;
    const next = neighbors[0]!;
    ordered.push(next);
    used.add(next);
    start = next;
  }

  for (const id of segmentIds) {
    if (!used.has(id)) ordered.push(id);
  }
  return ordered;
}

function connectedComponents(
  segments: TrackNetworkSegment[],
  adj: Map<string, Set<string>>,
): string[][] {
  const byId = new Map(segments.map((s) => [s.trackId, s]));
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const seg of segments) {
    if (visited.has(seg.trackId)) continue;
    const stack = [seg.trackId];
    const comp: string[] = [];
    visited.add(seg.trackId);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const n of adj.get(id) ?? []) {
        if (!byId.has(n) || visited.has(n)) continue;
        visited.add(n);
        stack.push(n);
      }
    }
    components.push(comp);
  }

  return components;
}

function findMissingRefFieldIssues(areas: MapAreaObject[]): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];
  for (const area of areas) {
    for (const f of area.facilities ?? []) {
      if (f.type !== 'Track') continue;
      if (isZeroRefFieldBoundsSpan(f.parameters)) continue;
      if (hasValidRefFieldBounds(f.parameters)) continue;
      const label = f.customName?.trim() || `軌道 ${f.id}`;
      issues.push({
        kind: 'missing_ref_field',
        trackId: f.id,
        trackCode: f.customName?.trim() || null,
        areaId: area.id,
        message: `${label} 缺少有效參照場域範圍（refField）`,
        fieldPoint: {
          xM: f.position?.x ?? 0,
          yM: f.position?.y ?? 0,
        },
      });
    }
  }
  return issues;
}

function nearestRefFieldGapPoint(
  a: TrackNetworkSegment,
  b: TrackNetworkSegment,
): { xM: number; yM: number } {
  const aEnds = segmentEndpoints(a);
  const bEnds = segmentEndpoints(b);
  let best = aEnds[0] ?? { xM: a.bounds.xMinM, yM: a.bounds.yMinM, end: 'min' as const };
  let bestDist = Infinity;
  for (const ae of aEnds) {
    for (const be of bEnds) {
      const d = Math.hypot(ae.xM - be.xM, ae.yM - be.yM);
      if (d < bestDist) {
        bestDist = d;
        best = ae;
      }
    }
  }
  return { xM: best.xM, yM: best.yM };
}

/** 圖台物理相鄰但 refField 未接續（橫向／縱向輸入失誤） */
function findEndpointGapIssues(
  segments: TrackNetworkSegment[],
): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]!;
      const b = segments[j]!;
      if (
        !physicalBoxesNearTouch(
          segmentMapContentBox(a),
          segmentMapContentBox(b),
          PHYSICAL_SLACK_PX,
        )
      ) {
        continue;
      }
      if (refFieldPathConnected(a, b)) continue;
      if (!refFieldSuggestsPathContinuation(a, b)) continue;
      const gapPoint = nearestRefFieldGapPoint(a, b);
      issues.push({
        kind: 'endpoint_gap',
        trackId: a.trackId,
        trackCode: a.trackCode,
        areaId: a.renderArea.id,
        neighborTrackId: b.trackId,
        message: `${trackDisplayLabel(a, a.trackId)} 與 ${trackDisplayLabel(b, b.trackId)} 圖台相鄰但 refField 未接續`,
        fieldPoint: gapPoint,
      });
    }
  }
  return issues;
}

function findPathGapOnChain(
  orderedIds: string[],
  segmentById: Map<string, TrackNetworkSegment>,
  adj: Map<string, Set<string>>,
): ConnectivityIssue | null {
  for (let i = 0; i < orderedIds.length - 1; i++) {
    const aId = orderedIds[i]!;
    const bId = orderedIds[i + 1]!;
    if (adj.get(aId)?.has(bId)) continue;

    const a = segmentById.get(aId)!;
    const b = segmentById.get(bId)!;
    const aEnd = segmentEndpoints(a).find((e) => e.end === 'max') ?? segmentEndpoints(a)[0]!;
    return {
      kind: 'path_gap',
      trackId: aId,
      trackCode: a?.trackCode ?? null,
      areaId: a.renderArea.id,
      neighborTrackId: bId,
      message: `${trackDisplayLabel(a, aId)} 與 ${trackDisplayLabel(b, bId)} refField 未接續`,
      fieldPoint: { xM: aEnd.xM, yM: aEnd.yM },
    };
  }

  return null;
}

function dedupeIssues(issues: ConnectivityIssue[]): ConnectivityIssue[] {
  const seen = new Set<string>();
  const out: ConnectivityIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.kind}|${issue.trackId}|${issue.fieldPoint.xM.toFixed(3)}|${issue.fieldPoint.yM.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function pathIndexForIssue(
  path: ScanPathPoint[],
  issue: ConnectivityIssue,
): number {
  if (path.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const d = Math.hypot(p.xM - issue.fieldPoint.xM, p.yM - issue.fieldPoint.yM);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function segmentLengthPx(a: ScanPathPoint, b: ScanPathPoint): number {
  return Math.hypot(b.mapPx.x - a.mapPx.x, b.mapPx.y - a.mapPx.y);
}

/** path 總長（content 像素） */
export function pathTotalLengthPx(path: ScanPathPoint[]): number {
  if (path.length <= 1) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += segmentLengthPx(path[i - 1]!, path[i]!);
  }
  return total;
}

/** path[0..index] 累積像素距離 */
export function pathDistanceForIndex(path: ScanPathPoint[], index: number): number {
  if (path.length === 0 || index <= 0) return 0;
  const end = Math.min(index, path.length - 1);
  let total = 0;
  for (let i = 1; i <= end; i++) {
    total += segmentLengthPx(path[i - 1]!, path[i]!);
  }
  return total;
}

function topLeftPathIndex(path: ScanPathPoint[]): number {
  let entryIdx = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!.mapPx;
    const e = path[entryIdx]!.mapPx;
    if (p.y < e.y || (p.y === e.y && p.x < e.x)) {
      entryIdx = i;
    }
  }
  return entryIdx;
}

function closestPathIndex(path: ScanPathPoint[], from: { x: number; y: number }): number {
  let entryIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!.mapPx;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < bestD) {
      bestD = d;
      entryIdx = i;
    }
  }
  return entryIdx;
}

/**
 * 決定本鏈掃描 traversal：不預設軌道編號起點。
 * - 第一條鏈：從地圖上最左上的 path 點進入，沿 refField 往鏈內掃。
 * - 後續鏈：從上一掃描位置最近處進入，往遠離來處的方向掃。
 */
export function buildScanTraversalPath(
  path: ScanPathPoint[],
  enterFrom: { x: number; y: number } | null,
): ScanPathPoint[] {
  if (path.length <= 1) return [...path];

  if (!enterFrom) {
    const entryIdx = topLeftPathIndex(path);
    const toEnd = path.length - 1 - entryIdx;
    const toStart = entryIdx;
    if (toStart > toEnd) {
      return path.slice(0, entryIdx + 1).reverse();
    }
    return path.slice(entryIdx);
  }

  const entryIdx = closestPathIndex(path, enterFrom);
  const startPx = path[0]!.mapPx;
  const endPx = path[path.length - 1]!.mapPx;
  const fromStart = Math.hypot(enterFrom.x - startPx.x, enterFrom.y - startPx.y);
  const fromEnd = Math.hypot(enterFrom.x - endPx.x, enterFrom.y - endPx.y);

  if (fromEnd <= fromStart) {
    return path.slice(0, entryIdx + 1).reverse();
  }
  return path.slice(entryIdx);
}

export function remapPendingIssuesForPath(
  pending: ScanChainIssue[],
  traversalPath: ScanPathPoint[],
): ScanChainIssue[] {
  const items = pending.map((item) => {
    const revealIndex = pathIndexForIssue(traversalPath, item.issue);
    return {
      issue: item.issue,
      revealIndex,
      revealDistancePx: pathDistanceForIndex(traversalPath, revealIndex),
    };
  });
  items.sort((a, b) => a.revealDistancePx - b.revealDistancePx);
  return items;
}

/** 沿 path 依像素距離插值掃描點 */
export function interpolatePathAtDistance(
  path: ScanPathPoint[],
  distancePx: number,
): {
  laserPx: { x: number; y: number };
  trailPx: { x: number; y: number };
  pathIndex: number;
} {
  if (path.length === 0) {
    return { laserPx: { x: 0, y: 0 }, trailPx: { x: 0, y: 0 }, pathIndex: 0 };
  }
  if (path.length === 1 || distancePx <= 0) {
    return {
      laserPx: path[0]!.mapPx,
      trailPx: path[0]!.mapPx,
      pathIndex: 0,
    };
  }

  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const segLen = segmentLengthPx(a, b);
    if (acc + segLen >= distancePx) {
      const t = segLen > 0 ? (distancePx - acc) / segLen : 0;
      return {
        laserPx: {
          x: a.mapPx.x + (b.mapPx.x - a.mapPx.x) * t,
          y: a.mapPx.y + (b.mapPx.y - a.mapPx.y) * t,
        },
        trailPx: a.mapPx,
        pathIndex: i - 1 + t,
      };
    }
    acc += segLen;
  }

  const last = path[path.length - 1]!;
  const prev = path[path.length - 2] ?? last;
  return {
    laserPx: last.mapPx,
    trailPx: prev.mapPx,
    pathIndex: path.length - 1,
  };
}

function issueDedupeKey(issue: ConnectivityIssue): string {
  return `${issue.kind}|${issue.trackId}|${issue.fieldPoint.xM.toFixed(3)}|${issue.fieldPoint.yM.toFixed(3)}`;
}

function issueScanPointFromFacility(
  issue: ConnectivityIssue,
  f: FacilityObject,
  area: MapAreaObject,
  segmentById: Map<string, TrackNetworkSegment>,
): ScanPathPoint | null {
  const seg = segmentById.get(issue.trackId);
  if (seg) {
    const mapPx = fieldToMapPx(issue.fieldPoint.xM, issue.fieldPoint.yM, seg);
    if (!mapPx) return null;
    return {
      xM: issue.fieldPoint.xM,
      yM: issue.fieldPoint.yM,
      trackId: issue.trackId,
      mapPx,
    };
  }

  const domainSpan = {
    w: domainWidthM(area.domain),
    h: domainHeightM(area.domain),
  };
  const rect = resolveFacilitySnapRectCss(
    f,
    area.domain,
    area.layout,
    domainSpan,
  );
  return {
    xM: issue.fieldPoint.xM,
    yM: issue.fieldPoint.yM,
    trackId: issue.trackId,
    mapPx: {
      x: area.layout.xPx + rect.left + rect.width / 2,
      y: area.layout.yPx + rect.top + rect.height / 2,
    },
  };
}

function interpolateScanPath(
  from: ScanPathPoint,
  to: ScanPathPoint,
  steps: number,
): ScanPathPoint[] {
  if (steps <= 0) return [to];
  const path: ScanPathPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({
      xM: from.xM + (to.xM - from.xM) * t,
      yM: from.yM + (to.yM - from.yM) * t,
      trackId: to.trackId,
      mapPx: {
        x: from.mapPx.x + (to.mapPx.x - from.mapPx.x) * t,
        y: from.mapPx.y + (to.mapPx.y - from.mapPx.y) * t,
      },
    });
  }
  return path;
}

function scanChainIssue(
  path: ScanPathPoint[],
  issue: ConnectivityIssue,
): ScanChainIssue {
  const revealIndex = path.length > 0 ? pathIndexForIssue(path, issue) : 0;
  return {
    issue,
    revealIndex,
    revealDistancePx: pathDistanceForIndex(path, revealIndex),
  };
}

function collectChainIssues(
  ordered: string[],
  path: ScanPathPoint[],
  issues: ConnectivityIssue[],
  pathGap: ConnectivityIssue | null,
): ScanChainIssue[] {
  const items: ScanChainIssue[] = [];
  if (pathGap) {
    items.push(scanChainIssue(path, pathGap));
  }

  for (const issue of issues) {
    if (issue.kind === 'missing_ref_field') continue;
    if (!ordered.includes(issue.trackId)) continue;
    if (issue.kind !== 'overlap' && issue.kind !== 'endpoint_gap') continue;
    items.push(scanChainIssue(path, issue));
  }

  const seen = new Set<string>();
  const unique: ScanChainIssue[] = [];
  for (const item of items) {
    const key = issueDedupeKey(item.issue);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => a.revealIndex - b.revealIndex);
  return unique;
}

/** 建立斷路掃描計畫：路徑鏈 + 已知斷點 */
export function buildConnectivityScanPlan(areas: MapAreaObject[]): ConnectivityScanPlan {
  const network = buildTrackNetwork(areas);
  const segmentById = new Map(network.segments.map((s) => [s.trackId, s]));
  const adj = buildAdjacency(network.segments);

  const issues: ConnectivityIssue[] = [
    ...findMissingRefFieldIssues(areas),
    ...findEndpointGapIssues(network.segments),
  ];

  for (const overlap of findRefFieldOverlaps(network)) {
    const a = segmentById.get(overlap.segmentAId);
    const b = segmentById.get(overlap.segmentBId);
    if (!a || !b) continue;
    const cx = (Math.max(a.bounds.xMinM, b.bounds.xMinM) + Math.min(a.bounds.xMaxM, b.bounds.xMaxM)) / 2;
    const cy = (Math.max(a.bounds.yMinM, b.bounds.yMinM) + Math.min(a.bounds.yMaxM, b.bounds.yMaxM)) / 2;
    issues.push({
      kind: 'overlap',
      trackId: a.trackId,
      trackCode: a.trackCode,
      areaId: a.renderArea.id,
      neighborTrackId: b.trackId,
      message: `${trackDisplayLabel(a, a.trackId)} 與 ${trackDisplayLabel(b, b.trackId)} refField 重疊 (${overlap.overlapAreaM2.toFixed(4)} m²)`,
      fieldPoint: { xM: cx, yM: cy },
    });
  }

  const components = connectedComponents(network.segments, adj);
  const chains: ScanChain[] = [];
  let lastPathPoint: ScanPathPoint | null = null;

  components.forEach((comp, idx) => {
    const ordered = orderChainSegments(comp, adj, segmentById);
    const path = buildContinuousChainPath(ordered, segmentById);
    const pathGap = findPathGapOnChain(ordered, segmentById, adj);
    const pendingIssues = collectChainIssues(ordered, path, issues, pathGap);

    chains.push({
      id: `chain-${idx}`,
      label:
        ordered.length === 1
          ? `鏈 ${idx + 1}（1 段）`
          : `鏈 ${idx + 1}（${ordered.length} 段）`,
      segmentIds: ordered,
      path,
      pendingIssues,
    });

    if (path.length > 0) {
      lastPathPoint = path[path.length - 1]!;
    }
  });

  for (const issue of findMissingRefFieldIssues(areas)) {
    const area = areas.find((a) =>
      (a.facilities ?? []).some((fac) => fac.id === issue.trackId),
    );
    const f = area?.facilities?.find((fac) => fac.id === issue.trackId);
    if (!area || !f) continue;

    const target = issueScanPointFromFacility(issue, f, area, segmentById);
    if (!target) continue;

    const approachPath: ScanPathPoint[] = lastPathPoint
      ? interpolateScanPath(lastPathPoint, target, 16)
      : [target];
    const revealIndex = approachPath.length - 1;

    chains.push({
      id: `missing-${issue.trackId}`,
      label: f.customName?.trim() || `軌道 ${issue.trackId}`,
      segmentIds: [issue.trackId],
      path: approachPath,
      pendingIssues: [
        {
          issue,
          revealIndex,
          revealDistancePx: pathDistanceForIndex(approachPath, revealIndex),
        },
      ],
    });

    lastPathPoint = approachPath[approachPath.length - 1]!;
  }

  return {
    chains: chains.filter((c) => c.path.length > 0 || c.pendingIssues.length > 0),
    issues: dedupeIssues(issues),
    segmentById,
  };
}

/** 單一軌道段的並行掃描任務（不依鏈、不依名稱排序） */
export type SegmentScanTask = {
  trackId: string;
  path: ScanPathPoint[];
  pendingIssues: ScanChainIssue[];
  totalLengthPx: number;
};

/** 並行斷路掃描計畫：每段 refField 一個任務，動畫以偵測池排隊執行 */
export type ParallelScanPlan = {
  tasks: SegmentScanTask[];
  issues: ConnectivityIssue[];
  segmentById: Map<string, TrackNetworkSegment>;
};

function mapPxReadingOrder(p: { x: number; y: number }): number {
  return p.y * 1_000_000 + p.x;
}

/** 依地圖像素（左上原點）決定段內掃描方向，不用軌道編號 */
function orientSegmentPathByMap(seg: TrackNetworkSegment): ScanPathPoint[] {
  const forward = sampleSegmentPath(seg);
  if (forward.length <= 1) return forward;
  const head = forward[0]!.mapPx;
  const tail = forward[forward.length - 1]!.mapPx;
  return mapPxReadingOrder(head) <= mapPxReadingOrder(tail)
    ? forward
    : [...forward].reverse();
}

function collectSegmentIssues(
  trackId: string,
  path: ScanPathPoint[],
  issues: ConnectivityIssue[],
  pathGaps: ConnectivityIssue[],
): ScanChainIssue[] {
  const items: ScanChainIssue[] = [];
  for (const gap of pathGaps) {
    items.push(scanChainIssue(path, gap));
  }
  for (const issue of issues) {
    if (issue.kind === 'missing_ref_field') {
      if (issue.trackId === trackId) items.push(scanChainIssue(path, issue));
      continue;
    }
    if (issue.trackId !== trackId && issue.neighborTrackId !== trackId) continue;
    if (
      issue.kind === 'overlap' ||
      issue.kind === 'endpoint_gap' ||
      issue.kind === 'path_gap'
    ) {
      items.push(scanChainIssue(path, issue));
    }
  }
  const seen = new Set<string>();
  const unique: ScanChainIssue[] = [];
  for (const item of items) {
    const key = issueDedupeKey(item.issue);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => a.revealDistancePx - b.revealDistancePx);
  return unique;
}

/** 建立斷路掃描任務：鄰接圖預分析，動畫端以有限探針池依地圖順序掃描 */
export function buildParallelScanPlan(areas: MapAreaObject[]): ParallelScanPlan {
  const network = buildTrackNetwork(areas);
  const segmentById = new Map(network.segments.map((s) => [s.trackId, s]));
  const adj = buildAdjacency(network.segments);

  const issues: ConnectivityIssue[] = [
    ...findMissingRefFieldIssues(areas),
    ...findEndpointGapIssues(network.segments),
  ];

  for (const overlap of findRefFieldOverlaps(network)) {
    const a = segmentById.get(overlap.segmentAId);
    const b = segmentById.get(overlap.segmentBId);
    if (!a || !b) continue;
    const cx =
      (Math.max(a.bounds.xMinM, b.bounds.xMinM) +
        Math.min(a.bounds.xMaxM, b.bounds.xMaxM)) /
      2;
    const cy =
      (Math.max(a.bounds.yMinM, b.bounds.yMinM) +
        Math.min(a.bounds.yMaxM, b.bounds.yMaxM)) /
      2;
    issues.push({
      kind: 'overlap',
      trackId: a.trackId,
      trackCode: a.trackCode,
      areaId: a.renderArea.id,
      neighborTrackId: b.trackId,
      message: `${trackDisplayLabel(a, a.trackId)} 與 ${trackDisplayLabel(b, b.trackId)} refField 重疊 (${overlap.overlapAreaM2.toFixed(4)} m²)`,
      fieldPoint: { xM: cx, yM: cy },
    });
  }

  const pathGapsByTrack = new Map<string, ConnectivityIssue[]>();
  for (const comp of connectedComponents(network.segments, adj)) {
    const ordered = orderChainSegments(comp, adj, segmentById);
    const pathGap = findPathGapOnChain(ordered, segmentById, adj);
    if (!pathGap) continue;
    const list = pathGapsByTrack.get(pathGap.trackId) ?? [];
    list.push(pathGap);
    pathGapsByTrack.set(pathGap.trackId, list);
  }

  const tasks: SegmentScanTask[] = [];
  const coveredTrackIds = new Set<string>();

  for (const seg of network.segments) {
    coveredTrackIds.add(seg.trackId);
    const path = orientSegmentPathByMap(seg);
    const gaps = pathGapsByTrack.get(seg.trackId) ?? [];
    const pendingIssues = collectSegmentIssues(seg.trackId, path, issues, gaps);
    tasks.push({
      trackId: seg.trackId,
      path,
      pendingIssues,
      totalLengthPx: Math.max(pathTotalLengthPx(path), 1),
    });
  }

  for (const issue of findMissingRefFieldIssues(areas)) {
    if (coveredTrackIds.has(issue.trackId)) continue;
    const area = areas.find((a) =>
      (a.facilities ?? []).some((fac) => fac.id === issue.trackId),
    );
    const f = area?.facilities?.find((fac) => fac.id === issue.trackId);
    if (!area || !f) continue;
    const point = issueScanPointFromFacility(issue, f, area, segmentById);
    if (!point) continue;
    const path = [point];
    tasks.push({
      trackId: issue.trackId,
      path,
      pendingIssues: [scanChainIssue(path, issue)],
      totalLengthPx: 1,
    });
  }

  tasks.sort(
    (a, b) =>
      mapPxReadingOrder(a.path[0]?.mapPx ?? { x: 0, y: 0 }) -
      mapPxReadingOrder(b.path[0]?.mapPx ?? { x: 0, y: 0 }),
  );

  return {
    tasks,
    issues: dedupeIssues(issues),
    segmentById,
  };
}

export function issueMapPx(
  issue: ConnectivityIssue,
  segmentById: Map<string, TrackNetworkSegment>,
): { x: number; y: number } | null {
  const seg = segmentById.get(issue.trackId);
  if (!seg) return null;
  return fieldToMapPx(issue.fieldPoint.xM, issue.fieldPoint.yM, seg);
}
