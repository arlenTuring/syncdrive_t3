import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';
import type { MediaType } from '../media-content/api';

/** 媒體分組清單 API（後端 syncdrive-api/media-groups）。CSRF 由 AuthContext 的全域 fetch 帶上 */
export type GroupMember = {
  id: string;
  name: string | null;
  media_type: MediaType | null;
  description: string;
  text_excerpt: string | null;
  original_name: string | null;
  available: boolean;
  unavailable_reason: string | null;
  unavailable_label: string | null;
  missing: boolean;
};

export type MediaGroup = {
  id: string;
  name: string;
  version: number;
  updated_at: string;
  member_count: number;
  members: GroupMember[];
  playable: boolean;
  unavailable_reason: 'empty' | 'missing_member' | 'member_unavailable' | null;
  unavailable_label: string | null;
};

export type GroupList = { items: MediaGroup[]; total: number; page: number; page_size: number };

export type Candidate = Omit<GroupMember, 'missing'> & { in_group: boolean };
export type CandidateList = {
  group: { id: string; version: number; member_count: number };
  items: Candidate[];
  total: number;
  page: number;
  page_size: number;
  limits: { member_max: number; add_max: number };
};

export type GroupDeleteImpact = {
  id: string;
  name: string;
  version: number;
  member_count: number;
  references: Array<{ kind: string; kind_label: string; id: string; name: string }>;
  allowed: boolean;
};

/** 後端回應的錯誤：帶狀態碼，畫面依 409（版本衝突）、403（權限）顯示不同提示 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const base = () => `${resolveBrowserApiBaseUrl()}/syncdrive-api/media-groups`;
export const GROUP_NAME_MAX = 60;
export const GROUPS_PAGE_SIZE = 10;
export const CANDIDATES_PAGE_SIZE = 6;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('、') : body.message;
    throw new ApiError(response.status === 403 ? '權限不足' : message || `HTTP ${response.status}`, response.status);
  }
  return body as T;
}

/** 其他頁面（媒體內容、班表選項）一起刷新 */
function notifyChanged() {
  window.dispatchEvent(new Event('media-library:changed'));
}

export function listGroups(query: { keyword: string; page: number; direction: 'asc' | 'desc' }, signal?: AbortSignal) {
  const params = new URLSearchParams({ keyword: query.keyword, page: String(query.page), page_size: String(GROUPS_PAGE_SIZE), sort_direction: query.direction });
  return json<GroupList>(`${base()}?${params}`, { signal });
}

export function getGroup(id: string) {
  return json<MediaGroup>(`${base()}/${encodeURIComponent(id)}`);
}

export function listCandidates(query: { groupId: string; keyword: string; page: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ group_id: query.groupId, keyword: query.keyword, page: String(query.page), page_size: String(CANDIDATES_PAGE_SIZE) });
  return json<CandidateList>(`${base()}/candidates?${params}`, { signal });
}

export async function createGroup(name: string) {
  const result = await json<MediaGroup>(base(), { method: 'POST', body: JSON.stringify({ name }) });
  notifyChanged();
  return result;
}

export async function renameGroup(id: string, name: string, version: number) {
  const result = await json<MediaGroup>(`${base()}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name, expected_version: version }) });
  notifyChanged();
  return result;
}

export async function addMembers(id: string, mediaIds: string[], version: number) {
  const result = await json<MediaGroup>(`${base()}/${encodeURIComponent(id)}/members`, { method: 'POST', body: JSON.stringify({ media_ids: mediaIds, expected_version: version }) });
  notifyChanged();
  return result;
}

export async function reorderMembers(id: string, mediaIds: string[], version: number) {
  const result = await json<MediaGroup>(`${base()}/${encodeURIComponent(id)}/members/order`, { method: 'PUT', body: JSON.stringify({ media_ids: mediaIds, expected_version: version }) });
  notifyChanged();
  return result;
}

export async function removeMember(id: string, mediaId: string, version: number) {
  const result = await json<MediaGroup>(`${base()}/${encodeURIComponent(id)}/members/${encodeURIComponent(mediaId)}?expected_version=${version}`, { method: 'DELETE' });
  notifyChanged();
  return result;
}

export function getGroupDeleteImpact(id: string) {
  return json<GroupDeleteImpact>(`${base()}/${encodeURIComponent(id)}/delete-impact`);
}

export async function deleteGroup(id: string, version: number) {
  const result = await json<{ deleted: boolean }>(`${base()}/${encodeURIComponent(id)}?expected_version=${version}`, { method: 'DELETE' });
  notifyChanged();
  return result;
}
