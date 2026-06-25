import {
  MAP_DRAFT_PREFIX,
  MAP_OFFICIAL_PREFIX,
} from '../features/map-editor/utils/mapDraftStorage'
import { restoreBuiltinMapLibraryEntries } from '../features/map-editor/utils/mapLibraryStorage'
import {
  cloneDemoPlane,
  DEMO_LAYOUT_SEED,
} from '../features/dashboard/constants/demoPlane'
import { patchDashboardRuntimeFixes } from '../features/dashboard/utils/migrateVehicleMonitorProtocol'

const DEMO_LAYOUT_VERSION = 113;

/** 儀表板平面 localStorage */
export const DASHBOARD_PLANES_STORAGE_KEY = 'syncdrive_dashboard_planes'
export const DASHBOARD_LAYOUT_SEED_KEY = 'syncdrive_dashboard_layout_seed'

/** 載具編輯器 localStorage */
export const VEHICLE_DEFINITIONS_STORAGE_KEY = 'syncdrive_vehicle_definitions'

export type CanvasCacheClearResult = {
  /** 已刪除的地圖草稿 key 數量 */
  removedMapKeys: number
  /** 是否曾存在儀表板平面或版面種子 */
  hadDashboardCache: boolean
}

export type CanvasCacheRestoreResult = {
  removedMapKeys: number
  restoredBuiltinMaps: number
  dashboardRestored: boolean
}

/** 刪除地圖編輯器所有草稿（不刪除地圖庫與 legacy official） */
export function clearMapEditorDraftCache(): number {
  let removedMapKeys = 0
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(MAP_DRAFT_PREFIX)) continue
      keysToRemove.push(key)
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
      removedMapKeys++
    }
  } catch {
    /* quota / private mode */
  }
  return removedMapKeys
}

/** @deprecated 保留相容；僅清除 draft，不動地圖庫 */
export function clearMapEditorDraftAndOfficialCache(): number {
  let removedMapKeys = clearMapEditorDraftCache()
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(MAP_OFFICIAL_PREFIX)) continue
      keysToRemove.push(key)
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
      removedMapKeys++
    }
  } catch {
    /* ignore */
  }
  return removedMapKeys
}

/** 刪除儀表板已儲存平面（重新整理後由 loadPlanes 載入預設） */
export function clearDashboardCanvasCache(): boolean {
  let hadDashboardCache = false
  try {
    hadDashboardCache =
      localStorage.getItem(DASHBOARD_PLANES_STORAGE_KEY) !== null ||
      localStorage.getItem(DASHBOARD_LAYOUT_SEED_KEY) !== null
    localStorage.removeItem(DASHBOARD_PLANES_STORAGE_KEY)
    localStorage.removeItem(DASHBOARD_LAYOUT_SEED_KEY)
  } catch {
    /* ignore */
  }
  return hadDashboardCache
}

/** 寫入內建 3840×1080 範例大屏（由應用程式設定「還原兩個圖台範例」呼叫） */
export function restoreDashboardExampleToLocalStorage(): boolean {
  try {
    const demo = {
      ...patchDashboardRuntimeFixes(cloneDemoPlane()),
      demoLayoutVersion: DEMO_LAYOUT_VERSION,
    }
    localStorage.setItem(DASHBOARD_PLANES_STORAGE_KEY, JSON.stringify([demo]))
    localStorage.setItem(DASHBOARD_LAYOUT_SEED_KEY, DEMO_LAYOUT_SEED)
    return true
  } catch {
    return false
  }
}

/**
 * 清除兩個圖台相關的本機快取：
 * - 地圖編輯器：僅 draft（保留地圖庫中使用者自建地圖）
 * - 儀表板：已儲存平面（重新整理後載入預設範例）
 */
export function clearAllCanvasExampleAndDraftCache(): CanvasCacheClearResult {
  const removedMapKeys = clearMapEditorDraftCache()
  const hadDashboardCache = clearDashboardCanvasCache()
  return { removedMapKeys, hadDashboardCache }
}

/**
 * 還原兩個圖台內建範例：
 * - 地圖編輯器：重載「軌道合併加道路線」，不刪除使用者自建／複製地圖
 * - 儀表板：寫入最新內建範例大屏
 */
export async function restoreAllCanvasExamples(): Promise<CanvasCacheRestoreResult> {
  const removedMapKeys = clearMapEditorDraftCache()
  const restoredBuiltinMaps = await restoreBuiltinMapLibraryEntries()
  const dashboardRestored = restoreDashboardExampleToLocalStorage()
  return { removedMapKeys, restoredBuiltinMaps, dashboardRestored }
}
