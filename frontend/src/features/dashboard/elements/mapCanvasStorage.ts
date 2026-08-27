/**
 * 地圖畫布存儲工具
 * 掃描地圖庫，供 Dashboard 的 MapCanvasWidget 選用。
 */
import { readMapLibrary } from '../../map-editor/utils/mapLibraryStorage';
import { fetchPublishedMapList } from '../../map-editor/api/mapLibraryApi';

export interface MapOption {
  mapId: string;
  displayName: string;
  source: 'builtin' | 'user' | 'server';
}

/**
 * 取得所有可用地圖清單。
 *
 * 只讀 localStorage 是不夠的：地圖庫是<strong>每個瀏覽器各自一份</strong>，
 * 換一台電腦、換一個瀏覽器、清一次快取就空了。這時儀表板的地圖元件即使已經
 * 存著正確的 mapId，選單也列不出對應的項目，看起來就像「選了又被還原」。
 *
 * 所以再加上伺服器已發佈的那些。同一個 mapId 以本機為準——本機那份可能有還沒
 * 發佈的修改。
 */
export async function getAvailableMapsAsync(): Promise<MapOption[]> {
  const local = getAvailableMaps();
  const seen = new Set(local.map((m) => m.mapId));

  try {
    const { maps } = await fetchPublishedMapList();
    for (const m of maps) {
      const id = m.mapId || m.libraryId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      local.push({ mapId: id, displayName: `[伺服器] ${m.displayName}`, source: 'server' });
    }
  } catch {
    /* 連不上伺服器就只列本機的，不要讓整個選單掛掉 */
  }

  return local;
}

/** 取得本機地圖庫的清單（同步；完整清單請用 getAvailableMapsAsync） */
export function getAvailableMaps(): MapOption[] {
  const maps: MapOption[] = [];

  try {
    for (const entry of readMapLibrary()) {
      maps.push({
        mapId: entry.libraryId,
        displayName: entry.builtinId
          ? `[內建] ${entry.displayName}`
          : entry.displayName,
        source: entry.builtinId ? 'builtin' : 'user',
      });
    }
  } catch {
    /* localStorage 不可用 */
  }

  return maps;
}
