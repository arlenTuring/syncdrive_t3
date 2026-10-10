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
export type VehicleDefinitionRow = {
  definitionKey: string;
  name: string;
  vehicleModel?: string | null;
  width?: number | null;
  height?: number | null;
  backgroundColor?: string | null;
  elements?: unknown;
  previewData?: unknown;
  rearAxleFromTailRatio?: number | null;
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
export function vehicleDefinitionFromRow(row: VehicleDefinitionRow): VehicleDefinition {
  return {
    id: row.definitionKey,
    name: row.name,
    width: row.width ?? 0,
    height: row.height ?? 0,
    backgroundColor: row.backgroundColor ?? 'transparent',
    elements: Array.isArray(row.elements) ? (row.elements as VehicleDefinition['elements']) : [],
    previewData: (row.previewData as VehicleDefinition['previewData']) ?? undefined,
    ...(typeof row.rearAxleFromTailRatio === 'number'
      ? { rearAxleFromTailRatio: row.rearAxleFromTailRatio }
      : {}),
    createdAt: Number(row.createdAt) || Date.now(),
    updatedAt: Number(row.updatedAt) || Date.now(),
    ...(typeof row.version === 'number' ? { serverVersion: row.version } : {}),
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
    rearAxleFromTailRatio: definition.rearAxleFromTailRatio ?? null,
  };
}

/** 後端回 409：別人已經改過（current 是伺服器上的那一份），或仍被引用（references） */
export class VehicleDefinitionConflictError extends Error {
  readonly current: VehicleDefinition | null;
  readonly references: VehicleModelReference[] | null;

  constructor(
    message: string,
    current: VehicleDefinition | null,
    references: VehicleModelReference[] | null,
  ) {
    super(message);
    this.current = current;
    this.references = references;
  }
}

export type VehicleModelReference =
  | { kind: 'default' }
  | { kind: 'map'; mapId: string }
  | {
      kind: 'dashboard';
      planeId: string;
      planeName: string;
      elementId: string;
      childId: string | null;
      label: string | null;
    };

async function readError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string | string[] | { message?: string; current?: VehicleDefinitionRow | null; references?: VehicleModelReference[] };
    current?: VehicleDefinitionRow | null;
    references?: VehicleModelReference[];
  } | null;
  const detail = body && typeof body.message === 'object' && !Array.isArray(body.message) ? body.message : body;
  const message = Array.isArray(detail?.message)
    ? detail.message.join('、')
    : typeof detail?.message === 'string'
      ? detail.message
      : `HTTP ${res.status}`;
  if (res.status === 409) {
    const current = (detail as { current?: VehicleDefinitionRow | null })?.current;
    return new VehicleDefinitionConflictError(
      message,
      current ? vehicleDefinitionFromRow(current) : null,
      (detail as { references?: VehicleModelReference[] })?.references ?? null,
    );
  }
  return new Error(message);
}

export async function fetchVehicleDefinitions(
  backendUrl = resolveVehicleDefinitionsBackendUrl(),
): Promise<VehicleDefinition[]> {
  const res = await fetch(`${backendUrl}/${ENDPOINT}`);
  if (!res.ok) {
    throw new Error(`載具定義載入失敗（${res.status}）`);
  }
  const rows = (await res.json()) as VehicleDefinitionRow[];
  return Array.isArray(rows) ? rows.map(vehicleDefinitionFromRow) : [];
}

/**
 * 存一個模型。baseVersion＝這份是從伺服器第幾版改來的；新模型不帶。
 * 伺服器已經是別的版本（別人改過）或同 ID 已存在時丟 VehicleDefinitionConflictError，不覆蓋。
 */
export async function saveVehicleDefinition(
  definition: VehicleDefinition,
  baseVersion: number | null,
  backendUrl = resolveVehicleDefinitionsBackendUrl(),
): Promise<VehicleDefinition> {
  const res = await fetch(`${backendUrl}/${ENDPOINT}/${encodeURIComponent(definition.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: toRow(definition), baseVersion }),
  });
  if (!res.ok) throw await readError(res);
  return vehicleDefinitionFromRow((await res.json()) as VehicleDefinitionRow);
}

/** 刪除；仍被引用時丟 VehicleDefinitionConflictError（references 列出在哪裡） */
export async function deleteVehicleDefinition(
  definitionKey: string,
  backendUrl = resolveVehicleDefinitionsBackendUrl(),
): Promise<void> {
  const res = await fetch(`${backendUrl}/${ENDPOINT}/${encodeURIComponent(definitionKey)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await readError(res);
}

export async function fetchVehicleDefinitionReferences(
  definitionKey: string,
  backendUrl = resolveVehicleDefinitionsBackendUrl(),
): Promise<VehicleModelReference[]> {
  const res = await fetch(
    `${backendUrl}/${ENDPOINT}/${encodeURIComponent(definitionKey)}/references`,
  );
  if (!res.ok) throw await readError(res);
  return (await res.json()) as VehicleModelReference[];
}
