import { VEHICLE_DEFINITIONS_STORAGE_KEY } from '../../../lib/canvasCacheReset';
import { createUserRestoredVtmsVehicle } from '../constants/userRestoredVtmsVehicle';
import vehicleDefinitionsSnapshot from '../constants/vehicleDefinitions.snapshot.json';
import { newVehicleId } from '../utils/id';
import { migrateVehicleDefinition } from '../utils/migrateVehicleDefinition';
import type { VehicleDefinition } from '../types';

function loadEmbeddedVehicleDefinitions(): VehicleDefinition[] {
  const snapshot = vehicleDefinitionsSnapshot as VehicleDefinition[];
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return [migrateVehicleDefinition(createUserRestoredVtmsVehicle())];
  }
  return snapshot.map(migrateVehicleDefinition);
}

function persistVehicleDefinitions(list: VehicleDefinition[]): void {
  try {
    localStorage.setItem(VEHICLE_DEFINITIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

export { migrateVehicleDefinition } from '../utils/migrateVehicleDefinition';

export const DEFAULT_VEHICLE_DEFINITION_NAME = 'VTMS 巴士 · PMS01';

export function loadVehicleDefinitions(): VehicleDefinition[] {
  try {
    const raw = localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY);
    if (!raw) return loadEmbeddedVehicleDefinitions();
    const parsed = JSON.parse(raw) as VehicleDefinition[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return loadEmbeddedVehicleDefinitions();
    }
    return parsed.map(migrateVehicleDefinition);
  } catch {
    return loadEmbeddedVehicleDefinitions();
  }
}

/** 內建範例載具（不依賴 localStorage id） */
export function embeddedSampleVehicleDefinition(): VehicleDefinition {
  return migrateVehicleDefinition(createUserRestoredVtmsVehicle());
}

/** 圖台預設：依名稱找範例載具，否則取第一筆，最後回落內建範例 */
export function resolveDefaultMapVehicleDefinition(): VehicleDefinition {
  return (
    resolveVehicleDefinition(undefined, DEFAULT_VEHICLE_DEFINITION_NAME) ??
    loadVehicleDefinitions()[0] ??
    embeddedSampleVehicleDefinition()
  );
}

export function resolveVehicleDefinition(
  id?: string,
  name?: string,
): VehicleDefinition | null {
  const list = loadVehicleDefinitions();
  if (id) {
    const byId = list.find((v) => v.id === id);
    if (byId) return byId;
  }
  if (name?.trim()) {
    const byName = list.find((v) => v.name === name.trim());
    if (byName) return byName;
  }
  return null;
}

/** 新增一筆載具定義並寫入 localStorage（與載具編輯器共用） */
export function appendVehicleDefinitions(definitions: VehicleDefinition[]): void {
  const list = [...loadVehicleDefinitions(), ...definitions.map(migrateVehicleDefinition)];
  persistVehicleDefinitions(list);
}

/** 圖台載具容器：建立空白載具並回傳 id */
export function createBlankVehicleForContainer(name = '圖台載具'): string {
  const id = newVehicleId('vc');
  const now = Date.now();
  appendVehicleDefinitions([
    {
      id,
      name,
      width: 300,
      height: 106,
      backgroundColor: 'transparent',
      elements: [],
      previewData: {
        vehicle_code: 'PMS01',
        trip_code: 'D0950',
        overall_health: 'OK',
      },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return id;
}

/** 解析圖台綁定的載具定義（id → 名稱 → 預設範例） */
export function resolveMapPlatformVehicleDefinition(opts: {
  vehicleDefinitionId?: string;
  vehicleDefinitionName?: string;
  useDefaultVehicleDefinition?: boolean;
}): VehicleDefinition | null {
  const { vehicleDefinitionId, vehicleDefinitionName, useDefaultVehicleDefinition } = opts;
  const byRef = resolveVehicleDefinition(vehicleDefinitionId, vehicleDefinitionName);
  if (byRef) return byRef;
  if (useDefaultVehicleDefinition || vehicleDefinitionName?.trim()) {
    return resolveDefaultMapVehicleDefinition();
  }
  return null;
}
