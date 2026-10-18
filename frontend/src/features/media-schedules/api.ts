import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';
import { ApiError, type GroupList, type GroupMember } from '../media-groups/api';
import type { MediaType } from '../media-content/api';

/**
 * 媒體排程設定 API（後端 syncdrive-api/media-play-schedules）。只有預約播放與定時播放兩種模式。
 * CSRF 由 AuthContext 的全域 fetch 帶上。
 */
export type ScheduleMode = 'reserved' | 'timed';
/** '1'（週一）…'7'（週日）→ ['08:00', ...] */
export type Weekly = Record<string, string[]>;

export type ScheduleVehicle = { id: string; vehicle_code: string; display_name: string; active?: boolean };

export type MediaSchedule = {
  id: string;
  name: string;
  mode: ScheduleMode;
  time_zone: string;
  run_local: string | null;
  run_at: number | null;
  start_date: string | null;
  end_date: string | null;
  weekly: Weekly | null;
  target_scope: 'all' | 'vehicles';
  vehicles: ScheduleVehicle[];
  source_group: { id: string; name: string; version: number; applied_at: number } | null;
  next_run_at: number | null;
  status: 'active' | 'completed' | 'deleted';
  version: number;
  item_count: number;
  summary: string;
  created_at: number;
  updated_at: number;
};

export type PlaylistItem = {
  id: string;
  name: string | null;
  media_type: MediaType | null;
  description: string;
  text_excerpt?: string | null;
  original_name?: string | null;
  available: boolean;
  unavailable_label: string | null;
  missing?: boolean;
};

export type ScheduleDetail = MediaSchedule & { items: PlaylistItem[] };
export type ScheduleList = { items: MediaSchedule[]; total: number; page: number; page_size: number };
export type SortKey = 'name' | 'next_run_at' | 'mode' | 'target' | 'created_at';

export type ScheduleResult = {
  id: string;
  scheduled_at: number;
  status: string;
  schedule_version: number;
  detail: { missed_count?: number; reason?: string; contract?: string; content?: Array<{ media_id: string; name?: string; valid: boolean; reason: string | null; sha256?: string | null }> };
  deliveries: Array<{ vehicle_id: string; vehicle_code: string; vehicle_name: string; status: string; reason: string }>;
};

export type MediaOptionList = {
  items: Array<Omit<GroupMember, 'missing'>>;
  total: number;
  page: number;
  page_size: number;
  limits: { playlist_max: number };
};

export type ScheduleInput = {
  name: string;
  mode: ScheduleMode;
  time_zone: string;
  run_local?: string;
  start_date?: string;
  end_date?: string | null;
  weekly?: Weekly;
  target_scope: 'all' | 'vehicles';
  vehicle_ids: string[];
  media_ids: string[];
  source_group: { id: string; version: number } | null;
  expected_version?: number;
};

export const SCHEDULE_NAME_MAX = 60;
export const SCHEDULES_PAGE_SIZE = 10;
export const MEDIA_OPTIONS_PAGE_SIZE = 6;
export const MEDIA_SCHEDULE_TAG = 'table:media_play_schedules';

const base = () => `${resolveBrowserApiBaseUrl()}/syncdrive-api/media-play-schedules`;

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

export function listSchedules(query: { keyword: string; page: number; sortBy: SortKey; direction: 'asc' | 'desc' }, signal?: AbortSignal) {
  const params = new URLSearchParams({ keyword: query.keyword, page: String(query.page), page_size: String(SCHEDULES_PAGE_SIZE), sort_by: query.sortBy, sort_direction: query.direction });
  return json<ScheduleList>(`${base()}?${params}`, { signal });
}

export function getSchedule(id: string) {
  return json<ScheduleDetail>(`${base()}/${encodeURIComponent(id)}`);
}

export function getScheduleSettings() {
  return json<{ time_zone: string }>(`${base()}/settings`);
}

export function getScheduleResults(id: string) {
  return json<{ items: ScheduleResult[] }>(`${base()}/${encodeURIComponent(id)}/results`);
}

export function listVehicleOptions() {
  return json<{ items: ScheduleVehicle[] }>(`${base()}/options/vehicles`);
}

export function listGroupOptions(query: { keyword: string; page: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ keyword: query.keyword, page: String(query.page) });
  return json<GroupList>(`${base()}/options/groups?${params}`, { signal });
}

export function listMediaOptions(query: { keyword: string; page: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ keyword: query.keyword, page: String(query.page), page_size: String(MEDIA_OPTIONS_PAGE_SIZE) });
  return json<MediaOptionList>(`${base()}/options/media?${params}`, { signal });
}

export function createSchedule(input: ScheduleInput) {
  return json<ScheduleDetail>(base(), { method: 'POST', body: JSON.stringify(input) });
}

export function updateSchedule(id: string, input: ScheduleInput) {
  return json<ScheduleDetail>(`${base()}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteSchedule(id: string, version: number) {
  return json<{ deleted: boolean }>(`${base()}/${encodeURIComponent(id)}?expected_version=${version}`, { method: 'DELETE' });
}
