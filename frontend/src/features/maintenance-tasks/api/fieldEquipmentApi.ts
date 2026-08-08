import { resolveMaintenanceTasksBackendUrl } from './maintenanceTasksApi';

export type FieldEquipmentKind =
  | 'charging'
  | 'signal'
  | 'smart_pole'
  | 'platform_door'
  | 'car_wash'
  | 'maintenance'
  | 'yard_slot'
  | 'equipment'
  | 'facility'
  | 'all';

export type FieldEquipmentItem = {
  equipmentId: string;
  mapCode: string;
  equipmentKind: string;
  objectCategory?: 'equipment' | 'facility';
  label: string;
  purpose?: string;
  mqttInstanceId?: string;
  areaId: string;
  areaName: string;
  facilityType?: string;
};

export type FieldEquipmentResponse = {
  mapId: string;
  items: FieldEquipmentItem[];
};

export const DEFAULT_MAINTENANCE_MAP_ID = 't3-main-version';

export async function fetchMapFieldEquipment(
  mapId = DEFAULT_MAINTENANCE_MAP_ID,
  kind: FieldEquipmentKind = 'charging',
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<FieldEquipmentResponse> {
  const qs = kind === 'all' ? '' : `?kind=${encodeURIComponent(kind)}`;
  const res = await fetch(
    `${backendUrl}/syncdrive-api/map/${encodeURIComponent(mapId)}/field-equipment${qs}`,
  );
  if (!res.ok) {
    throw new Error(`載入場域設施失敗（${res.status}）`);
  }
  return res.json() as Promise<FieldEquipmentResponse>;
}

function isCarWashEquipment(item: FieldEquipmentItem): boolean {
  return item.equipmentKind === 'car_wash' || item.purpose === '洗車格' || /^W\d+/i.test(item.mapCode);
}

/** 洗車設備：優先 car_wash；若後端尚未重啟導致空陣列，改從 yard_slot / all 篩 W* */
export async function fetchCarWashFieldEquipment(
  mapId = DEFAULT_MAINTENANCE_MAP_ID,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<FieldEquipmentResponse> {
  const primary = await fetchMapFieldEquipment(mapId, 'car_wash', backendUrl);
  if (primary.items.length > 0) return primary;

  try {
    const yard = await fetchMapFieldEquipment(mapId, 'yard_slot', backendUrl);
    const fromYard = yard.items.filter(isCarWashEquipment);
    if (fromYard.length > 0) {
      return { mapId: yard.mapId, items: fromYard };
    }
  } catch {
    // fall through
  }

  const all = await fetchMapFieldEquipment(mapId, 'all', backendUrl);
  return {
    mapId: all.mapId,
    items: all.items.filter(isCarWashEquipment),
  };
}

function isMaintenanceStation(item: FieldEquipmentItem): boolean {
  return (
    item.equipmentKind === 'maintenance' ||
    item.purpose === '保養格' ||
    /^M\d+/i.test(item.mapCode)
  );
}

export async function fetchMaintenanceStationEquipment(
  mapId = DEFAULT_MAINTENANCE_MAP_ID,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<FieldEquipmentResponse> {
  const primary = await fetchMapFieldEquipment(mapId, 'maintenance', backendUrl);
  if (primary.items.length > 0) return primary;

  try {
    const yard = await fetchMapFieldEquipment(mapId, 'yard_slot', backendUrl);
    const fromYard = yard.items.filter(isMaintenanceStation);
    if (fromYard.length > 0) {
      return { mapId: yard.mapId, items: fromYard };
    }
  } catch {
    // fall through
  }

  const all = await fetchMapFieldEquipment(mapId, 'all', backendUrl);
  return {
    mapId: all.mapId,
    items: all.items.filter(isMaintenanceStation),
  };
}

/**
 * 場域裡「車停得進去」的設施格：充電格、洗車格、保養格、調度格等。
 * 排除號誌／智慧桿／月台門這類不是停車位的設備。
 */
function isYardSlotFacility(item: FieldEquipmentItem): boolean {
  if (['signal', 'smart_pole', 'platform_door'].includes(item.equipmentKind)) {
    return false;
  }
  if (['charging', 'car_wash', 'maintenance', 'yard_slot'].includes(item.equipmentKind)) {
    return true;
  }
  if (item.objectCategory === 'facility') return true;
  return Boolean(item.purpose?.trim().endsWith('格'));
}

/**
 * 整備任務可掛載的設施：<strong>全部</strong>設施格，不依任務類型預先篩掉。
 *
 * 地圖上的「用途」（充電格／保養格／…）是給人看的分類，
 * 不是對整備任務的限制——要把哪一格掛給哪個整備任務，
 * 由整備任務自己決定（例如充電任務掛 M1 是合法的）。
 * 舊版每個 step 各自只抓自己那一類，導致設施掛滿後「＋」就永久變灰。
 *
 * `preferredPurpose` 只影響<strong>排序</strong>（把常用的那類排前面），不影響可選範圍。
 */
export async function fetchYardFacilityEquipment(
  mapId = DEFAULT_MAINTENANCE_MAP_ID,
  preferredPurpose?: string,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<FieldEquipmentResponse> {
  const all = await fetchMapFieldEquipment(mapId, 'all', backendUrl);
  const items = all.items.filter(isYardSlotFacility);
  if (!preferredPurpose) return { mapId: all.mapId, items };
  const preferred = preferredPurpose.trim();
  return {
    mapId: all.mapId,
    items: [...items].sort((a, b) => {
      const aHit = a.purpose?.trim() === preferred ? 0 : 1;
      const bHit = b.purpose?.trim() === preferred ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
      return a.mapCode.localeCompare(b.mapCode, 'en', { numeric: true });
    }),
  };
}
