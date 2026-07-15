import { getDataSourceById } from '../../dashboard/store/useDataSourceStore';
import type { PublishStatusKey, TimeTemplateListItem } from '../types';

export function resolveTimeTemplatesBackendUrl(): string {
  return getDataSourceById('default-internal')?.backendUrl ?? 'http://127.0.0.1:3000';
}

export type TimeTemplateListQuery = {
  keyword?: string;
  publish_status?: PublishStatusKey | 'all';
  page?: number;
  page_size?: number;
};

export type TimeTemplateListResponse = {
  items: TimeTemplateListItem[];
  total: number;
  page: number;
  page_size: number;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

export async function fetchTimeTemplateList(
  query: TimeTemplateListQuery,
  backendUrl = resolveTimeTemplatesBackendUrl(),
): Promise<TimeTemplateListResponse> {
  const qs = buildQuery({
    keyword: query.keyword,
    publish_status: query.publish_status ?? 'all',
    page: query.page ?? 1,
    page_size: query.page_size ?? 20,
  });
  const res = await fetch(`${backendUrl}/syncdrive-api/time-template/list?${qs}`);
  if (!res.ok) {
    throw new Error(`載入時間模板列表失敗（${res.status}）`);
  }
  return res.json() as Promise<TimeTemplateListResponse>;
}

export type TimeTemplateDetail = {
  template_id: string;
  name: string;
  publish_status: PublishStatusKey;
  usage_status: string;
  body: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function fetchTimeTemplateDetail(
  templateId: string,
  backendUrl = resolveTimeTemplatesBackendUrl(),
): Promise<TimeTemplateDetail> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/time-template/detail/${encodeURIComponent(templateId)}`,
  );
  if (!res.ok) {
    throw new Error(`載入時間模板詳情失敗（${res.status}）`);
  }
  return res.json() as Promise<TimeTemplateDetail>;
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

export async function createTimeTemplateDraft(
  payload: { name: string; body: Record<string, unknown> },
  backendUrl = resolveTimeTemplatesBackendUrl(),
): Promise<TimeTemplateListItem> {
  const res = await fetch(`${backendUrl}/syncdrive-api/time-template/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, '儲存時間模板草稿失敗'));
  }
  return res.json() as Promise<TimeTemplateListItem>;
}

export async function updateTimeTemplateDraft(
  templateId: string,
  payload: { name: string; body: Record<string, unknown> },
  backendUrl = resolveTimeTemplatesBackendUrl(),
): Promise<TimeTemplateListItem> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/time-template/detail/${encodeURIComponent(templateId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '更新時間模板失敗'));
  }
  return res.json() as Promise<TimeTemplateListItem>;
}

export async function deleteTimeTemplate(
  templateId: string,
  backendUrl = resolveTimeTemplatesBackendUrl(),
): Promise<void> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/time-template/detail/${encodeURIComponent(templateId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, '刪除時間模板失敗'));
  }
}

export async function exportTimeTemplates(
  ids: string[],
  backendUrl = resolveTimeTemplatesBackendUrl(),
): Promise<unknown[]> {
  const res = await fetch(`${backendUrl}/syncdrive-api/time-template/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    throw new Error(`匯出時間模板失敗（${res.status}）`);
  }
  return res.json() as Promise<unknown[]>;
}

export function downloadTimeTemplatesJson(data: unknown[], filename = 'time-templates.json'): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
