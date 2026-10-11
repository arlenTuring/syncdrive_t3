import type { MapAreaObject } from '../types/area';
import type { FacilityObject } from '../types/facility';
import type { VehicleDefinition } from '../../vehicle-editor/types';
import { fitVehicleMarkerSize } from '../../vehicle-editor/utils/vehicleContentBounds';
import { resolveFacilityAreaSize } from '../utils/facilityAreaCoords';
import {
  getTrackGenLatPerBox,
  getTrackGenPaths,
} from '../utils/trackGenPaths';

/**
 * 圖台沒有車輛模型時的後備顯示尺寸（px）。有模型時尺寸來自圖資管理的地圖設定，
 * 而且只當上限框：車身依模型自己的比例等比放進去（見 fitVehicleMarkerSize）。
 *
 * 以前這裡還有「依軌道寬度、公尺比例尺換算車身長寬」的一組工具；車身改成等比之後
 * 那些長寬各自換算的結果不再使用，已移除。
 */
export const DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX = 60;
export const DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX = 10;

/**
 * 地圖上一台車的 marker 寬高（地圖座標 px）——即時監控、降級頁、圖資預覽、回放共用。
 *
 * 只吃車輛模型與圖資管理保存的顯示尺寸，<strong>不吃格位、軌道或設施</strong>：使用者把調度區、
 * 整備區、充電區放大縮小，是為了容納已設定好的車，設施尺寸不能反過來決定車身。放不下就照實
 * 畫出來（車身凸出格位），讓使用者再調設施。整張圖的縮放由圖台外層 transform 等比處理，
 * 不改這裡的值。車身一律等比（見 fitVehicleMarkerSize）。
 */
export function resolveMapVehicleMarkerSize(
  definition: VehicleDefinition | null,
  displayWidthPx: number,
  displayHeightPx: number,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  if (!definition) return { width: fallback.width, height: fallback.height };
  const fitted = fitVehicleMarkerSize(
    definition,
    Math.max(4, displayWidthPx),
    Math.max(2, displayHeightPx),
  );
  return { width: fitted.width, height: fitted.height };
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
