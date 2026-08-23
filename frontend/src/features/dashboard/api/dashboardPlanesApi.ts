import { getDataSourceById } from '../store/useDataSourceStore';
import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase';
import type { DashboardPlane } from '../types';

/**
 * 圖台版面與模組頁面對應的後端存取
 * （TP13C §1.4 介面資源 · dashboard_planes、module_dashboard_pages）。
 *
 * <strong>為什麼要搬離 localStorage。</strong>版面原本只存在瀏覽器
 * <code>syncdrive_dashboard_planes</code>：換一台電腦或清一次快取就沒了，匯入匯出也
 * 只是讀寫本機 JSON，沒有任何伺服器端版本紀錄。營運全景圖台是規範要求的核心功能，
 * 版面屬於系統資產。模組頁面對應更是<strong>系統配置而非個人偏好</strong>——管理者
 * 設定好之後，所有操作人員看到的模組頁面必須一致。
 *
 * <strong>localStorage 沒有拿掉，改當離線快取。</strong>圖台編輯器是重度互動介面
 * （拖曳、縮放每秒數十次），每一次都打後端不切實際；後端連不上時畫面也必須能開。
 * 所以後端是真相，快取只負責讓畫面不空白。
 */

type DashboardPlaneRow = {
  planeId: string;
  name: string;
  width: number;
  height: number;
  viewportMode?: string | null;
  elements?: unknown;
  isTemplate?: boolean | null;
  version?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type ModuleDashboardPageRow = {
  id: string;
  moduleId: string;
  label: string;
  planeId: string;
  sortOrder?: number | null;
  createdAt?: number | null;
};

function backendUrl(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl);
}

const PLANES = 'syncdrive-api/dashboard/planes';
const PAGES = 'syncdrive-api/dashboard/module-pages';

/**
 * 後端列 → 前端版面。
 *
 * <code>planeId</code> 就是前端原本的 <code>id</code>：模組頁面對應、側欄導覽綁的都是
 * 這個值，換到資料庫之後那些綁定必須繼續有效，所以它是對外身分，uuid 只是內部主鍵。
 */
function toPlane(row: DashboardPlaneRow): DashboardPlane {
  return {
    id: row.planeId,
    name: row.name,
    width: row.width,
    height: row.height,
    viewportMode:
      row.viewportMode === 'fit-width' ? 'fit-width' : 'fixed-scale',
    elements: Array.isArray(row.elements) ? (row.elements as DashboardPlane['elements']) : [],
    createdAt: row.createdAt ?? Date.now(),
    updatedAt: row.updatedAt ?? Date.now(),
  } as DashboardPlane;
}

function toRow(plane: DashboardPlane): DashboardPlaneRow {
  return {
    planeId: plane.id,
    name: plane.name,
    width: plane.width,
    height: plane.height,
    viewportMode: plane.viewportMode ?? 'fixed-scale',
    elements: plane.elements ?? [],
  };
}

export async function fetchDashboardPlanes(): Promise<DashboardPlane[]> {
  const res = await fetch(`${backendUrl()}/${PLANES}`);
  if (!res.ok) throw new Error(`圖台版面載入失敗（${res.status}）`);
  const rows = (await res.json()) as DashboardPlaneRow[];
  return Array.isArray(rows) ? rows.map(toPlane) : [];
}

/** 整批覆寫：送進去的清單就是完整結果，沒出現的會被刪除 */
export async function saveDashboardPlanes(
  planes: DashboardPlane[],
): Promise<void> {
  const res = await fetch(`${backendUrl()}/${PLANES}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: planes.map(toRow) }),
  });
  if (!res.ok) throw new Error(`圖台版面儲存失敗（${res.status}）`);
}

export async function fetchModuleDashboardPages(): Promise<ModuleDashboardPageRow[]> {
  const res = await fetch(`${backendUrl()}/${PAGES}`);
  if (!res.ok) throw new Error(`模組頁面對應載入失敗（${res.status}）`);
  const rows = (await res.json()) as ModuleDashboardPageRow[];
  return Array.isArray(rows) ? rows : [];
}

export async function saveModuleDashboardPages(
  items: ModuleDashboardPageRow[],
): Promise<void> {
  const res = await fetch(`${backendUrl()}/${PAGES}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`模組頁面對應儲存失敗（${res.status}）`);
}
