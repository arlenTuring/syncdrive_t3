import {
  DASHBOARD_PLANES_STORAGE_KEY,
  VEHICLE_DEFINITIONS_STORAGE_KEY,
} from './canvasCacheReset';
import {
  fetchDashboardPlanes,
  saveDashboardPlanes,
} from '../features/dashboard/api/dashboardPlanesApi';
import {
  fetchVehicleDefinitions,
  saveVehicleDefinitions,
} from '../features/vehicle-editor/api/vehicleDefinitionsApi';
import type { DashboardPlane } from '../features/dashboard/types';
import type { VehicleDefinition } from '../features/vehicle-editor/types';

/**
 * 本機快取 → 伺服器的一次性遷移
 * ==============================
 *
 * <strong>為什麼要放在 App 啟動而不是各自的編輯器裡。</strong>
 * 圖台版面與載具定義原本存在 localStorage，搬進資料庫之後需要把既有內容送上去。
 * 第一版把這件事掛在 <code>useDashboardEditor</code> 與 <code>useVehicleEditor</code>，
 * 但那兩個 hook <strong>只在對應的編輯器頁面掛載</strong>——使用者停在班次紀錄或
 * 虛擬圍籬時它們根本不會跑。
 *
 * 實測（2026-08-24，使用者重新整理後查資料庫）就卡在這裡：
 *
 *   module_dashboard_pages   1 筆（側欄殼層會讀，所以有機會存進去）
 *   dashboard_planes         0 筆
 *   vehicle_definitions      0 筆
 *
 * 於是那筆模組頁面對應指向 demo-plane，而 dashboard_planes 裡沒有這一列——換一台
 * 電腦開就會指到伺服器上不存在的版面。遷移的觸發條件不該取決於使用者剛好開了哪一頁。
 *
 * <strong>只在伺服器確實是空的時候推。</strong>永遠不拿本機的舊快取覆蓋伺服器上
 * 已有的內容——那會讓兩台機器互相蓋掉對方的編輯。伺服器有東西就什麼都不做，
 * 之後由各編輯器自己的載入流程以伺服器為準。
 */

function readCache<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** 整個瀏覽器分頁只跑一次，避免重複掛載時重送 */
let started = false;

export function migrateLocalCacheToServer(): void {
  if (started) return;
  started = true;

  void (async () => {
    try {
      const remotePlanes = await fetchDashboardPlanes();
      if (remotePlanes.length === 0) {
        const local = readCache<DashboardPlane>(DASHBOARD_PLANES_STORAGE_KEY);
        if (local.length > 0) await saveDashboardPlanes(local);
      }
    } catch {
      /* 後端不可用：下次啟動或下次存檔再補 */
    }

    try {
      const remoteVehicles = await fetchVehicleDefinitions();
      if (remoteVehicles.length === 0) {
        const local = readCache<VehicleDefinition>(VEHICLE_DEFINITIONS_STORAGE_KEY);
        if (local.length > 0) await saveVehicleDefinitions(local);
      }
    } catch {
      /* 後端不可用：下次啟動或下次存檔再補 */
    }
  })();
}
