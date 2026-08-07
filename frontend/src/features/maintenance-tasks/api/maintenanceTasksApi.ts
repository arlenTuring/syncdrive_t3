import { getDataSourceById } from '../../dashboard/store/useDataSourceStore';
import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase';
import type { MaintenanceTaskListItem, PublishStatusKey, UsageStatusKey } from '../types';

export function resolveMaintenanceTasksBackendUrl(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl);
}

export type MaintenanceTaskListQuery = {
  keyword?: string;
  usage_status?: UsageStatusKey | 'all';
  publish_status?: PublishStatusKey | 'all';
  page?: number;
  page_size?: number;
};

export type MaintenanceTaskListResponse = {
  items: MaintenanceTaskListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type MaintenanceTaskDetail = {
  task_id: string;
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

export async function fetchMaintenanceTaskList(
  query: MaintenanceTaskListQuery,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<MaintenanceTaskListResponse> {
  const qs = buildQuery({
    keyword: query.keyword,
    usage_status: query.usage_status ?? 'all',
    publish_status: query.publish_status ?? 'all',
    page: query.page ?? 1,
    page_size: query.page_size ?? 20,
  });
  const res = await fetch(`${backendUrl}/syncdrive-api/maintenance-task/list?${qs}`);
  if (!res.ok) {
    throw new Error(`載入整備任務列表失敗（${res.status}）`);
  }
  return res.json() as Promise<MaintenanceTaskListResponse>;
}

export async function fetchMaintenanceTaskDetail(
  taskId: string,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<MaintenanceTaskDetail> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/maintenance-task/detail/${encodeURIComponent(taskId)}`,
  );
  if (!res.ok) {
    throw new Error(`載入整備任務詳情失敗（${res.status}）`);
  }
  return res.json() as Promise<MaintenanceTaskDetail>;
}

export async function createMaintenanceTaskDraft(
  payload: { name: string; body: Record<string, unknown> },
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<MaintenanceTaskListItem> {
  const res = await fetch(`${backendUrl}/syncdrive-api/maintenance-task/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, '儲存整備任務草稿失敗'));
  }
  return res.json() as Promise<MaintenanceTaskListItem>;
}

export async function updateMaintenanceTaskDraft(
  taskId: string,
  payload: { name: string; body: Record<string, unknown> },
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<MaintenanceTaskListItem> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/maintenance-task/detail/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '更新整備任務草稿失敗'));
  }
  return res.json() as Promise<MaintenanceTaskListItem>;
}

export async function deleteMaintenanceTask(
  taskId: string,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<void> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/maintenance-task/detail/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '刪除整備任務失敗'));
  }
}

export async function checkMaintenanceTaskNameUnique(
  name: string,
  excludeTaskId?: string,
  backendUrl = resolveMaintenanceTasksBackendUrl(),
): Promise<boolean> {
  const qs = buildQuery({ name, exclude_id: excludeTaskId });
  const res = await fetch(`${backendUrl}/syncdrive-api/maintenance-task/check-name?${qs}`);
  if (!res.ok) {
    throw new Error(`檢查名稱唯一性失敗（${res.status}）`);
  }
  const payload = (await res.json()) as { unique?: boolean };
  return Boolean(payload.unique);
}
