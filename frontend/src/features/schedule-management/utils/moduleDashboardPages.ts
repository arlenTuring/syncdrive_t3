import { DASHBOARD_PLANES_STORAGE_KEY } from '../../../lib/canvasCacheReset';
import type { DashboardPlane } from '../../dashboard/types';
import {
  fetchDashboardPlanes,
  fetchModuleDashboardPages,
  saveModuleDashboardPages,
} from '../../dashboard/api/dashboardPlanesApi';

/**
 * 模組與圖台版面的對應（TP13C §1.4 介面資源 · module_dashboard_pages）。
 *
 * <strong>為什麼要搬離 localStorage。</strong>這份對應決定側欄各模組點進去要開哪一份
 * 版面——它是<strong>系統配置，不是個人偏好</strong>。管理者設定好之後，所有操作人員
 * 看到的模組頁面必須一致；存在瀏覽器等於每個人各看各的，換一台電腦就不見。
 *
 * <strong>同步讀取的介面維持不變。</strong>{@link readModuleDashboardPages} 仍然是
 * 同步函式（呼叫端在 render 期間就要拿到清單），所以它回傳的是快取；真相由
 * {@link refreshModuleDashboardPages} 從後端拉回來寫進快取。寫入則是先寫快取、
 * 再送後端。
 */

export type ModuleDashboardPage = {
  id: string;
  /** SIDEBAR_MODULE_GROUPS[].id */
  moduleId: string;
  label: string;
  planeId: string;
  createdAt: number;
};

const PAGES_STORAGE_KEY = 'syncdrive_vtms_module_dashboard_pages';

export function listStoredDashboardPlanes(): DashboardPlane[] {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PLANES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DashboardPlane =>
        !!item
        && typeof item === 'object'
        && typeof (item as DashboardPlane).id === 'string'
        && typeof (item as DashboardPlane).name === 'string',
    );
  } catch {
    return [];
  }
}

export function findStoredDashboardPlane(planeId: string): DashboardPlane | null {
  return listStoredDashboardPlanes().find((plane) => plane.id === planeId) ?? null;
}

/**
 * 把後端的版面拉回來寫進快取。
 *
 * <strong>沒有這一支，乾淨的瀏覽器點進模組子頁會看到「找不到儀表板平面」。</strong>
 * 對應（module_dashboard_pages）早就搬到後端了，版面（dashboard_planes）卻只有在
 * 使用者先打開過儀表板管理之後才會進到本機快取——對應查得到、版面查不到，畫面
 * 因此報「平面可能已被刪除」，但其實它好端端地在資料庫裡。
 *
 * 兩者都是系統配置，取得方式就該一致：後端是真相，localStorage 只是離線快取。
 *
 * 後端連不上時<strong>保留既有快取</strong>並回傳它——這一支的目的是讓畫面有東西
 * 可以畫，不是把畫面清空。
 */
export async function refreshDashboardPlanesCache(): Promise<DashboardPlane[]> {
  try {
    const planes = await fetchDashboardPlanes();
    if (planes.length > 0) {
      window.localStorage.setItem(DASHBOARD_PLANES_STORAGE_KEY, JSON.stringify(planes));
      return planes;
    }
  } catch {
    /* 後端連不上就沿用快取 */
  }
  return listStoredDashboardPlanes();
}

export function readModuleDashboardPages(): ModuleDashboardPage[] {
  try {
    const raw = window.localStorage.getItem(PAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ModuleDashboardPage =>
        !!item
        && typeof item === 'object'
        && typeof (item as ModuleDashboardPage).id === 'string'
        && typeof (item as ModuleDashboardPage).moduleId === 'string'
        && typeof (item as ModuleDashboardPage).planeId === 'string'
        && typeof (item as ModuleDashboardPage).label === 'string',
    );
  } catch {
    return [];
  }
}

export function writeModuleDashboardPages(pages: ModuleDashboardPage[]) {
  try {
    window.localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify(pages));
  } catch {
    // ignore
  }
  void saveModuleDashboardPages(
    pages.map((page, index) => ({
      id: page.id,
      moduleId: page.moduleId,
      label: page.label,
      planeId: page.planeId,
      sortOrder: index,
      createdAt: page.createdAt,
    })),
  ).catch(() => {
    /* 後端暫時不可用：快取已寫入，下一次儲存會整批補上 */
  });
}

/**
 * 從後端拉回對應清單並寫入快取。
 *
 * 後端是空的就不覆蓋——那代表尚未遷移，沿用本機既有設定，下一次儲存會把它整批送
 * 上去，等於一次自動遷移。
 */
export async function refreshModuleDashboardPages(): Promise<ModuleDashboardPage[]> {
  try {
    const rows = await fetchModuleDashboardPages();
    if (rows.length === 0) return readModuleDashboardPages();
    const pages: ModuleDashboardPage[] = rows.map((row) => ({
      id: row.id,
      moduleId: row.moduleId,
      label: row.label,
      planeId: row.planeId,
      createdAt: row.createdAt ?? Date.now(),
    }));
    try {
      window.localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify(pages));
    } catch {
      // ignore quota
    }
    return pages;
  } catch {
    // 後端不可用：沿用快取
    return readModuleDashboardPages();
  }
}

export function createModuleDashboardPageId(): string {
  return `mdp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function moduleDashboardViewId(pageId: string): string {
  return `mdp:${pageId}`;
}

export function parseModuleDashboardViewId(view: string): string | null {
  if (!view.startsWith('mdp:')) return null;
  const id = view.slice(4).trim();
  return id || null;
}
