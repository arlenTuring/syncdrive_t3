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
 *
 * <strong>但伺服器沒有的就別列。</strong>本機快取是<strong>快取</strong>，不是另一份
 * 真相：在別處刪掉的地圖若還留在這台瀏覽器裡，選單就會列出一個已經不存在的選項，
 * 選下去在別台機器上是空的。只有兩種本機項目留著——內建範例（伺服器上本來就沒有）
 * 與還沒發佈成功的（刪了就真的沒了）。伺服器連不上時整個不過濾，沿用快取。
 */
export async function getAvailableMapsAsync(): Promise<MapOption[]> {
  const localAll = getAvailableMaps();

  let published: Awaited<ReturnType<typeof fetchPublishedMapList>>;
  try {
    published = await fetchPublishedMapList();
  } catch {
    /* 連不上伺服器就只列本機的，不要讓整個選單掛掉 */
    return localAll;
  }

  const liveIds = new Set(
    published.maps.map((m) => m.mapId || m.libraryId).filter(Boolean),
  );
  const keepLocal = new Set(
    readMapLibrary()
      .filter((e) => e.builtinId || e.publishState === 'pending')
      .map((e) => e.libraryId),
  );
  const local = localAll.filter((m) => liveIds.has(m.mapId) || keepLocal.has(m.mapId));
  const seen = new Set(local.map((m) => m.mapId));

  {
    const { maps } = published;
    for (const m of maps) {
      const id = m.mapId || m.libraryId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      /*
       * 同名的地圖不只一份（實測後端有兩份都叫「軌道合併加道路線」，
       * 一份 6 條路線、一份 8 條）。只加「[伺服器]」前綴分不出來，
       * 使用者會選到舊的那一份還以為選對了。標上路線數與日期。
       */
      const mark = [
        typeof m.routeCount === 'number' ? `${m.routeCount} 條路線` : null,
        m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('zh-TW') : null,
      ].filter(Boolean).join(' · ');
      local.push({
        mapId: id,
        displayName: mark ? `${m.displayName}（${mark}）` : m.displayName,
        source: 'server',
      });
    }
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
