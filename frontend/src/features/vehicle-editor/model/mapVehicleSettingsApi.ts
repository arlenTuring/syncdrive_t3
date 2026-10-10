import { getDemoAccount } from '../../schedule-management/utils/demoAccountPreference';
import {
  resolveVehicleDefinitionsBackendUrl,
  vehicleDefinitionFromRow,
  type VehicleDefinitionRow,
} from '../api/vehicleDefinitionsApi';
import type { RouteActionIconRule } from '../../dashboard/types';
import type { VehicleDefinition } from '../types';

/**
 * 地圖用哪個車輛模型、畫多大（後端 syncdrive-api/map-vehicle-settings）。
 * 模型本身是 vehicle_definitions 的共用資產；地圖這邊只存引用與顯示設定。
 */
export type MapVehicleSetting = {
  definitionKey: string;
  definitionVersion: number | null;
  /** 顯示尺寸上限框（px）。車身依自己的比例等比塞進去，不會被拉伸 */
  displayWidthPx: number;
  displayHeightPx: number;
  actionIconRules?: RouteActionIconRule[];
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  behaviorIconSize?: number;
  updatedAt: number;
  updatedBy: string | null;
  migratedFrom?: { planeId: string; elementId: string; childId: string | null } | null;
};

export type MapVehicleResolution = {
  mapId: string;
  source: 'map' | 'default' | 'none';
  setting: MapVehicleSetting | null;
  definition: VehicleDefinition | null;
  missingDefinitionKey: string | null;
};

export type VehicleModelMigrationReport = {
  migrationId: string | null;
  dryRun: boolean;
  at: number;
  created: Array<{ mapId: string; setting: MapVehicleSetting; note: string | null }>;
  skipped: Array<{ mapId: string; reason: string }>;
  conflicts: Array<{ mapId: string; reason: string; candidates: unknown[] }>;
  defaultSet: string | null;
  previousDefault: MapVehicleSetting | null;
  rolledBackAt?: number;
};

const ENDPOINT = 'syncdrive-api/map-vehicle-settings';
const base = () => `${resolveVehicleDefinitionsBackendUrl()}/${ENDPOINT}`;
const headers = () => {
  const account = getDemoAccount();
  return {
    'Content-Type': 'application/json',
    'x-syncdrive-operator': `${account.id}`,
  };
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join('、') : body?.message;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchMapVehicleSettings() {
  return json<{
    defaultDefinitionKey: string | null;
    defaultSetting: MapVehicleSetting | null;
    maps: Record<string, MapVehicleSetting>;
  }>(await fetch(base()));
}

export async function resolveMapVehicle(mapId: string, signal?: AbortSignal) {
  const body = await json<
    Omit<MapVehicleResolution, 'definition'> & { definition: VehicleDefinitionRow | null }
  >(await fetch(`${base()}/${encodeURIComponent(mapId)}`, { signal }));
  return {
    ...body,
    definition: body.definition ? vehicleDefinitionFromRow(body.definition) : null,
  } satisfies MapVehicleResolution;
}

export async function putMapVehicleSetting(
  mapId: string,
  setting: Pick<MapVehicleSetting, 'definitionKey' | 'displayWidthPx' | 'displayHeightPx'> &
    Partial<MapVehicleSetting>,
) {
  return json<MapVehicleSetting>(
    await fetch(`${base()}/${encodeURIComponent(mapId)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(setting),
    }),
  );
}

export async function deleteMapVehicleSetting(mapId: string) {
  return json(await fetch(`${base()}/${encodeURIComponent(mapId)}`, { method: 'DELETE' }));
}

/** 系統預設模型與顯示尺寸；null 清除 */
export async function setDefaultVehicleModel(
  setting:
    | (Pick<MapVehicleSetting, 'definitionKey' | 'displayWidthPx' | 'displayHeightPx'> &
        Partial<MapVehicleSetting>)
    | null,
) {
  return json(
    await fetch(base(), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ defaultSetting: setting }),
    }),
  );
}

export async function runVehicleModelMigration(dryRun: boolean) {
  return json<VehicleModelMigrationReport>(
    await fetch(`${base()}/migrations?dry_run=${dryRun ? '1' : '0'}`, {
      method: 'POST',
      headers: headers(),
    }),
  );
}

export async function fetchVehicleModelMigrations() {
  return json<VehicleModelMigrationReport[]>(await fetch(`${base()}/migrations`));
}

export async function rollbackVehicleModelMigration(migrationId: string) {
  return json<{ removed: string[]; kept: Array<{ mapId: string; reason: string }>; defaultRestored: boolean }>(
    await fetch(`${base()}/migrations/${encodeURIComponent(migrationId)}/rollback`, {
      method: 'POST',
      headers: headers(),
    }),
  );
}
