import { VTMS_VEHICLE_POOL } from '../dashboard/constants/vtmsVehiclePool';
import { fetchMapLibraryBackendStatus } from '../map-editor/api/mapLibraryApi';
import { resolveMapId } from '../map-editor/constants/builtinMaps';
import { resolveParsedMapForPlatform } from '../map-editor/utils/mapLibraryStorage';
import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

const PMS_CODE = /^PMS/i;

export type PsdVehicleCard = {
  id: string;
  label: string;
};

export type PsdDoorTile = {
  id: string;
  label: string;
  mqttId?: string;
};

export type PsdPlatformCard = {
  id: string;
  name: string;
  doors: PsdDoorTile[];
};

type MapFacility = {
  id?: string;
  type?: string;
  name?: string;
  customName?: string;
};

type MapArea = {
  id?: string;
  customName?: string;
  facilities?: MapFacility[];
};

type ActiveMapLibraryResponse = {
  mapId?: string;
  mapDocument?: {
    areas?: MapArea[];
  };
};

function isGateFacility(facility: MapFacility): boolean {
  return facility.type === 'PSD' || facility.name === 'Gate';
}

function cardTitleFromArea(area: MapArea): string {
  const raw = String(area.customName ?? area.id ?? '').trim();
  if (!raw) return '月台';
  const station = raw.replace(/^Area\s+\S+\s+·\s+/i, '').replace(/\s*站台\s*$/, '').trim();
  return station || raw;
}

function gateLabel(facility: MapFacility): string {
  const custom = String(facility.customName ?? '').trim();
  if (custom) return custom;
  const id = String(facility.id ?? '').trim();
  return id ? `月台門 ${id}` : '月台門';
}

function platformsFromAreas(areas: MapArea[]): PsdPlatformCard[] {
  const cards: PsdPlatformCard[] = [];
  for (const area of areas) {
    const doors: PsdDoorTile[] = [];
    for (const facility of area.facilities ?? []) {
      if (!isGateFacility(facility)) continue;
      const id = String(facility.id ?? '').trim();
      if (!id) continue;
      const mqttId = String(
        (facility as { parameters?: { mqttInstanceId?: string } }).parameters?.mqttInstanceId
          ?? '',
      ).trim();
      doors.push({ id, label: gateLabel(facility), mqttId: mqttId || id });
    }
    if (doors.length === 0) continue;
    doors.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }));
    const areaId = String(area.id ?? cards.length);
    cards.push({
      id: areaId,
      name: cardTitleFromArea(area),
      doors,
    });
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }));
}

async function fetchActiveMapDocument(): Promise<{ mapId: string; areas: MapArea[] } | null> {
  const urls = [
    '/syncdrive-api/map/library/active',
    `${resolveBrowserApiBaseUrl()}/syncdrive-api/map/library/active`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const body = (await res.json()) as ActiveMapLibraryResponse;
      const areas = body.mapDocument?.areas;
      if (!Array.isArray(areas)) continue;
      return {
        mapId: String(body.mapId ?? ''),
        areas,
      };
    } catch {
      // try next
    }
  }
  return null;
}

/** 資料庫 `vehicles` 表啟用中的 PMS 車隊 */
export async function listRegisteredVehicles(): Promise<PsdVehicleCard[]> {
  try {
    const res = await fetch(`${resolveBrowserApiBaseUrl()}/syncdrive-api/vehicles`);
    if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{ id?: string; vehicle_code?: string }>;
      };
      const items = (data.items ?? [])
        .map((item) => {
          const code = String(item.vehicle_code ?? '').trim();
          if (!PMS_CODE.test(code)) return null;
          return {
            id: String(item.id || code),
            label: code,
          };
        })
        .filter((item): item is PsdVehicleCard => item != null);
      if (items.length > 0) return items;
    }
  } catch {
    // fall through
  }
  return VTMS_VEHICLE_POOL.map((code) => ({ id: code, label: code }));
}

/**
 * 月台門：讀「目前使用中地圖」JSON 裡的 Gate／PSD 元件（地圖庫發佈檔，不是 Postgres）。
 */
export async function listActiveMapPlatforms(): Promise<PsdPlatformCard[]> {
  const active = await fetchActiveMapDocument();
  if (active) {
    const cards = platformsFromAreas(active.areas);
    if (cards.length > 0) return cards;
  }

  const status = await fetchMapLibraryBackendStatus().catch(() => null);
  const mapId = resolveMapId(status?.activeMapId || active?.mapId || 't3-main-version');
  const parsed = await resolveParsedMapForPlatform(mapId);
  if (!parsed) return [];
  return platformsFromAreas((parsed.areas ?? []) as MapArea[]);
}
