import { resolveMaintenanceTasksBackendUrl } from './maintenanceTasksApi';

export type MapWaypointItem = {
  waypointCode: string;
  facilityId: string;
  areaId: string;
  areaName: string;
};

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
