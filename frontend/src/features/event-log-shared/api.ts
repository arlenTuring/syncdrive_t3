import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';
import { ApiError } from '../media-groups/api';

export { ApiError };

/** 事件與日誌共用的 API 呼叫：集中處理錯誤格式、Abort 與 CSV 下載。CSRF 由 AuthContext 的全域 fetch 帶上。 */
export const apiBase = () => `${resolveBrowserApiBaseUrl()}/syncdrive-api`;

export async function getJson<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const response = await fetch(`${apiBase()}${path}${query.size ? `?${query}` : ''}`, { headers: { Accept: 'application/json' }, signal });
  return parse<T>(response);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return parse<T>(response);
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('、') : typeof body.message === 'string' ? body.message : body.message?.message;
    throw new ApiError(response.status === 403 ? '權限不足' : response.status === 401 ? '請先登入' : message || `HTTP ${response.status}`, response.status);
  }
  return body as T;
}

export type CsvResult = { total: number; exported: number; fileName: string };

/** 下載 CSV：以 Blob 存檔，回傳總數與實際匯出筆數（超過上限時畫面提示截斷） */
export async function downloadCsv(path: string, params: Record<string, string | number | boolean | undefined | null>, signal?: AbortSignal): Promise<CsvResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const response = await fetch(`${apiBase()}${path}?${query}`, { signal });
  if (!response.ok) await parse(response);
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.csv';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { total: Number(response.headers.get('X-Total-Count') ?? 0), exported: Number(response.headers.get('X-Exported-Count') ?? 0), fileName };
}
