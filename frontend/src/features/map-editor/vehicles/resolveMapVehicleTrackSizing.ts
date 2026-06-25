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
