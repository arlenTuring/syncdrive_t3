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
import { parsePositiveRouteSeconds } from '../../map-editor/utils/routePlanning';
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

async function resolveActiveMapId(): Promise<string> {
  const status = await fetchMapLibraryBackendStatus();
  if (status?.activeMapId) {
    return resolveMapId(status.activeMapId);
  }
  return 't3-main-version';
}

function buildRouteOption(
  route: MapPlannedRoute,
  stationNameById: Map<string, string>,
  areas: MapAreaObject[],
  topology: PointTopology,
): ShiftRouteOption {
  const stationNames = route.stationIds.map((id) => stationNameById.get(id) ?? id);
  const stationPathLabel = stationNames.join(' → ') || '（無有效站點）';
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
    avgTravelTimeSeconds: fromTopology.timesComplete
      ? fromTopology.avgTravelTimeSeconds
      : parsePositiveRouteSeconds(route.avgTravelTimeSeconds),
    minTravelTimeSeconds: fromTopology.timesComplete
      ? fromTopology.minTravelTimeSeconds
      : parsePositiveRouteSeconds(route.minTravelTimeSeconds),
    stationLegTravels: fromTopology.legs,
  };
}

export async function loadShiftRouteGroupCatalog(): Promise<{
  mapId: string;
  mapDisplayName: string;
  groups: ShiftRouteGroupCatalogItem[];
}> {
  const mapId = await resolveActiveMapId();
  const parsed = await resolveParsedMapForPlatform(mapId);
  if (!parsed) {
    return { mapId, mapDisplayName: mapId, groups: [] };
  }

  const routes = parsed.routes ?? [];
  const routeGroups = ensureRouteGroupsForRoutes(routes, parsed.routeGroups ?? []);
  const { sections, ungrouped } = organizeRoutesByGroups(routeGroups, routes);
  const topology = parsed.pointTopology ?? emptyPointTopology();

  const stations = collectStationsFromAreas(parsed.areas);
  const stationNameById = new Map(
    stations.map((s) => [s.stationId, s.stationName]),
  );

  const groups: ShiftRouteGroupCatalogItem[] = sections.map(({ group, routes: groupRoutes }) => ({
    groupId: group.groupId,
    groupName: group.displayName,
    routes: groupRoutes.map((route) =>
      buildRouteOption(route, stationNameById, parsed.areas, topology),
    ),
  }));

  if (ungrouped.length > 0) {
    groups.push({
      groupId: '__ungrouped__',
      groupName: '未分組路線',
      routes: ungrouped.map((route) =>
        buildRouteOption(route, stationNameById, parsed.areas, topology),
      ),
    });
  }

  return {
    mapId: parsed.mapId,
    mapDisplayName: parsed.displayName,
    groups,
  };
}
