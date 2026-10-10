import { VEHICLE_DEFINITIONS_STORAGE_KEY } from '../../../lib/canvasCacheReset';
import { migrateVehicleDefinition } from '../utils/migrateVehicleDefinition';
import type { VehicleDefinition } from '../types';

export { migrateVehicleDefinition } from '../utils/migrateVehicleDefinition';

/**
 * 本機快取裡的模型（後端清單的副本，App 啟動時由 migrateLocalCacheToServer 寫入）。
 *
 * 只給還沒遷移到圖資管理的舊圖台元件同步查模型用（resolveLegacyCanvasVehicleTemplate、
 * 儀表板獨立載具容器）。快取空就是空的：不再拿程式內建的範例模型頂替——那不是使用者的模型。
 */
export function loadVehicleDefinitions(): VehicleDefinition[] {
  try {
    const raw = localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as VehicleDefinition[]) : [];
    return Array.isArray(parsed) ? parsed.map(migrateVehicleDefinition) : [];
  } catch {
    return [];
  }
}

/** 依 ID 找模型（只認明確 ID，不依名稱或清單順序猜） */
export function resolveVehicleDefinition(id?: string): VehicleDefinition | null {
  if (!id) return null;
  return loadVehicleDefinitions().find((v) => v.id === id) ?? null;
}

/**
 * 舊快取保全：以後端內容覆寫本機快取之前，把「本機有、但後端沒有或內容不同」的模型另存一份。
 *
 * 快取以前是模型的唯一存放處；只在某台瀏覽器做過的模型，若直接被後端清單蓋掉就永遠找不回來。
 * 另存在 LEGACY_VEHICLE_DEFINITIONS_KEY，由圖資管理 → 車輛模型 → 舊資料逐一比對、由使用者決定匯入。
 * 同 ID 已經另存過就不覆蓋（保留第一次看到的那份）。
 */
export const LEGACY_VEHICLE_DEFINITIONS_KEY = 'syncdrive_vehicle_definitions_legacy';

function vehicleContentKey(v: VehicleDefinition): string {
  return JSON.stringify({
    name: v.name,
    width: v.width,
    height: v.height,
    backgroundColor: v.backgroundColor ?? null,
    elements: v.elements,
    previewData: v.previewData ?? null,
    rearAxleFromTailRatio: v.rearAxleFromTailRatio ?? null,
  });
}

export function stashLegacyVehicleCache(serverList: VehicleDefinition[]): void {
  try {
    const raw = localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY);
    const cached = raw ? (JSON.parse(raw) as VehicleDefinition[]) : [];
    if (!Array.isArray(cached) || cached.length === 0) return;
    const server = new Map(
      serverList.map((v) => [v.id, vehicleContentKey(migrateVehicleDefinition(v))]),
    );
    const stashRaw = localStorage.getItem(LEGACY_VEHICLE_DEFINITIONS_KEY);
    const stash = stashRaw ? (JSON.parse(stashRaw) as VehicleDefinition[]) : [];
    const stashed = new Set((Array.isArray(stash) ? stash : []).map((v) => v.id));
    const additions = cached.filter(
      (v) =>
        v?.id &&
        !stashed.has(v.id) &&
        // 已經從後端讀過的（帶版本）不是「只在本機」的舊資料
        v.serverVersion === undefined &&
        server.get(v.id) !== vehicleContentKey(migrateVehicleDefinition(v)),
    );
    if (additions.length === 0) return;
    localStorage.setItem(
      LEGACY_VEHICLE_DEFINITIONS_KEY,
      JSON.stringify([...(Array.isArray(stash) ? stash : []), ...additions]),
    );
  } catch {
    /* 讀不到或寫不進去：不影響畫面 */
  }
}

export function readLegacyVehicleCache(): VehicleDefinition[] {
  try {
    const raw = localStorage.getItem(LEGACY_VEHICLE_DEFINITIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as VehicleDefinition[]) : [];
    return Array.isArray(parsed) ? parsed.map(migrateVehicleDefinition) : [];
  } catch {
    return [];
  }
}
