import { getDataSourceById } from '../../dashboard/store/useDataSourceStore';
import type { OperationShiftListItem, PublishStatusKey, UsageStatusKey } from '../types';

export function resolveOperationShiftBackendUrl(): string {
  return getDataSourceById('default-internal')?.backendUrl ?? 'http://127.0.0.1:3000';
}

export type OperationShiftListQuery = {
  keyword?: string;
  usage_status?: UsageStatusKey | 'all';
  publish_status?: PublishStatusKey | 'all';
  page?: number;
  page_size?: number;
};

export type OperationShiftListResponse = {
  items: OperationShiftListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type OperationShiftDetail = {
  shift_id: string;
  name: string;
  publish_status: PublishStatusKey;
  usage_status: UsageStatusKey;
  body: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `${fallback}（${res.status}）`;
  try {
    const json = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(json.message)) return json.message.join('、');
    if (typeof json.message === 'string') return json.message;
  } catch {
    // not json
  }
  return text;
}

export async function fetchOperationShiftList(
  query: OperationShiftListQuery,
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<OperationShiftListResponse> {
  const qs = buildQuery({
    keyword: query.keyword,
    usage_status: query.usage_status ?? 'all',
    publish_status: query.publish_status ?? 'all',
    page: query.page ?? 1,
    page_size: query.page_size ?? 20,
  });
  const res = await fetch(`${backendUrl}/syncdrive-api/operation-shift/list?${qs}`);
  if (!res.ok) {
    throw new Error(`載入班表清單失敗（${res.status}）`);
  }
  return res.json() as Promise<OperationShiftListResponse>;
}

export async function fetchOperationShiftDetail(
  shiftId: string,
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<OperationShiftDetail> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/operation-shift/detail/${encodeURIComponent(shiftId)}`,
  );
  if (!res.ok) {
    throw new Error(`載入班表詳情失敗（${res.status}）`);
  }
  return res.json() as Promise<OperationShiftDetail>;
}

export async function createOperationShiftDraft(
  payload: { name: string; body: Record<string, unknown> },
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<OperationShiftListItem> {
  const res = await fetch(`${backendUrl}/syncdrive-api/operation-shift/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, '儲存班表草稿失敗'));
  }
  return res.json() as Promise<OperationShiftListItem>;
}

export async function updateOperationShiftDraft(
  shiftId: string,
  payload: { name: string; body: Record<string, unknown> },
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<OperationShiftListItem> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/operation-shift/detail/${encodeURIComponent(shiftId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '更新班表草稿失敗'));
  }
  return res.json() as Promise<OperationShiftListItem>;
}

export async function duplicateOperationShiftDraft(
  shiftId: string,
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<OperationShiftListItem> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/operation-shift/detail/${encodeURIComponent(shiftId)}/duplicate`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '複製班表失敗'));
  }
  return res.json() as Promise<OperationShiftListItem>;
}

/** 參數生成 → 複製成手動製作草稿（不修改來源） */
export async function duplicateOperationShiftAsManualDraft(
  shiftId: string,
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<OperationShiftListItem> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/operation-shift/detail/${encodeURIComponent(shiftId)}/duplicate-as-manual`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '複製成手動製作失敗'));
  }
  return res.json() as Promise<OperationShiftListItem>;
}

export async function deleteOperationShift(
  shiftId: string,
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<void> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/operation-shift/detail/${encodeURIComponent(shiftId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '刪除班表失敗'));
  }
}

export async function checkOperationShiftNameUnique(
  name: string,
  excludeShiftId?: string,
  backendUrl = resolveOperationShiftBackendUrl(),
): Promise<boolean> {
  const qs = buildQuery({ name, exclude_id: excludeShiftId });
  const res = await fetch(`${backendUrl}/syncdrive-api/operation-shift/check-name?${qs}`);
  if (!res.ok) {
    throw new Error(`檢查名稱唯一性失敗（${res.status}）`);
  }
  const payload = (await res.json()) as { unique?: boolean };
  return Boolean(payload.unique);
}
