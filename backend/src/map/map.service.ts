import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { backendScriptPath } from '../common/backend-script-path';
import { MapEntity } from '../database/entities/map.entity';
import {
  MapVersion,
  MapVersionStatus,
} from '../database/entities/map-version.entity';

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

/** 草稿固定用第 0 版；發布之後才遞增（見 MapVersion 的欄位說明） */
const DRAFT_VERSION = 0;

@Injectable()
export class MapService implements OnModuleInit {
  constructor(
    @InjectRepository(MapEntity)
    private readonly maps: Repository<MapEntity>,
    @InjectRepository(MapVersion)
    private readonly mapVersions: Repository<MapVersion>,
  ) {}

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

  /**
   * 地圖編輯器儲存。
   *
   * <h3>為什麼要寫資料庫</h3>
   * 圖資是整個系統共用的資產，不是某一台瀏覽器的偏好設定：一個人畫好的路線與途經點，
   * 模擬器、排班引擎、另一台電腦上的同事都要看得到同一份。之前只寫
   * backend/data/published-maps 的 JSON 檔，而且是按下發布才寫——編輯過程完全留在
   * localStorage，於是「我明明畫好了」與「伺服器上什麼都沒有」同時成立。
   *
   * 現在每一次儲存都進 map_versions（草稿版，第 0 版），地圖清單與開圖都讀資料庫。
   * 檔案那一份仍然同步寫：waypoints、operation-nodes 那幾支腳本與模擬器是讀檔的，
   * 拿掉會讓它們一起瞎掉。
   */
  async publishMapLibrary(
    mapId: string,
    body: {
      libraryId?: string;
      displayName?: string;
      version?: string;
      updatedAt?: string;
      mapDocument: Record<string, unknown>;
    },
  ): Promise<PublishedMapLibraryDocumentDto> {
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
    await this.saveMapDraftToDb(mapId, body);
    return written as PublishedMapLibraryDocumentDto;
  }

  /** 存一份到資料庫；資料庫不通時不擋存檔（檔案那一份已經寫好了），但要留紀錄 */
  private async saveMapDraftToDb(
    mapId: string,
    body: {
      libraryId?: string;
      displayName?: string;
      version?: string;
      updatedAt?: string;
      mapDocument: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      const now = Date.now();
      const displayName = String(
        body.displayName ?? body.mapDocument?.displayName ?? mapId,
      );
      const existing = await this.maps.findOne({ where: { mapId } });
      if (existing) {
        existing.displayName = displayName;
        existing.updatedAt = now;
        await this.maps.save(existing);
      } else {
        await this.maps.save(
          this.maps.create({
            mapId,
            displayName,
            isActive: false,
            currentVersion: 0,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }

      const draft = await this.mapVersions.findOne({
        where: { mapId, version: DRAFT_VERSION },
      });
      if (draft) {
        draft.body = body.mapDocument;
        draft.schemaVersion = String(body.version ?? '');
        draft.updatedAt = now;
        await this.mapVersions.save(draft);
      } else {
        await this.mapVersions.save(
          this.mapVersions.create({
            mapId,
            version: DRAFT_VERSION,
            status: MapVersionStatus.DRAFT,
            body: body.mapDocument,
            schemaVersion: String(body.version ?? ''),
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    } catch (err) {
      console.warn(`[map-library] 寫入資料庫失敗（${mapId}）`, err);
    }
  }

  /**
   * 刪除一份已發佈的地圖。
   *
   * 前端只刪 localStorage 是不夠的——下次補水就整份回來，使用者以為刪掉了、
   * 重整又出現。使用中的那一份擋下來：圖台與模擬器都靠它。
   */
  deleteMapLibrary(mapId: string): { ok: boolean; mapId: string } {
    const id = String(mapId ?? '').trim();
    if (!id) throw new BadRequestException('mapId is required');
    const result = mapPublishedStore.deletePublishedEntry(id);
    if (!result.ok && result.reason === 'active map cannot be deleted') {
      throw new ForbiddenException('使用中的地圖不能刪除，請先切換到別張再刪');
    }
    return { ok: Boolean(result.ok), mapId: id };
  }

  async setActiveMapLibrary(body: {
    mapId: string;
    libraryId?: string;
    displayName?: string;
    version?: string;
    updatedAt?: string;
    mapDocument?: Record<string, unknown>;
  }): Promise<
    PublishedMapLibraryDocumentDto & {
      activeMapId: string;
      activeLibraryId: string;
    }
  > {
    const mapId = String(body.mapId ?? '').trim();
    if (!mapId) {
      throw new BadRequestException('mapId is required');
    }
    if (body.mapDocument) {
      await this.publishMapLibrary(mapId, {
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

  /**
   * facility id（或 mapCode）→ 中心點座標（公尺，場域參照座標）。
   * 用於 origin/destination.kind === 'facility' 補座標（範圍型設施取範圍中心）。
   * 查不到回 null，呼叫端應自行決定要不要跳過補值，不丟例外。
   */
  getFacilityCenter(mapId: string, facilityId: string): { xM: number; yM: number } | null {
    return mapFieldEquipment.resolveFacilityCenterById(mapId, facilityId);
  }

  /**
   * 座標 → 場區格位（矩形命中測試）。取代車端回報 yard_slot_id：
   * 車輛回報 local_pose.position，中心端自行比對落在哪個格位範圍內。
   * 沒有命中（例如車輛在正線軌道上）回 null。
   */
  findFacilityAtPoint(
    mapId: string,
    xM: number,
    yM: number,
  ): { mapCode: string; equipmentId: string; equipmentKind: string } | null {
    return mapFieldEquipment.findFacilityAtPoint(mapId, xM, yM);
  }

  /** 車輛即時座標 → 站點／最小命中設施／軌道（依此優先序）。 */
  findVehicleLocationAtPoint(
    mapId: string,
    xM: number,
    yM: number,
    options: { speedMps?: number | null } = {},
  ): { kind: 'STATION' | 'FACILITY' | 'TRACK'; label: string; objectId: string } | null {
    return mapFieldEquipment.findVehicleLocationAtPoint(mapId, xM, yM, {
      speedMps: options.speedMps ?? undefined,
    });
  }
}
