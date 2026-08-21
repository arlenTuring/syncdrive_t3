import type { MapAreaObject } from '../map-editor/types/area';
import { domainHeightM, domainWidthM } from '../map-editor/utils/areaCoords';
import { resolveFacilityRenderPlacement } from '../map-editor/utils/facilityAreaCoords';
import {
  getRefFieldBounds,
  hasValidRefFieldBounds,
} from '../map-editor/utils/facilityRefFieldBounds';
import type {
  FenceCoverageSegment,
  FenceListItem,
  FenceVertex,
  VirtualFence,
} from './types';

export type TrackSegmentInfo = {
  trackId: string;
  label: string;
  areaId: string;
  mapPx: { x1: number; y1: number; x2: number; y2: number };
  meters: { x1: number; y1: number; x2: number; y2: number } | null;
};

function trackLabel(facility: {
  customName?: string;
  id: string;
  parameters?: Record<string, unknown>;
}): string {
  const custom = String(facility.customName ?? '').trim();
  if (custom) return custom;
  const seg = String(facility.parameters?.segmentId ?? '').trim();
  if (seg) return seg;
  return facility.id;
}

function rectsOverlap(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return a.x2 >= b.x1 && a.x1 <= b.x2 && a.y2 >= b.y1 && a.y1 <= b.y2;
}

/** 收集地圖軌道（僅供虛擬圍籬拉框涵蓋，與電子圍籬無關） */
export function collectTrackSegments(areas: MapAreaObject[]): TrackSegmentInfo[] {
  const out: TrackSegmentInfo[] = [];
  for (const area of areas) {
    const domainSpan = {
      w: domainWidthM(area.domain),
      h: domainHeightM(area.domain),
    };
    for (const facility of area.facilities) {
      if (facility.type !== 'Track') continue;
      const { css, areaSize } = resolveFacilityRenderPlacement(
        facility,
        area.domain,
        area.layout,
        domainSpan,
      );
      const x1 = area.layout.xPx + css.left;
      const y1 = area.layout.yPx + css.top;
      let meters: TrackSegmentInfo['meters'] = null;
      if (hasValidRefFieldBounds(facility.parameters)) {
        const b = getRefFieldBounds(facility.parameters);
        meters = {
          x1: Math.min(b.xMinM!, b.xMaxM!),
          x2: Math.max(b.xMinM!, b.xMaxM!),
          y1: Math.min(b.yMinM!, b.yMaxM!),
          y2: Math.max(b.yMinM!, b.yMaxM!),
        };
      }
      out.push({
        trackId: facility.id,
        label: trackLabel(facility),
        areaId: area.id,
        mapPx: { x1, y1, x2: x1 + areaSize.w, y2: y1 + areaSize.h },
        meters,
      });
    }
  }
  return out;
}

export function tracksCoveredByMapPixelRect(
  tracks: TrackSegmentInfo[],
  rect: { x1: number; y1: number; x2: number; y2: number },
): FenceCoverageSegment[] {
  const box = {
    x1: Math.min(rect.x1, rect.x2),
    x2: Math.max(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    y2: Math.max(rect.y1, rect.y2),
  };
  const hits = tracks.filter((t) => rectsOverlap(t.mapPx, box));
  hits.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }));
  return hits.map((t) => ({ trackId: t.trackId, label: t.label }));
}

export function toListItem(fence: VirtualFence): FenceListItem {
  return {
    id: fence.id,
    name: fence.name,
    enabled: fence.enabled,
  };
}

/** 虛擬圍籬地圖檢視：隱藏地圖編輯器的電子圍籬，避免混淆 */
export function areasWithoutMapGeofences(areas: MapAreaObject[]): MapAreaObject[] {
  return areas.map((area) => ({
    ...area,
    facilities: area.facilities.filter(
      (f) => f.type !== 'Geofence' && f.name !== 'Geofence',
    ),
  }));
}

export function mergeCoverage(
  current: FenceCoverageSegment[],
  added: FenceCoverageSegment[],
): FenceCoverageSegment[] {
  const map = new Map(current.map((c) => [c.trackId, c]));
  for (const item of added) map.set(item.trackId, item);
  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }),
  );
}

/** 依路段代號解析涵蓋（示範資料用） */
export function coverageByTrackLabels(
  tracks: TrackSegmentInfo[],
  labels: string[],
): FenceCoverageSegment[] {
  const want = new Set(labels.map((l) => l.trim().toUpperCase()));
  return tracks
    .filter((t) => want.has(t.label.trim().toUpperCase()))
    .map((t) => ({ trackId: t.trackId, label: t.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }));
}

export function rectVerticesFromBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): FenceVertex[] {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/** 在點擊處產生預設三角形（地圖像素） */
export function triangleVerticesAt(
  cx: number,
  cy: number,
  size = 120,
): FenceVertex[] {
  const h = size * 0.866;
  return [
    { x: cx, y: cy - h * 0.55 },
    { x: cx + size * 0.5, y: cy + h * 0.45 },
    { x: cx - size * 0.5, y: cy + h * 0.45 },
  ];
}

function pointInPolygon(x: number, y: number, poly: FenceVertex[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > y !== yj > y
      && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonBBox(vertices: FenceVertex[]) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const v of vertices) {
    x1 = Math.min(x1, v.x);
    y1 = Math.min(y1, v.y);
    x2 = Math.max(x2, v.x);
    y2 = Math.max(y2, v.y);
  }
  return { x1, y1, x2, y2 };
}

/** 多邊形與軌道 AABB 相交（或中心點在多邊形內）→ 涵蓋路段 */
export function tracksCoveredByPolygon(
  tracks: TrackSegmentInfo[],
  vertices: FenceVertex[],
): FenceCoverageSegment[] {
  if (vertices.length < 3) return [];
  const box = polygonBBox(vertices);
  const hits = tracks.filter((t) => {
    if (!rectsOverlap(t.mapPx, box)) return false;
    const cx = (t.mapPx.x1 + t.mapPx.x2) / 2;
    const cy = (t.mapPx.y1 + t.mapPx.y2) / 2;
    if (pointInPolygon(cx, cy, vertices)) return true;
    return rectsOverlap(t.mapPx, box);
  });
  hits.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }));
  return hits.map((t) => ({ trackId: t.trackId, label: t.label }));
}

export function insertFenceVertexOnEdge(
  vertices: FenceVertex[],
  edgeIndex: number,
): FenceVertex[] {
  const n = vertices.length;
  if (n < 2 || edgeIndex < 0 || edgeIndex >= n) return vertices;
  const a = vertices[edgeIndex]!;
  const b = vertices[(edgeIndex + 1) % n]!;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const next = [...vertices];
  next.splice(edgeIndex + 1, 0, mid);
  return next;
}

export function verticesFromCoverageTracks(
  tracks: TrackSegmentInfo[],
  coverage: FenceCoverageSegment[],
): FenceVertex[] {
  const byId = new Map(tracks.map((t) => [t.trackId, t]));
  const boxes = coverage
    .map((c) => byId.get(c.trackId)?.mapPx)
    .filter((b): b is NonNullable<typeof b> => b != null);
  if (boxes.length === 0) return [];
  const x1 = Math.min(...boxes.map((b) => b.x1));
  const y1 = Math.min(...boxes.map((b) => b.y1));
  const x2 = Math.max(...boxes.map((b) => b.x2));
  const y2 = Math.max(...boxes.map((b) => b.y2));
  return rectVerticesFromBounds(x1, y1, x2, y2);
}

export function midpointOfFenceEdge(
  vertices: FenceVertex[],
  edgeIndex: number,
): FenceVertex {
  const n = vertices.length;
  const a = vertices[edgeIndex]!;
  const b = vertices[(edgeIndex + 1) % n]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
