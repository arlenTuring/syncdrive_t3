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
