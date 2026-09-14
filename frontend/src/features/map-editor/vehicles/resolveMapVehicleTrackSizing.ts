import {
  defaultSizeMetersForType,
} from '../constants/facilityDimensions';
import type { MapAreaObject } from '../types/area';
import type { FacilityObject } from '../types/facility';
import { meterSizeToAreaLocalPx, meterToAreaLocalPx } from '../utils/areaCoords';
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from '../utils/facilityAreaCoords';
import type { AreaVehicleLive } from './types';
import {
  getTrackGenLatPerBox,
  getTrackGenPaths,
} from '../utils/trackGenPaths';

/** 依軌道元件尺寸計算載具在地圖上的顯示寬高（px） */
export interface MapVehicleTrackSizing {
  /** 沿軌道方向（長）= 軌道長 × 1/3 */
  displayWidthPx: number;
  /** 垂直軌道方向（寬）= 軌道寬 × 0.9 */
  displayHeightPx: number;
  trackLengthPx: number;
  trackWidthPx: number;
}

export const MAP_VEHICLE_TRACK_WIDTH_RATIO = 0.9;
export const MAP_VEHICLE_TRACK_LENGTH_RATIO = 1 / 3;

/** 圖台載具預設顯示尺寸（px）：橫向 = 沿軌道、縱向 = 垂直軌道 */
export const DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX = 60;
export const DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX = 10;

export function resolveMapVehicleDisplaySize(opts: {
  widthPx?: number;
  heightPx?: number;
  trackSizing?: Pick<MapVehicleTrackSizing, 'displayWidthPx' | 'displayHeightPx'>;
}): { widthPx: number; heightPx: number } {
  return {
    widthPx:
      opts.widthPx ??
      opts.trackSizing?.displayWidthPx ??
      DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX,
    heightPx:
      opts.heightPx ??
      opts.trackSizing?.displayHeightPx ??
      DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX,
  };
}

function sizingFromTrackPx(trackLengthPx: number, trackWidthPx: number): MapVehicleTrackSizing {
  return {
    trackLengthPx,
    trackWidthPx,
    displayWidthPx: Math.max(12, trackLengthPx * MAP_VEHICLE_TRACK_LENGTH_RATIO),
    displayHeightPx: Math.max(4, trackWidthPx * MAP_VEHICLE_TRACK_WIDTH_RATIO),
  };
}

export function resolveTrackSizingFromFacility(
  track: FacilityObject,
  area: MapAreaObject,
): MapVehicleTrackSizing {
  const sizePx = resolveFacilityAreaSize(track, area.domain, area.layout);
  return sizingFromTrackPx(sizePx.w, sizePx.h);
}

export function resolveTrackSizingForArea(area: MapAreaObject): MapVehicleTrackSizing {
  const tracks = (area.facilities ?? []).filter((f) => f.type === 'Track');
  if (tracks.length === 0) {
    const def = defaultSizeMetersForType('Track');
    const sizePx = meterSizeToAreaLocalPx(def.w, def.h, area.domain, area.layout);
    return sizingFromTrackPx(sizePx.w, sizePx.h);
  }
  /** 參考最寬軌道（如 D01） */
  let best = resolveTrackSizingFromFacility(tracks[0]!, area);
  for (const track of tracks) {
    const next = resolveTrackSizingFromFacility(track, area);
    if (next.trackWidthPx > best.trackWidthPx) best = next;
  }
  return best;
}

/** 依車輛座標找所在軌道尺寸 */
export function resolveTrackSizingForVehicle(
  area: MapAreaObject,
  vehicle: AreaVehicleLive,
): MapVehicleTrackSizing {
  const tracks = (area.facilities ?? []).filter((f) => f.type === 'Track');
  if (tracks.length === 0) return resolveTrackSizingForArea(area);

  const local = meterToAreaLocalPx(
    vehicle.xM,
    vehicle.yM,
    area.domain,
    area.layout,
  );

  let bestTrack: FacilityObject | null = null;
  let bestDist = Infinity;

  for (const track of tracks) {
    const pos = resolveFacilityAreaPosition(track, area.domain, area.layout);
    const size = resolveFacilityAreaSize(track, area.domain, area.layout);
    const cx = pos.x + size.w / 2;
    const cy = pos.y + size.h / 2;
    const inside =
      local.x >= pos.x &&
      local.x <= pos.x + size.w &&
      local.y >= pos.y &&
      local.y <= pos.y + size.h;
    const dist = (local.x - cx) ** 2 + (local.y - cy) ** 2;
    if (inside) {
      return resolveTrackSizingFromFacility(track, area);
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestTrack = track;
    }
  }

  return bestTrack
    ? resolveTrackSizingFromFacility(bestTrack, area)
    : resolveTrackSizingForArea(area);
}

/** 全圖參考軌道（預覽用，取最寬軌道如 D01） */
export function resolveReferenceTrackSizing(areas: MapAreaObject[]): MapVehicleTrackSizing {
  let best: MapVehicleTrackSizing | null = null;
  for (const area of areas) {
    const sizing = resolveTrackSizingForArea(area);
    if (!best || sizing.trackWidthPx > best.trackWidthPx) best = sizing;
  }
  return (
    best ?? {
      displayWidthPx: 48,
      displayHeightPx: 9,
      trackLengthPx: 144,
      trackWidthPx: 10,
    }
  );
}

export function pickPreviewArea(areas: MapAreaObject[]): MapAreaObject | null {
  if (areas.length === 0) return null;
  let best: MapAreaObject | null = null;
  let bestWidth = -1;
  for (const area of areas) {
    for (const f of area.facilities ?? []) {
      if (f.type !== 'Track') continue;
      const size = resolveFacilityAreaSize(f, area.domain, area.layout);
      if (size.h > bestWidth) {
        bestWidth = size.h;
        best = area;
      }
    }
  }
  return best ?? areas[0] ?? null;
}

/**
 * 這一塊「一公尺畫幾像素」——沿線與橫向各一個。
 *
 * <h3>為什麼要分兩軸</h3>
 * 示意圖不是等比例縮放：同一張圖上，正線一公尺約 0.29 像素，調度區沿 x 是 5.89、
 * 沿 y 是 2.21——同一區的兩軸就差 2.7 倍。載具用同一個像素尺寸走遍全圖，在正線剛好，
 * 到場區就塞不進格位（實測 60 像素的車身擺進 37×63 的格位，整台凸出去還疊到隔壁）。
 *
 * 生成的軌道兩條中心線都在身上，長度比一除就是沿線的比例尺；橫向拿外框的短邊對
 * 參照場域範圍的短邊。場區格位沒有中心線，直接拿外框對場域範圍。
 */
export function pxPerMeterOnFacility(
  facility: FacilityObject,
  area: MapAreaObject,
): { alongPxPerM: number; acrossPxPerM: number } | null {
  const size = resolveFacilityAreaSize(facility, area.domain, area.layout);
  if (!(size.w > 0) || !(size.h > 0)) return null;

  const paths = getTrackGenPaths(facility.parameters);
  if (paths) {
    const pathLen = (pts: ReadonlyArray<readonly [number, number]>) => {
      let total = 0;
      for (let i = 1; i < pts.length; i += 1) {
        total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      }
      return total;
    };
    const realM = pathLen(paths.real);
    if (!(realM > 0.01)) return null;
    // 圖面路徑是 0–1 的比例，乘外框才是像素
    const drawnPx = pathLen(
      paths.local.map(([u, v]) => [u * size.w, v * size.h] as const),
    );
    if (!(drawnPx > 0.01)) return null;
    const along = drawnPx / realM;
    /*
     * 橫向的比例尺問生成器自己記的 trackGenLatPerBox：那一組就是「橫向偏移一公尺，
     * 佔外框的幾分之幾」，沿寬、沿高各一個。
     *
     * 不能拿外框短邊對場域短邊算——中心線只有兩點的直段，場域範圍的短邊會退化成
     * 0.11 公尺（D19 實測），算出來是 487 px/m，車身就被夾到跟整條帶子一樣寬。
     */
    const a = paths.local[0]!;
    const b = paths.local[paths.local.length - 1]!;
    const alongIsWidth = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const lat = getTrackGenLatPerBox(facility.parameters);
    if (lat) {
      const perBox = alongIsWidth ? lat[1] : lat[0];
      const acrossPx = alongIsWidth ? size.h : size.w;
      if (perBox > 1e-9) {
        return { alongPxPerM: along, acrossPxPerM: perBox * acrossPx };
      }
    }
    const p = facility.parameters as Record<string, number> | undefined;
    const fw = Math.abs((p?.refFieldXMaxM ?? 0) - (p?.refFieldXMinM ?? 0));
    const fh = Math.abs((p?.refFieldYMaxM ?? 0) - (p?.refFieldYMinM ?? 0));
    const acrossM = alongIsWidth ? fh : fw;
    const acrossPx = alongIsWidth ? size.h : size.w;
    return {
      alongPxPerM: along,
      acrossPxPerM: acrossM > 0.5 ? acrossPx / acrossM : along,
    };
  }

  const p = facility.parameters as Record<string, number> | undefined;
  const fw = Math.abs((p?.refFieldXMaxM ?? 0) - (p?.refFieldXMinM ?? 0));
  const fh = Math.abs((p?.refFieldYMaxM ?? 0) - (p?.refFieldYMinM ?? 0));
  if (!(fw > 0.01) || !(fh > 0.01)) return null;
  // 沒有中心線：長邊當沿線
  const alongIsW = fw >= fh;
  return {
    alongPxPerM: (alongIsW ? size.w : size.h) / Math.max(fw, fh),
    acrossPxPerM: (alongIsW ? size.h : size.w) / Math.min(fw, fh),
  };
}

/**
 * 這張圖「一公尺畫幾像素」的代表值（沿線、橫向各一個），取所有軌道的中位數。
 *
 * 用中位數不用某一塊：終端那塊畫得特別大（6.67 px/m），正線中段只有 1.65，差四倍；
 * 拿單一塊當基準，整張圖的載具大小會被那一塊綁架。
 */
export function medianPxPerMeter(
  areas: MapAreaObject[],
): { alongPxPerM: number; acrossPxPerM: number } | null {
  const along: number[] = [];
  const across: number[] = [];
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'Track') continue;
      const s = pxPerMeterOnFacility(f, area);
      if (!s) continue;
      if (s.alongPxPerM > 0) along.push(s.alongPxPerM);
      if (s.acrossPxPerM > 0) across.push(s.acrossPxPerM);
    }
  }
  if (along.length === 0 || across.length === 0) return null;
  const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  return { alongPxPerM: mid(along), acrossPxPerM: mid(across) };
}

/**
 * 一台車在現場有多大（公尺）。
 *
 * <h3>為什麼是常數，不是從樣板反推</h3>
 * 先前拿樣板尺寸除以全圖的代表比例尺反推，沿線那一軸勉強說得通，橫向完全不行——橫向的
 * 比例尺量的是「軌道帶畫多粗代表幾公尺股距」，不是「畫面上橫向一公尺是幾像素」，兩者差
 * 一個數量級。反推出來的車寬是 <strong>0.67 公尺</strong>，畫出來就是一條線。
 *
 * 車有多大是現場的事實，跟圖怎麼畫無關，所以直接寫成常數。這張圖的整備格是 5.33×11.84
 * 公尺，車長取 12 公尺、車寬 2.6 公尺是一般巴士的尺寸。
 */
export const VEHICLE_LENGTH_M = 12;
export const VEHICLE_WIDTH_M = 2.6;

/** 車身最寬可以到車長的幾成。真車約 0.22，放寬到 0.6 留給示意圖壓縮 */
const MAX_VEHICLE_ASPECT = 0.6;

/**
 * 載具在某一塊上該畫多大。
 *
 * <h3>為什麼車身長度要跟著比例尺變</h3>
 * 同樣大的一格，代表的路徑長度可能差好幾倍——那正是示意圖的用意：畫面上一樣的距離，
 * 在現場可能是 50 公尺也可能是 200 公尺。車的<strong>真實長度是固定的</strong>，所以
 * 在比例尺大的地方畫得長、小的地方畫得短，看起來就是在那一段走得慢或快，這是對的。
 */
export function vehicleDisplaySizeOnFacility(opts: {
  facility: FacilityObject;
  area: MapAreaObject;
  /** 車輛真實尺寸（公尺），未給時用一般巴士 */
  lengthM?: number;
  widthM?: number;
}): { widthPx: number; heightPx: number } | null {
  const scale = pxPerMeterOnFacility(opts.facility, opts.area);
  if (!scale) return null;
  const lengthM = opts.lengthM ?? VEHICLE_LENGTH_M;
  const widthM = opts.widthM ?? VEHICLE_WIDTH_M;
  const box = resolveFacilityAreaSize(opts.facility, opts.area.domain, opts.area.layout);
  const longSide = Math.max(box.w, box.h);
  const shortSide = Math.min(box.w, box.h);
  // 夾住：再怎麼換算也不該長過它所在的那一塊，也不該細到看不見
  const widthPx = Math.min(longSide, Math.max(6, lengthM * scale.alongPxPerM));
  /*
   * 沿線被壓得很扁的那幾段，橫向卻是整條帶子的寬度：D08 一公尺只畫 1.65 像素，橫向卻有
   * 15.72，照實換算出來是 20 長 × 41 寬——一台比自己還寬的巴士。那是示意圖兩軸壓縮率不同
   * 的必然結果，不是算錯，但畫出來認不出是車。所以留一個上限，讓它至少還像一台車。
   */
  const heightPx = Math.min(
    shortSide * 0.9,
    widthPx * MAX_VEHICLE_ASPECT,
    Math.max(3, widthM * scale.acrossPxPerM),
  );
  return { widthPx, heightPx };
}
