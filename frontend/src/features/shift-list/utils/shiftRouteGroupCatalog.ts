import { fetchMapLibraryBackendStatus } from '../../map-editor/api/mapLibraryApi';
import { resolveMapId } from '../../map-editor/constants/builtinMaps';
import { collectStationsFromAreas } from '../../map-editor/utils/dockingPointStationId';
import {
  ensureRouteGroupsForRoutes,
  organizeRoutesByGroups,
} from '../../map-editor/utils/routeGroupPlanning';
import { resolveParsedMapForPlatform } from '../../map-editor/utils/mapLibraryStorage';
import type { MapPlannedRoute } from '../../map-editor/types/mapFile';
import { parsePositiveRouteSeconds } from '../../map-editor/utils/routePlanning';

export type ShiftRouteOption = {
  routeId: string;
  label: string;
  stationPathLabel: string;
  stationIds: string[];
  stationNames: string[];
  avgTravelTimeSeconds: number | null;
  minTravelTimeSeconds: number | null;
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
): ShiftRouteOption {
  const stationNames = route.stationIds.map((id) => stationNameById.get(id) ?? id);
  const stationPathLabel = stationNames.join(' → ') || '（無有效站點）';

  return {
    routeId: route.routeId,
    label: route.displayName,
    stationPathLabel,
    stationIds: [...route.stationIds],
    stationNames,
    avgTravelTimeSeconds: parsePositiveRouteSeconds(route.avgTravelTimeSeconds),
    minTravelTimeSeconds: parsePositiveRouteSeconds(route.minTravelTimeSeconds),
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

  const stations = collectStationsFromAreas(parsed.areas);
  const stationNameById = new Map(
    stations.map((s) => [s.stationId, s.stationName]),
  );

  const groups: ShiftRouteGroupCatalogItem[] = sections.map(({ group, routes: groupRoutes }) => ({
    groupId: group.groupId,
    groupName: group.displayName,
    routes: groupRoutes.map((route) => buildRouteOption(route, stationNameById)),
  }));

  if (ungrouped.length > 0) {
    groups.push({
      groupId: '__ungrouped__',
      groupName: '未分組路線',
      routes: ungrouped.map((route) => buildRouteOption(route, stationNameById)),
    });
  }

  return {
    mapId: parsed.mapId,
    mapDisplayName: parsed.displayName,
    groups,
  };
}
