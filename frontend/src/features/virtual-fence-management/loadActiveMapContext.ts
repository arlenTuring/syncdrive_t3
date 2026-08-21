import { fetchMapLibraryBackendStatus } from '../map-editor/api/mapLibraryApi';
import { resolveMapId } from '../map-editor/constants/builtinMaps';
import type { MapAreaObject, MapPixelSize } from '../map-editor/types/area';
import { DEFAULT_MAP_PIXEL_SIZE } from '../map-editor/types/area';
import { resolveParsedMapForPlatform } from '../map-editor/utils/mapLibraryStorage';
import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

type ActiveMapLibraryResponse = {
  mapId?: string;
  displayName?: string;
};

export type ActiveMapContext = {
  mapId: string;
  displayName: string;
  areas: MapAreaObject[];
  pixelSize: MapPixelSize;
  pixelOrigin: { x: number; y: number };
};

async function fetchActiveMapMeta(): Promise<{
  mapId: string;
  displayName: string;
} | null> {
  const urls = [
    '/syncdrive-api/map/library/active',
    `${resolveBrowserApiBaseUrl()}/syncdrive-api/map/library/active`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const body = (await res.json()) as ActiveMapLibraryResponse;
      const mapId = String(body.mapId ?? '').trim();
      if (!mapId) continue;
      return {
        mapId,
        displayName: String(body.displayName ?? mapId).trim() || mapId,
      };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * 僅載入目前啟用地圖（軌道／圖台）。
 * 虛擬圍籬資料不在此地圖 Geofence 內，見 virtualFenceStore。
 */
export async function loadActiveMapContext(): Promise<ActiveMapContext> {
  let mapId = '';
  let displayName = '';

  const active = await fetchActiveMapMeta();
  if (active) {
    mapId = active.mapId;
    displayName = active.displayName;
  }

  if (!mapId) {
    const status = await fetchMapLibraryBackendStatus();
    mapId = String(status?.activeMapId ?? '').trim();
    displayName = mapId;
  }

  if (!mapId) {
    throw new Error('目前沒有啟用的地圖');
  }

  const resolvedId = resolveMapId(mapId);
  const parsed = await resolveParsedMapForPlatform(resolvedId);
  if (!parsed) {
    throw new Error(`找不到地圖：${mapId}`);
  }

  return {
    mapId: resolvedId,
    displayName: displayName || resolvedId,
    areas: parsed.areas,
    pixelSize: parsed.pixelSize ?? DEFAULT_MAP_PIXEL_SIZE,
    pixelOrigin: parsed.pixelOrigin ?? { x: 0, y: 0 },
  };
}
