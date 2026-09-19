import { resolveMaintenanceTasksBackendUrl } from './maintenanceTasksApi';

export type MapWaypointItem = {
  waypointCode: string;
  facilityId: string;
  areaId: string;
  areaName: string;
  /** 畫圖的人給的名字（如「整備調度入口點」）；沒取名時後端不送這一欄 */
  alias?: string;
  /** 途經點的顯示類別（如入口途經點、交叉軌道途經點） */
  kindLabel?: string;
  xM?: number;
  yM?: number;
};

/** 下拉要顯示的字：有取名就用名字，代號放在後面對照 */
export function waypointOptionLabel(item: MapWaypointItem): string {
  const alias = item.alias?.trim();
  return alias ? `${alias}（${item.waypointCode}）` : item.waypointCode;
}

export type MapWaypointsResponse = {
  mapId: string;
  items: MapWaypointItem[];
};

export async function fetchMapWaypoints(
  mapId: string,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<MapWaypointsResponse> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/map/${encodeURIComponent(mapId)}/waypoints`,
  );
  if (!res.ok) {
    throw new Error(`載入途經點失敗（${res.status}）`);
  }
  return res.json() as Promise<MapWaypointsResponse>;
}

export type MapStationItem = {
  stationId: string;
  stationName: string;
  facilityId: string;
  areaId: string;
};

export type MapStationsResponse = {
  mapId: string;
  stations: MapStationItem[];
};

/**
 * 地圖上的停靠站（正線站點）。
 * 只有待命任務用得到——待命的車可以停在正線停靠站上候用，
 * 其他整備任務一定要進實體設施格，不能佔著正線站位。
 */
export async function fetchMapStations(
  mapId: string,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<MapStationsResponse> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/map/${encodeURIComponent(mapId)}/operation-nodes`,
  );
  if (!res.ok) {
    throw new Error(`載入停靠站失敗（${res.status}）`);
  }
  return res.json() as Promise<MapStationsResponse>;
}
