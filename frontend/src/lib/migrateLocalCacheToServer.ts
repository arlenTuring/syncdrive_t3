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
import { migrateVehicleDefinition } from '../features/vehicle-editor/utils/migrateVehicleDefinition';

/** 載具定義快取被後端內容換掉時發出；圖台聽到就重新套用車輛外觀 */
export const VEHICLE_DEFINITIONS_UPDATED_EVENT = 'syncdrive:vehicle-definitions-updated';

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
      } else {
        /*
         * 伺服器有就<strong>以伺服器為準寫回快取</strong>。
         *
         * 圖台上的車長什麼樣子，是照快取裡的載具定義畫的；而後端那份原本只有打開
         * 載具編輯器才會被拉下來。沒開過載具編輯器的瀏覽器（換一台電腦、或直接開
         * GCP 那個網址）快取裡找不到版面指定的那個定義，車就退回預設小圖示——實測
         * 本機與 GCP 的資料表已經一模一樣，GCP 畫面上的車還是縮成一小塊、車號擠在
         * 一起。
         */
        const next = remoteVehicles.map(migrateVehicleDefinition);
        const serialized = JSON.stringify(next);
        if (window.localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY) !== serialized) {
          window.localStorage.setItem(VEHICLE_DEFINITIONS_STORAGE_KEY, serialized);
          window.dispatchEvent(new Event(VEHICLE_DEFINITIONS_UPDATED_EVENT));
        }
      }
    } catch {
      /* 後端不可用：下次啟動或下次存檔再補 */
    }
  })();
}
