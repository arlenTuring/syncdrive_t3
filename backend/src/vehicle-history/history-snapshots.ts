import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import { DegradedReplayMap } from '../database/entities/degraded-replay.entities';
import type { MapService } from '../map/map.service';
import type { MapVehicleSettingsService } from '../vehicle-definition/map-vehicle-settings.service';

/**
 * 回放用的地圖與車輛模型快照（降級回放與運行管理紀錄共用）。
 *
 * 地圖依內容雜湊存進 degraded_replay_maps（同一份內容只存一次），之後地圖被改、被蓋掉，
 * 歷史仍用當時那一份。車輛模型存整份內容＋顯示設定，不只存 ID。
 */
export type MapSnapshotRef = {
  mapId: string;
  hash: string;
  version: string | null;
  displayName: string | null;
};

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function saveActiveMapSnapshot(
  mapService: MapService,
  maps: Repository<DegradedReplayMap>,
): Promise<MapSnapshotRef | null> {
  const doc = mapService.getActivePublishedMapLibrary();
  const document = doc.mapDocument;
  if (!document || typeof document !== 'object') return null;
  const hash = hashJson(document);
  const mapId = String(doc.mapId ?? '');
  const version = typeof document.version === 'string' ? document.version : null;
  await maps
    .createQueryBuilder()
    .insert()
    .into(DegradedReplayMap)
    .values({
      mapHash: hash,
      mapId,
      mapVersion: version,
      document: document as DegradedReplayMap['document'],
      createdAt: String(Date.now()),
    })
    .orIgnore()
    .execute();
  const displayName = typeof document.displayName === 'string' ? document.displayName : null;
  return { mapId, hash, version, displayName };
}

/** 這張地圖目前用的車輛模型（模型內容＋顯示設定）；讀不到回 null */
export async function vehicleModelSnapshot(
  mapVehicles: MapVehicleSettingsService,
  mapId: string,
): Promise<Record<string, unknown>> {
  const resolution = await mapVehicles.resolve(mapId);
  const definition = resolution.definition;
  return {
    capturedAt: Date.now(),
    source: resolution.source,
    setting: resolution.setting,
    missingDefinitionKey: resolution.missingDefinitionKey,
    definition: definition
      ? {
          definitionKey: definition.definitionKey,
          name: definition.name,
          version: definition.version,
          width: definition.width,
          height: definition.height,
          backgroundColor: definition.backgroundColor,
          elements: definition.elements as unknown,
          previewData: definition.previewData as unknown,
          rearAxleFromTailRatio: definition.rearAxleFromTailRatio,
          createdAt: definition.createdAt,
          updatedAt: definition.updatedAt,
        }
      : null,
  };
}

/** 模型快照的內容雜湊（不含擷取時刻），判斷模型或顯示設定有沒有變 */
export function vehicleModelHash(snapshot: Record<string, unknown>): string {
  const { capturedAt: _ignored, ...rest } = snapshot;
  void _ignored;
  return hashJson(rest);
}
