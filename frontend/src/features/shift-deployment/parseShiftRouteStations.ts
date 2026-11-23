import { isStoppingStation, type RouteStationJsonItem } from '../dashboard/route-progress/resolveStations';

export type ShiftRouteStation = {
  id: string;
  name: string;
  stationId?: string;
  /**
   * 車只是經過、不停的點（轉線點這類途經點）：不畫點也不寫站名，但留在站序裡——
   * 車端回報的目標站可能就是它，進度要照完整站序算才不會跳位。規則同儀表板班次卡。
   */
  passThrough: boolean;
};

export function parseShiftRouteStations(routeStations: string): ShiftRouteStation[] {
  let items: RouteStationJsonItem[] = [];
  try {
    const parsed = JSON.parse(routeStations || '[]') as unknown;
    if (Array.isArray(parsed)) {
      items = parsed as RouteStationJsonItem[];
    }
  } catch {
    items = [];
  }
  return items.map((item, index) => ({
    id: item.station_id || item.name || `s${index}`,
    name: item.name || item.station_id || `站${index + 1}`,
    stationId: item.station_id,
    passThrough: !isStoppingStation(item),
  }));
}
