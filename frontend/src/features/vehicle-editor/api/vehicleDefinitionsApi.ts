import { getDataSourceById } from '../../dashboard/store/useDataSourceStore';
import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase';
import type { VehicleDefinition } from '../types';

/**
 * 載具外觀定義的後端存取（TP13C §1.4 主檔 · vehicle_definitions）。
 *
 * <strong>為什麼要搬離 localStorage。</strong>載具定義原本只存在瀏覽器的
 * <code>syncdrive_vehicle_definitions</code>：一個人畫好的車輛外觀別人看不到，
 * 換一台電腦、清一次快取就沒了。它是圖台與車輛監控畫面共用的呈現資產，
 * 文件明訂「任一帳號所見內容一致」。
 *
 * <strong>localStorage 沒有拿掉，改當離線快取。</strong>後端連不上時畫面仍要能開，
 * 而且載具編輯器是重度互動介面，每一筆拖曳都打後端不切實際。所以讀取是
 * 「先給快取、再用後端覆蓋」，寫入是「先寫快取、再送後端」——後端才是真相，
 * 快取只負責讓畫面不空白。
 */

/** 後端回傳的一列 */
type VehicleDefinitionRow = {
  definitionKey: string;
  name: string;
  vehicleModel?: string | null;
  width?: number | null;
  height?: number | null;
  backgroundColor?: string | null;
  elements?: unknown;
  previewData?: unknown;
  version?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export function resolveVehicleDefinitionsBackendUrl(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl);
}

const ENDPOINT = 'syncdrive-api/vehicle-definitions';

/**
 * 後端列 → 前端載具定義。
 *
 * <code>definitionKey</code> 就是前端原本的 <code>id</code>：圖台元件綁的是這個值，
 * 換到資料庫之後那些綁定必須繼續有效，所以它是對外身分，資料庫的 uuid 只是內部主鍵。
 */
function toDefinition(row: VehicleDefinitionRow): VehicleDefinition {
  return {
    id: row.definitionKey,
    name: row.name,
    width: row.width ?? 0,
    height: row.height ?? 0,
    backgroundColor: row.backgroundColor ?? 'transparent',
    elements: Array.isArray(row.elements) ? (row.elements as VehicleDefinition['elements']) : [],
    previewData: (row.previewData as VehicleDefinition['previewData']) ?? undefined,
    createdAt: row.createdAt ?? Date.now(),
    updatedAt: row.updatedAt ?? Date.now(),
  };
}

function toRow(definition: VehicleDefinition): VehicleDefinitionRow {
  return {
    definitionKey: definition.id,
    name: definition.name,
    width: definition.width ?? null,
    height: definition.height ?? null,
    backgroundColor: definition.backgroundColor ?? null,
    elements: definition.elements ?? [],
    previewData: definition.previewData ?? null,
  };
}

export async function fetchVehicleDefinitions(
  backendUrl = resolveVehicleDefinitionsBackendUrl(),
): Promise<VehicleDefinition[]> {
  const res = await fetch(`${backendUrl}/${ENDPOINT}`);
  if (!res.ok) {
    throw new Error(`載具定義載入失敗（${res.status}）`);
  }
  const rows = (await res.json()) as VehicleDefinitionRow[];
  return Array.isArray(rows) ? rows.map(toDefinition) : [];
}

/**
 * 整批覆寫：送進去的清單就是完整結果，沒出現的會被刪除。
 *
 * 編輯器在畫布上一次操作的是一整份清單（新增、刪除、改名、改元件樹都在同一個
 * state），逐筆 PATCH 會逼前端自己追蹤哪一筆變了，而且刪除很容易漏同步。
 * 清單本身只有個位數，整批寫入的成本可以忽略。
 */
export async function saveVehicleDefinitions(
  definitions: VehicleDefinition[],
  backendUrl = resolveVehicleDefinitionsBackendUrl(),
): Promise<VehicleDefinition[]> {
  const res = await fetch(`${backendUrl}/${ENDPOINT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: definitions.map(toRow) }),
  });
  if (!res.ok) {
    throw new Error(`載具定義儲存失敗（${res.status}）`);
  }
  const rows = (await res.json()) as VehicleDefinitionRow[];
  return Array.isArray(rows) ? rows.map(toDefinition) : definitions;
}
