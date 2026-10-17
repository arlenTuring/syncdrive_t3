import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

export type MediaType = 'audio' | 'text' | 'image' | 'video';
export type MediaItem = {
  id: string; name: string; media_type: MediaType | null; description: string;
  text_content?: string; file_status: 'ready' | 'missing'; created_at: string; updated_at: string;
  file: null | { original_name: string; mime_type: string; size_bytes: number; duration_seconds?: number; width?: number; height?: number; content_url: string };
};
export type MediaList = { items: MediaItem[]; total: number; page: number; page_size: number };
export type DeleteImpact = { id: string; name: string; updated_at: string; groups: { id: string; name: string }[]; schedules: { id: string; name: string }[]; allowed: boolean };
const base = () => `${resolveBrowserApiBaseUrl()}/syncdrive-api/media-library`;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join('、') : body.message || `HTTP ${response.status}`);
  return body as T;
}
export function listMedia(query: { keyword: string; page: number; sortBy: string; direction: string }) {
  const params = new URLSearchParams({ kind: 'media', keyword: query.keyword, page: String(query.page), page_size: '10', sort_by: query.sortBy, sort_direction: query.direction });
  return json<MediaList>(`${base()}/list?${params}`);
}
export function getMedia(id: string) { return json<MediaItem>(`${base()}/${encodeURIComponent(id)}`); }
export function getDeleteImpact(id: string) { return json<DeleteImpact>(`${base()}/${encodeURIComponent(id)}/delete-impact`); }
export function deleteMedia(id: string, updatedAt: string) { return json<{ deleted: boolean; affected_groups: string[]; file_cleanup_pending: boolean }>(`${base()}/${encodeURIComponent(id)}?expected_updated_at=${encodeURIComponent(updatedAt)}`, { method: 'DELETE' }); }
export function mediaContentUrl(item: MediaItem) { return `${resolveBrowserApiBaseUrl()}${item.file?.content_url ?? ''}`; }

export function saveMedia(args: { id?: string; name: string; description: string; mediaType: MediaType; textContent: string; file: File | null; expectedUpdatedAt?: string; onProgress: (value: number) => void }) {
  return new Promise<MediaItem>((resolve, reject) => {
    const form = new FormData();
    form.set('name', args.name); form.set('description', args.description); form.set('mediaType', args.mediaType);
    if (args.mediaType === 'text') form.set('textContent', args.textContent);
    if (args.expectedUpdatedAt) form.set('expectedUpdatedAt', args.expectedUpdatedAt);
    if (args.file) form.set('file', args.file);
    const xhr = new XMLHttpRequest();
    xhr.open(args.id ? 'PATCH' : 'POST', args.id ? `${base()}/${encodeURIComponent(args.id)}` : base());
    xhr.withCredentials = true;
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('syncdrive_csrf='))?.split('=').slice(1).join('=');
    if (csrf) xhr.setRequestHeader('x-csrf-token', decodeURIComponent(csrf));
    xhr.upload.onprogress = (event) => event.lengthComputable && args.onProgress(Math.round(event.loaded / event.total * 100));
    xhr.onerror = () => reject(new Error('網路失敗，請稍後重試'));
    xhr.onload = () => {
      const body = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300) { args.onProgress(100); window.dispatchEvent(new Event('media-library:changed')); resolve(body); }
      else reject(new Error(Array.isArray(body.message) ? body.message.join('、') : body.message || `上傳失敗（${xhr.status}）`));
    };
    xhr.send(form);
  });
}
