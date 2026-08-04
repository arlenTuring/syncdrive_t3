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
