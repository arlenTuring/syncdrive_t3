import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';

/**
 * 從路線中途加入的一趟（白皮書 DISPATCH-01～03）
 * ============================================
 *
 * 整備出場的車可以在路線中途的合法出場站加入，只服務之後的站。這一趟在班表上仍掛原路線
 * （routeId 不變，報表、班距、代號都照原路線），但站序、停靠與站間行駛要用「從加入站起算的那一段」。
 *
 * 全引擎用同一個入口換成那一段：{@link routeForJoinedBlock}。班次卡上記著加入站
 * （entryJoinedAtStationId），拿原路線進來就換成截短的那一段；已經是截短的就原樣回傳，
 * 呼叫幾次都一樣。
 */

const segmentCache = new WeakMap<ShiftScheduleSelectedRoute, Map<number, ShiftScheduleSelectedRoute | null>>();
const joinedSegments = new WeakSet<ShiftScheduleSelectedRoute>();

/**
 * 從路線第 index 站起算的那一段：站序、停靠、站間行駛都截短，行駛時間取各段加總。
 * 缺任何一段站間行駛時間就不能算（不猜、不均分），回 null。
 * 加入站本身是「首站」：不算停靠（跟一般路線首站一樣），上下客從它之後的站算起。
 */
export function buildJoinedRouteSegment(
  route: ShiftScheduleSelectedRoute,
  index: number,
): ShiftScheduleSelectedRoute | null {
  let byIndex = segmentCache.get(route);
  if (byIndex?.has(index)) return byIndex.get(index) ?? null;
  const segment = computeJoinedRouteSegment(route, index);
  if (!byIndex) {
    byIndex = new Map();
    segmentCache.set(route, byIndex);
  }
  byIndex.set(index, segment);
  if (segment) joinedSegments.add(segment);
  return segment;
}

function computeJoinedRouteSegment(
  route: ShiftScheduleSelectedRoute,
  index: number,
): ShiftScheduleSelectedRoute | null {
  if (!Number.isInteger(index) || index <= 0 || index >= route.stationIds.length - 1) return null;
  if (route.stationDwells.length !== route.stationIds.length) return null;
  const stationIds = route.stationIds.slice(index);
  const legs = route.stationLegTravels ?? [];
  let avg = 0;
  let min = 0;
  const pickedLegs = [];
  for (let k = 0; k < stationIds.length - 1; k += 1) {
    const leg = legs.find((item) => item.fromStationId === stationIds[k] && item.toStationId === stationIds[k + 1]);
    const legAvg = leg?.avgTravelTimeSeconds ?? leg?.minTravelTimeSeconds;
    const legMin = leg?.minTravelTimeSeconds ?? leg?.avgTravelTimeSeconds;
    if (!leg || legAvg == null || legMin == null || legAvg <= 0 || legMin <= 0) return null;
    avg += legAvg;
    min += legMin;
    pickedLegs.push(leg);
  }
  const dwells = route.stationDwells.slice(index).map((dwell, k) =>
    (k === 0 ? { ...dwell, dwellSeconds: 0, dwellRequired: false } : { ...dwell }));
  return {
    ...route,
    stationIds,
    stationDwells: dwells,
    stationLegTravels: pickedLegs,
    avgTravelTimeSeconds: avg,
    minTravelTimeSeconds: min,
  };
}

/** 這條路線是不是 {@link buildJoinedRouteSegment} 截出來的那一段 */
export function isJoinedRouteSegment(route: ShiftScheduleSelectedRoute): boolean {
  return joinedSegments.has(route);
}

/**
 * 班次卡實際跑的路線形狀：中途加入的換成從加入站截短的那一段，其餘原樣。
 *
 * 以加入站的 stationId 找位置，不記站序：站位求解可能把這一趟改派到別條路線，
 * 新路線也經過加入站就照樣從那一站截；新路線沒經過（或加入站就是它的起點）就是整條跑，
 * 出場移動會開到它的起點，出場銜接驗證照常檢查。截不出來（資料缺）也回原路線。
 */
export function routeForJoinedBlock<T extends ShiftScheduleSelectedRoute | null | undefined>(
  block: Pick<GeneratedScheduleBlock, 'entryJoinedAtStationId'>,
  route: T,
): T {
  const stationId = block.entryJoinedAtStationId?.trim();
  if (route == null || !stationId || isJoinedRouteSegment(route)) return route;
  const index = route.stationIds.findIndex((id) => id.trim() === stationId);
  if (index <= 0) return route;
  return (buildJoinedRouteSegment(route, index) ?? route) as T;
}
