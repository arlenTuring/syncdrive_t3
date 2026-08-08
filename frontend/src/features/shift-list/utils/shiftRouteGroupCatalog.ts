import { fetchMapLibraryBackendStatus } from '../../map-editor/api/mapLibraryApi';
import { resolveMapId } from '../../map-editor/constants/builtinMaps';
import { collectStationsFromAreas } from '../../map-editor/utils/dockingPointStationId';
import {
  ensureRouteGroupsForRoutes,
  organizeRoutesByGroups,
} from '../../map-editor/utils/routeGroupPlanning';
import { resolveParsedMapForPlatform } from '../../map-editor/utils/mapLibraryStorage';
import type { MapAreaObject } from '../../map-editor/types/area';
import type { MapPlannedRoute } from '../../map-editor/types/mapFile';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import { facilityDockingTopologyNodeId } from '../../map-editor/utils/pointTopology';
import {
  getFacilityDockingPoint,
  resolveFacilityDockingPointListTitle,
} from '../../map-editor/utils/facilityDockingPoint';
import { parsePositiveRouteSeconds } from '../../map-editor/utils/routePlanning';
import { collectCrossoverPortalWaypointsFromAreas } from '../../map-editor/utils/waypointCode';
import {
  buildMaintenanceFirstTripOriginsFromTopology,
  type MaintenanceFirstTripOrigin,
} from './maintenanceFirstTripOrigins';
import {
  buildStationLegTravelsFromTopology,
  type ShiftScheduleStationLegTravel,
} from './stationLegTravel';

export type ShiftRouteOption = {
  routeId: string;
  label: string;
  stationPathLabel: string;
  stationIds: string[];
  stationNames: string[];
  /** 與 stationIds 對齊：false＝虛擬渡線端點，不停靠、不需填停靠時間 */
  stationDwellRequired?: boolean[];
  avgTravelTimeSeconds: number | null;
  minTravelTimeSeconds: number | null;
  /** 由地圖點位拓撲展開的站間行駛時間；不完整時為空陣列 */
  stationLegTravels: ShiftScheduleStationLegTravel[];
};

export type ShiftRouteGroupCatalogItem = {
  groupId: string;
  groupName: string;
  routes: ShiftRouteOption[];
};

export type ShiftRouteGroupMapOption = {
  mapId: string;
  displayName: string;
};

async function resolveActiveMapId(): Promise<string> {
  const status = await fetchMapLibraryBackendStatus();
  if (status?.activeMapId) {
    return resolveMapId(status.activeMapId);
  }
  return 't3-main-version';
}

async function listAvailableMaps(
  activeMapId: string,
  activeDisplayName?: string | null,
): Promise<ShiftRouteGroupMapOption[]> {
  const byId = new Map<string, ShiftRouteGroupMapOption>();
  try {
    const status = await fetchMapLibraryBackendStatus();
    for (const map of status?.maps ?? []) {
      const mapId = resolveMapId(map.mapId);
      if (!mapId) continue;
      byId.set(mapId, {
        mapId,
        displayName: map.displayName?.trim() || mapId,
      });
    }
  } catch {
    // 後端不可用時至少保留目前選中地圖
  }
  const resolvedActive = resolveMapId(activeMapId);
  if (resolvedActive && !byId.has(resolvedActive)) {
    byId.set(resolvedActive, {
      mapId: resolvedActive,
      displayName: activeDisplayName?.trim() || resolvedActive,
    });
  }
  if (byId.size === 0) {
    byId.set('t3-main-version', {
      mapId: 't3-main-version',
      displayName: '軌道合併加道路線',
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'zh-Hant'),
  );
}

function collectFacilityDockingStationNames(
  areas: MapAreaObject[],
): Array<{ stationId: string; stationName: string }> {
  const out: Array<{ stationId: string; stationName: string }> = [];
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Facility') continue;
      if (!getFacilityDockingPoint(facility)) continue;
      out.push({
        stationId: facilityDockingTopologyNodeId(facility.id),
        stationName: resolveFacilityDockingPointListTitle(facility),
      });
    }
  }
  return out;
}

function buildRouteOption(
  route: MapPlannedRoute,
  stationNameById: Map<string, string>,
  crossoverStationIds: ReadonlySet<string>,
  areas: MapAreaObject[],
  topology: PointTopology,
): ShiftRouteOption {
  const stationNames = route.stationIds.map((id) => stationNameById.get(id) ?? id);
  const stationPathLabel = stationNames.join(' → ') || '（無有效站點）';
  const stationDwellRequired = route.stationIds.map((id) => !crossoverStationIds.has(id));
  const fromTopology = buildStationLegTravelsFromTopology(
    topology,
    areas,
    route.stationIds,
  );

  return {
    routeId: route.routeId,
    label: route.displayName,
    stationPathLabel,
    stationIds: [...route.stationIds],
    stationNames,
    stationDwellRequired,
    avgTravelTimeSeconds: fromTopology.timesComplete
      ? fromTopology.avgTravelTimeSeconds
      : parsePositiveRouteSeconds(route.avgTravelTimeSeconds),
    minTravelTimeSeconds: fromTopology.timesComplete
      ? fromTopology.minTravelTimeSeconds
      : parsePositiveRouteSeconds(route.minTravelTimeSeconds),
    stationLegTravels: fromTopology.legs,
  };
}

/**
 * 載入班表步驟四用的路線群組。
 * preferredMapId 有值時強制用該 map JSON（含 pointTopology）；否則用目前啟用地圖。
 */
export async function loadShiftRouteGroupCatalog(
  preferredMapId?: string,
): Promise<{
  mapId: string;
  mapDisplayName: string;
  groups: ShiftRouteGroupCatalogItem[];
  availableMaps: ShiftRouteGroupMapOption[];
  firstTripOrigins: MaintenanceFirstTripOrigin[];
  /** 完整拓樸：整備／調度入廠卡要自己尋路，只有 origins 不夠 */
  pointTopology: PointTopology;
}> {
  const preferred = preferredMapId?.trim()
    ? resolveMapId(preferredMapId.trim())
    : '';
  const mapId = preferred || (await resolveActiveMapId());
  const availableMaps = await listAvailableMaps(mapId);
  const parsed = await resolveParsedMapForPlatform(mapId);
  if (!parsed) {
    return {
      mapId,
      mapDisplayName: availableMaps.find((m) => m.mapId === mapId)?.displayName ?? mapId,
      groups: [],
      availableMaps,
      firstTripOrigins: [],
      pointTopology: emptyPointTopology(),
    };
  }

  const routes = parsed.routes ?? [];
  const routeGroups = ensureRouteGroupsForRoutes(routes, parsed.routeGroups ?? []);
  const { sections, ungrouped } = organizeRoutesByGroups(routeGroups, routes);
  const topology = parsed.pointTopology ?? emptyPointTopology();
  const firstTripOrigins = buildMaintenanceFirstTripOriginsFromTopology(topology);

  const stations = collectStationsFromAreas(parsed.areas);
  const stationNameById = new Map(
    stations.map((s) => [s.stationId, s.stationName]),
  );
  for (const waypoint of collectCrossoverPortalWaypointsFromAreas(parsed.areas)) {
    stationNameById.set(waypoint.stationId, waypoint.stationName);
  }
  // 拓撲標籤先填；設施參數別名為準，覆寫 fdock 顯示名
  for (const node of topology.nodes) {
    if (node.kind !== 'facility-docking') continue;
    const label = node.label?.trim();
    if (!label) continue;
    stationNameById.set(node.id, label);
  }
  for (const dock of collectFacilityDockingStationNames(parsed.areas)) {
    stationNameById.set(dock.stationId, dock.stationName);
  }
  const crossoverStationIds = new Set(
    collectCrossoverPortalWaypointsFromAreas(parsed.areas).map((w) => w.stationId),
  );

  const groups: ShiftRouteGroupCatalogItem[] = sections.map(({ group, routes: groupRoutes }) => ({
    groupId: group.groupId,
    groupName: group.displayName,
    routes: groupRoutes.map((route) =>
      buildRouteOption(route, stationNameById, crossoverStationIds, parsed.areas, topology),
    ),
  }));

  if (ungrouped.length > 0) {
    groups.push({
      groupId: '__ungrouped__',
      groupName: '未分組路線',
      routes: ungrouped.map((route) =>
        buildRouteOption(route, stationNameById, crossoverStationIds, parsed.areas, topology),
      ),
    });
  }

  const mapDisplayName = parsed.displayName?.trim()
    || availableMaps.find((m) => m.mapId === parsed.mapId)?.displayName
    || parsed.mapId;

  // 解析後名稱可能比庫列更準（文件 displayName）
  const mapsWithResolvedName = availableMaps.some((m) => m.mapId === parsed.mapId)
    ? availableMaps.map((m) =>
        m.mapId === parsed.mapId ? { ...m, displayName: mapDisplayName } : m,
      )
    : [
        ...availableMaps,
        { mapId: parsed.mapId, displayName: mapDisplayName },
      ];

  return {
    mapId: parsed.mapId,
    mapDisplayName,
    groups,
    availableMaps: mapsWithResolvedName,
    firstTripOrigins,
    pointTopology: topology,
  };
}
