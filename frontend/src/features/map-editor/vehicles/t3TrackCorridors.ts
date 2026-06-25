/**
 * T3 相鄰軌道通道：以參照場域 refField + 圖元 areaPosition 建立分段線性中心線。
 *
 * 算法（軸向通道 / piecewise-linear centerline，常見於軌道幾何與地圖匹配）：
 * 1. 相鄰軌道段依場域座標串成同一通道
 * 2. 每段端點用 fieldPositionToTrackAreaLocal 換算圖台節點（與單段定位公式相同）
 * 3. 車輛座標投影到通道軸向參數 s，在相鄰節點間線性插值
 *
 * 段內與單段公式數學一致 → 不引入偏移；段間共用節點 → 消除接縫跳動。
 */
import type { MapAreaObject } from '../types/area';
import type { FacilityObject } from '../types/facility';
import { getValidRefFieldBounds, hasValidRefFieldBounds } from '../utils/facilityRefFieldBounds';
import { normalizeTrackCode } from './t3FieldTrackClassifier';

export type FieldToAreaLocal = (
  xM: number,
  yM: number,
  track: FacilityObject,
  area: MapAreaObject,
) => { x: number; y: number } | null;

export type CorridorAxis = 'x' | 'y';

export type CorridorDefinition = {
  id: string;
  axis: CorridorAxis;
  /** 通道內軌道代碼，沿 axis 遞增方向排列 */
  segmentCodes: readonly string[];
};

export type CorridorKnot = {
  /** 沿通道軸的場域座標（公尺） */
  s: number;
  areaLocalX: number;
  areaLocalY: number;
};

export type BuiltCorridor = {
  def: CorridorDefinition;
  knots: CorridorKnot[];
};

const CORRIDOR_DEFINITIONS: readonly CorridorDefinition[] = [
  {
    id: 'd-upper',
    axis: 'x',
    segmentCodes: Array.from({ length: 16 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`),
  },
  {
    id: 'u-upper',
    axis: 'x',
    segmentCodes: [
      'U16',
      ...Array.from({ length: 15 }, (_, i) => `U${String(15 - i).padStart(2, '0')}`),
    ],
  },
  {
    id: 'u-lower',
    axis: 'x',
    segmentCodes: Array.from({ length: 16 }, (_, i) => `U${String(20 + i).padStart(2, '0')}`),
  },
  {
    id: 'd-lower',
    axis: 'x',
    segmentCodes: Array.from({ length: 16 }, (_, i) => `D${String(i + 20).padStart(2, '0')}`),
  },
  {
    id: 't3-d-column',
    axis: 'y',
    segmentCodes: ['D17', 'D18', 'D19'],
  },
  {
    id: 't3-u-column',
    axis: 'y',
    segmentCodes: ['U17', 'U18', 'U19'],
  },
];

const TRACK_TO_CORRIDOR = new Map<string, string>();
for (const def of CORRIDOR_DEFINITIONS) {
  for (const code of def.segmentCodes) {
    TRACK_TO_CORRIDOR.set(code, def.id);
  }
}

const areaCorridorCache = new WeakMap<MapAreaObject, Map<string, BuiltCorridor>>();

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function findTrackByName(area: MapAreaObject, name: string): FacilityObject | null {
  const normalized = normalizeTrackCode(name);
  return (
    area.facilities?.find((f) => {
      if (f.type !== 'Track') return false;
      return (
        f.customName === name ||
        normalizeTrackCode(f.customName) === normalized ||
        normalizeTrackCode(
          typeof f.parameters?.segmentId === 'string' ? f.parameters.segmentId : null,
        ) === normalized
      );
    }) ?? null
  );
}

function pushKnot(knots: CorridorKnot[], s: number, areaLocalX: number, areaLocalY: number) {
  const last = knots[knots.length - 1];
  if (last && Math.abs(last.s - s) < 1e-9) {
    last.areaLocalX = areaLocalX;
    last.areaLocalY = areaLocalY;
    return;
  }
  knots.push({ s, areaLocalX, areaLocalY });
}

/** 由圖台軌道元件 refField 與 area 映射建立通道節點 */
export function buildCorridorKnots(
  area: MapAreaObject,
  def: CorridorDefinition,
  fieldToLocal: FieldToAreaLocal,
): BuiltCorridor | null {
  const knots: CorridorKnot[] = [];
  const horizontal = def.axis === 'x';

  for (const code of def.segmentCodes) {
    const track = findTrackByName(area, code);
    if (!track || !hasValidRefFieldBounds(track.parameters)) continue;

    const bounds = getValidRefFieldBounds(track.parameters);
    if (!bounds) continue;

    const cross = horizontal
      ? (bounds.yMinM + bounds.yMaxM) / 2
      : (bounds.xMinM + bounds.xMaxM) / 2;

    const startS = horizontal ? bounds.xMinM : bounds.yMinM;
    const endS = horizontal ? bounds.xMaxM : bounds.yMaxM;

    const startLocal = horizontal
      ? fieldToLocal(startS, cross, track, area)
      : fieldToLocal(cross, startS, track, area);
    const endLocal = horizontal
      ? fieldToLocal(endS, cross, track, area)
      : fieldToLocal(cross, endS, track, area);

    if (!startLocal || !endLocal) continue;

    pushKnot(knots, startS, startLocal.x, startLocal.y);
    pushKnot(knots, endS, endLocal.x, endLocal.y);
  }

  if (knots.length < 2) return null;
  knots.sort((a, b) => a.s - b.s);
  return { def, knots };
}

function getBuiltCorridor(
  area: MapAreaObject,
  corridorId: string,
  fieldToLocal: FieldToAreaLocal,
): BuiltCorridor | null {
  let byId = areaCorridorCache.get(area);
  if (!byId) {
    byId = new Map();
    areaCorridorCache.set(area, byId);
  }

  const cached = byId.get(corridorId);
  if (cached) return cached;

  const def = CORRIDOR_DEFINITIONS.find((d) => d.id === corridorId);
  if (!def) return null;

  const built = buildCorridorKnots(area, def, fieldToLocal);
  if (built) byId.set(corridorId, built);
  return built;
}

/** 通道 id；單段軌道不在通道內則 null */
export function corridorIdForTrackCode(trackCode: string): string | null {
  return TRACK_TO_CORRIDOR.get(trackCode) ?? null;
}

/** 沿通道軸向參數 s 在節點間線性插值圖台座標 */
export function interpolateCorridorAtS(
  knots: CorridorKnot[],
  s: number,
): { x: number; y: number } | null {
  if (knots.length === 0) return null;
  if (knots.length === 1) {
    return { x: knots[0].areaLocalX, y: knots[0].areaLocalY };
  }

  if (s <= knots[0].s) {
    return { x: knots[0].areaLocalX, y: knots[0].areaLocalY };
  }
  const last = knots[knots.length - 1];
  if (s >= last.s) {
    return { x: last.areaLocalX, y: last.areaLocalY };
  }

  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (s >= a.s && s < b.s) {
      const span = b.s - a.s;
      const t = span > 1e-9 ? clamp01((s - a.s) / span) : 0;
      return {
        x: a.areaLocalX + t * (b.areaLocalX - a.areaLocalX),
        y: a.areaLocalY + t * (b.areaLocalY - a.areaLocalY),
      };
    }
  }

  return { x: last.areaLocalX, y: last.areaLocalY };
}

export type CorridorPlacementResult = {
  areaLocalX: number;
  areaLocalY: number;
  corridorId: string;
  /** true = 與單段 fieldPositionToTrackAreaLocal 一致（段內） */
  usedExactSegment: boolean;
};

const MAX_EXACT_DRIFT_PX = 1.5;

/**
 * 通道定位：優先保證與單段公式一致（防偏移），允許時用通道插值消除接縫。
 */
export function placeOnTrackCorridor(
  xM: number,
  yM: number,
  trackCode: string,
  track: FacilityObject,
  area: MapAreaObject,
  fieldToLocal: FieldToAreaLocal,
): CorridorPlacementResult | null {
  const exact = fieldToLocal(xM, yM, track, area);
  if (!exact) return null;

  const corridorId = corridorIdForTrackCode(trackCode);
  if (!corridorId) {
    return {
      areaLocalX: exact.x,
      areaLocalY: exact.y,
      corridorId: 'single',
      usedExactSegment: true,
    };
  }

  const built = getBuiltCorridor(area, corridorId, fieldToLocal);
  if (!built || built.knots.length < 2) {
    return {
      areaLocalX: exact.x,
      areaLocalY: exact.y,
      corridorId,
      usedExactSegment: true,
    };
  }

  const s = built.def.axis === 'x' ? xM : yM;
  const corridor = interpolateCorridorAtS(built.knots, s);
  if (!corridor) {
    return {
      areaLocalX: exact.x,
      areaLocalY: exact.y,
      corridorId,
      usedExactSegment: true,
    };
  }

  const drift = Math.hypot(exact.x - corridor.x, exact.y - corridor.y);
  if (drift <= MAX_EXACT_DRIFT_PX) {
    return {
      areaLocalX: exact.x,
      areaLocalY: exact.y,
      corridorId,
      usedExactSegment: true,
    };
  }

  return {
    areaLocalX: corridor.x,
    areaLocalY: corridor.y,
    corridorId,
    usedExactSegment: false,
  };
}

/** 清除 Area 通道快取（圖台更新後呼叫） */
export function invalidateCorridorCache(area: MapAreaObject) {
  areaCorridorCache.delete(area);
}

export { CORRIDOR_DEFINITIONS };
