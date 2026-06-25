/**
 * 地圖畫布存儲工具
 * 掃描地圖庫，供 Dashboard 的 MapCanvasWidget 選用。
 */
import { readMapLibrary } from '../../map-editor/utils/mapLibraryStorage';

export interface MapOption {
  mapId: string;
  displayName: string;
  source: 'builtin' | 'user';
}

/** 取得所有可用地圖清單（地圖庫） */
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
