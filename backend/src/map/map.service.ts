import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { backendScriptPath } from '../common/backend-script-path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapNodes = require(backendScriptPath('map-operation-nodes.js'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapPublishedStore = require(backendScriptPath('map-published-store.js'));

export type MapStationDto = {
  stationId: string;
  stationName: string;
  routeId?: string;
  xM: number;
  yM: number;
  facilityId: string;
  areaId: string;
};

/** @deprecated 請改用 MapStationDto */
export type OperationNodeDto = MapStationDto & {
  nodeId: string;
  nodeRole?: string;
  routeStation?: string;
  actionType?: string;
};

export type FieldEquipmentDto = {
  equipmentId: string;
  mapCode: string;
  equipmentKind: string;
  /** equipment = 紅綠燈／智慧桿／月台門；facility = 大型區塊 */
  objectCategory?: 'equipment' | 'facility';
  label: string;
  purpose?: string;
  mqttInstanceId?: string;
  areaId: string;
  areaName: string;
  facilityType?: string;
};

export type MapWaypointDto = {
  waypointCode: string;
  facilityId: string;
  areaId: string;
  areaName: string;
};

export type PublishedMapLibraryEntryDto = {
  mapId: string;
  libraryId: string;
  displayName: string;
  version: string;
  updatedAt: string | null;
  source: string;
  routeCount?: number;
};

export type PublishedMapLibraryDocumentDto = PublishedMapLibraryEntryDto & {
  mapDocument: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapFieldEquipment = require(backendScriptPath('map-field-equipment.js'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapWaypoints = require(backendScriptPath('map-waypoints.js'));

function toStationDto(entry: {
  stationId: string;
  stationName: string;
  routeId?: string;
  xM: number;
  yM: number;
  facilityId: string;
  areaId: string;
}): MapStationDto {
  return {
    stationId: entry.stationId,
    stationName: entry.stationName,
    routeId: entry.routeId,
    xM: entry.xM,
    yM: entry.yM,
    facilityId: entry.facilityId,
    areaId: entry.areaId,
  };
}

function activeMapId(): string {
  return (
    process.env.ACTIVE_MAP_ID?.trim() || mapPublishedStore.getActiveMapId()
  );
}

@Injectable()
export class MapService implements OnModuleInit {
  onModuleInit() {
    try {
      const id = activeMapId();
      const seeded = mapPublishedStore.seedPublishedFromBuiltinIfMissing(id);
      if (seeded) {
        console.log(`[map-library] seeded published map from builtin: ${id}`);
      }
    } catch (err) {
      console.warn('[map-library] seed failed', err);
    }
  }

  assertInternalPublishToken(token: string | undefined) {
    const expected = process.env.SYNC_INTERNAL_TOKEN ?? 'sync-dev-internal';
    if (!token || token !== expected) {
      throw new ForbiddenException('Invalid or missing X-Sync-Internal-Token');
    }
  }

  getActiveMapLibraryStatus(): {
    activeMapId: string;
    activeLibraryId: string | null;
    activeDisplayName: string | null;
    activeUpdatedAt: string | null;
  } {
    const cfg = mapPublishedStore.readActiveMapConfig();
    const id = activeMapId();
    return {
      activeMapId: id,
      activeLibraryId: cfg?.libraryId ?? null,
      activeDisplayName: cfg?.displayName ?? null,
      activeUpdatedAt: cfg?.updatedAt ?? null,
    };
  }

  listPublishedMapLibrary(): {
    maps: PublishedMapLibraryEntryDto[];
    activeMapId: string;
    activeLibraryId: string | null;
    activeDisplayName: string | null;
  } {
    const maps =
      mapPublishedStore.listPublishedEntries() as PublishedMapLibraryEntryDto[];
    const status = this.getActiveMapLibraryStatus();
    return {
      maps,
      activeMapId: status.activeMapId,
      activeLibraryId: status.activeLibraryId,
      activeDisplayName: status.activeDisplayName,
    };
  }

  getPublishedMapLibrary(mapId: string): PublishedMapLibraryDocumentDto {
    const hit = mapPublishedStore.readPublishedEntry(mapId);
    if (!hit) {
      throw new NotFoundException(`Published map not found: ${mapId}`);
    }
    return hit as PublishedMapLibraryDocumentDto;
  }

  getActivePublishedMapLibrary(): PublishedMapLibraryDocumentDto {
    return this.getPublishedMapLibrary(activeMapId());
  }

  publishMapLibrary(
    mapId: string,
    body: {
      libraryId?: string;
      displayName?: string;
      version?: string;
      updatedAt?: string;
      mapDocument: Record<string, unknown>;
    },
  ): PublishedMapLibraryDocumentDto {
    const docMapId = String(body.mapDocument?.mapId ?? mapId).trim();
    if (docMapId && docMapId !== mapId) {
      throw new ForbiddenException('mapDocument.mapId must match URL mapId');
    }
    const written = mapPublishedStore.writePublishedEntry(mapId, {
      libraryId: body.libraryId ?? mapId,
      displayName: body.displayName,
      version: body.version,
      updatedAt: body.updatedAt,
      mapDocument: body.mapDocument,
    });
    return written as PublishedMapLibraryDocumentDto;
  }

  setActiveMapLibrary(body: {
    mapId: string;
    libraryId?: string;
    displayName?: string;
    version?: string;
    updatedAt?: string;
    mapDocument?: Record<string, unknown>;
  }): PublishedMapLibraryDocumentDto & {
    activeMapId: string;
    activeLibraryId: string;
  } {
    const mapId = String(body.mapId ?? '').trim();
    if (!mapId) {
      throw new BadRequestException('mapId is required');
    }
    if (body.mapDocument) {
      this.publishMapLibrary(mapId, {
        libraryId: body.libraryId,
        displayName: body.displayName,
        version: body.version,
        updatedAt: body.updatedAt,
        mapDocument: body.mapDocument,
      });
    } else if (!mapPublishedStore.readPublishedEntry(mapId)) {
      const builtin = mapPublishedStore.resolveBuiltinMapPath(mapId);
      if (!builtin) {
        throw new NotFoundException(`Published map not found: ${mapId}`);
      }
    }
    const active = mapPublishedStore.writeActiveMapConfig({
      activeMapId: mapId,
      libraryId: body.libraryId ?? mapId,
      displayName: body.displayName,
    });
    const doc = this.getActivePublishedMapLibrary();
    return {
      ...doc,
      activeMapId: active.activeMapId,
      activeLibraryId: active.libraryId,
    };
  }

  listPublishedMapIds(): string[] {
    const published = mapPublishedStore
      .listPublishedEntries()
      .map((e: { mapId: string }) => e.mapId);
    if (published.length > 0) return published;
    return [activeMapId()];
  }

  private resolveMapPath(mapId: string): string {
    const mapPath = mapNodes.resolveMapJsonPath(mapId);
    if (!mapPath) {
      throw new NotFoundException(`Map not found: ${mapId}`);
    }
    return mapPath;
  }

  getOperationNodes(mapId: string): {
    mapId: string;
    nodes: OperationNodeDto[];
    stations: MapStationDto[];
  } {
    const mapPath = this.resolveMapPath(mapId);
    const registry = mapNodes.loadStationsFromMapFile(mapPath);
    const stations = (registry.stations ?? []).map(toStationDto);
    const nodes = stations.map((s) => ({
      ...s,
      nodeId: s.stationId,
    }));
    return {
      mapId: registry.mapId ?? mapId,
      nodes,
      stations,
    };
  }

  getStation(mapId: string, stationId: string): MapStationDto {
    const mapPath = this.resolveMapPath(mapId);
    const registry = mapNodes.loadStationsFromMapFile(mapPath);
    const hit = mapNodes.resolveStationById(registry, stationId);
    if (!hit) {
      throw new NotFoundException(`Station not found: ${stationId}`);
    }
    return toStationDto(hit);
  }

  getFieldEquipment(
    mapId: string,
    kind:
      | 'charging'
      | 'signal'
      | 'smart_pole'
      | 'platform_door'
      | 'car_wash'
      | 'maintenance'
      | 'yard_slot'
      | 'equipment'
      | 'facility'
      | 'all' = 'all',
  ): {
    mapId: string;
    items: FieldEquipmentDto[];
  } {
    const registry = mapFieldEquipment.loadFieldEquipment(mapId, kind);
    if (!registry) {
      throw new NotFoundException(`Map not found: ${mapId}`);
    }
    return registry;
  }

  getWaypoints(mapId: string): {
    mapId: string;
    items: MapWaypointDto[];
  } {
    const registry = mapWaypoints.loadWaypoints(mapId);
    if (!registry) {
      throw new NotFoundException(`Map not found: ${mapId}`);
    }
    return registry;
  }
}
