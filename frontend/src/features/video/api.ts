import { apiBase, ApiError, getJson } from '../event-log-shared/api';

/** 影像監控與歷史錄影 API（後端 /syncdrive-api/video）。帳密只寫不讀：回應只有 hasPassword 與遮蔽後網址。 */

export type Protocol = 'rtsp' | 'rtsps' | 'rtmp' | 'rtmps' | 'http' | 'https' | 'srt';
export type RecordingProfile = 'original' | 'balanced' | 'saving';

export type ActualStatus = {
  state?: 'online' | 'connecting' | 'idle' | 'error' | 'disabled' | 'media_unavailable';
  recording?: boolean;
  desiredRecording?: boolean;
  reason?: string | null;
  tracks?: string[];
  readers?: number;
  checkedAt?: number;
};

export type VideoSourceItem = {
  id: string;
  name: string;
  enabled: boolean;
  version: number;
  recordingProfile: RecordingProfile;
  revisionId: string | null;
  revisionNo: number | null;
  connection: { protocol: Protocol; host: string; port: number | null; path: string; query: string | null; username: string | null; hasPassword: boolean; maskedUrl: string } | null;
  vehicleCode: string | null;
  cameraId: string | null;
  location: string | null;
  timestampBasis: 'center' | 'source';
  usage: { tiles: number; recording: number };
  desiredRecording: boolean;
  actualStatus: ActualStatus;
  deleted?: boolean;
  usedBy?: Array<{ tab_id: string; tab_name: string; position: number; display_name: string | null; recording_requested: boolean }>;
};

export type Tile = { id: string; position: number; sourceId: string | null; displayName: string | null; recordingRequested: boolean; enabled: boolean; templateVars: Record<string, string>; version: number };
export type Tab = { id: string; name: string; position: number; tileCount: number; version: number; tiles: Tile[] };

export type Defaults = { protocol: Protocol; host: string | null; port: number | null; pathPrefix: string | null; pathTemplate: string | null; username: string | null; hasPassword: boolean; recordingDefault: boolean; version: number };
export type Settings = { allowedNetworks: string[]; maxTabs: number; maxSources: number; version: number };

export type StoragePolicy = {
  storageType: 'local' | 'gcs';
  retentionDays: number;
  maxBytes: number | null;
  minFreeBytes: number | null;
  localCacheMaxBytes: number | null;
  highWatermarkPct: number;
  lowWatermarkPct: number;
  gcsBucket: string | null;
  gcsPrefix: string | null;
  compression: { enabled: boolean; codec: 'av1' | 'hevc'; replaceOriginal: boolean; minSavingPct: number; minVmaf: number; maxConcurrency: number };
  autoBudgetBytes: number | null;
  version: number;
};

export type StorageStatus = {
  policy: StoragePolicy;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  budgetBytes: number;
  minFreeBytes: number;
  allowedBytes: number;
  usagePct: number;
  recordingSources: number;
  estimatedBytesPerDay: number | null;
  estimatedDays: number | null;
  earliestAvailableAt: number | null;
  paused: { reason: string } | null;
  measuredAt: number;
  /** GCS bucket 的保護政策（只在 GCS 模式） */
  gcs?: { ok: true; softDeleteDays: number; versioning: boolean; storageClass: string | null } | { ok: false; error: string } | null;
  remoteSegments?: number;
  compression?: { pending: number; kept: number; skipped: number; failed: number; savedBytes: number; avgVmaf: number | null } | null;
};

/** 伺服器實際偵測到的能力；畫面只開放偵測到的選項 */
export type Capabilities = {
  ffmpeg: boolean;
  encoders: { h264: string[]; hevc: string[]; av1: string[] };
  vmaf: boolean;
  hwaccels: string[];
  storage: { local: true; gcs: boolean };
  checkedAt: number;
};

export type Bootstrap = { tabs: Tab[]; sources: VideoSourceItem[]; defaults: Defaults; settings: Settings; storage: StorageStatus | null };

export type ConnectionInput = {
  mode: 'fields' | 'url';
  url?: string;
  protocol?: Protocol;
  host?: string;
  port?: number | string | null;
  path?: string;
  username?: string;
  password?: string;
  clearPassword?: boolean;
};

export type LiveSession = { sourceId: string; expiresAt: number; hlsUrl: string; whepUrl: string; status: ActualStatus };
export type SourceTest = { id: string | null; status: 'connecting' | 'ready' | 'failed'; error: string | null; tracks: string[]; maskedUrl: string; expiresAt?: number; hlsUrl: string | null; whepUrl: string | null };

export type ApplyItem = {
  tileId: string;
  tabId: string;
  tabName: string;
  position: number;
  displayName: string | null;
  action: 'skip' | 'create' | 'replace' | 'error';
  before: string | null;
  after: string | null;
  reason: string | null;
  sharedWith: { sourceId: string; name: string } | null;
};

export type TimelineItem = { kind: 'available' | 'gap' | 'expired' | 'failed' | 'recording'; from: number; to: number; protected?: boolean; reason?: string | null };
export type RevisionInfo = { revisionId: string; revisionNo: number; vehicleCode: string | null; cameraId: string | null; location: string | null; validFrom: number; validTo: number | null; timestampBasis: string; maskedUrl: string };
export type Availability = { from: number; to: number; sources: Array<{ sourceId: string; name: string; removed: boolean; timeline: TimelineItem[]; revisions: RevisionInfo[] }> };
export type Manifest = { sourceId: string; name: string; from: number; to: number; expiresAt: number; segments: Array<{ id: string; revisionId: string; start: number; end: number; codec: string | null; timestampBasis: string; url: string }>; timeline: TimelineItem[]; revisions: RevisionInfo[] };
export type Job = { id: string; kind: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'; progress: number; error: string | null; result: Record<string, unknown> | null; expiresAt: number | null; downloadUrl: string | null; note: string | null };

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}/video${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : Array.isArray(data.message) ? data.message.join('、') : data.message?.message;
    const error = new ApiError(response.status === 403 ? message === 'Forbidden resource' || !message ? '權限不足' : message : message || `HTTP ${response.status}`, response.status);
    (error as ApiError & { body?: unknown }).body = data;
    throw error;
  }
  return data as T;
}

const v = (path: string, params?: Record<string, string | number | boolean | undefined | null>, signal?: AbortSignal) => getJson<never>(`/video${path}`, params, signal);

export const videoApi = {
  bootstrap: (signal?: AbortSignal) => v('/bootstrap', undefined, signal) as Promise<Bootstrap>,
  createTab: (body: { name: string; tileCount: number }) => send<Tab>('POST', '/tabs', body),
  updateTab: (id: string, body: { name?: string; tileCount?: number; expectedVersion: number; confirm?: boolean }) => send<Tab>('PATCH', `/tabs/${id}`, body),
  deleteTab: (id: string, version: number) => send<{ deleted: boolean }>('DELETE', `/tabs/${id}?expectedVersion=${version}`),
  reorderTabs: (ids: string[]) => send<Tab[]>('POST', '/tabs/reorder', { ids }),
  duplicateTab: (id: string) => send<Tab>('POST', `/tabs/${id}/duplicate`),
  tileCountPreview: (id: string, tileCount: number) => v(`/tabs/${id}/tile-count-preview`, { tileCount }) as Promise<{ removedTiles: Array<{ tileId: string; position: number; displayName: string | null; sourceId: string | null }>; stoppingRecordings: Array<{ sourceId: string; name: string }> }>,
  saveTiles: (id: string, body: { expectedVersion: number; tiles: Array<Partial<Tile> & { position: number }> }) => send<Tab>('PUT', `/tabs/${id}/tiles`, body),
  sources: (includeDeleted = false) => v('/sources', { includeDeleted }) as Promise<VideoSourceItem[]>,
  source: (id: string) => v(`/sources/${id}`) as Promise<VideoSourceItem>,
  createSource: (body: Record<string, unknown>) => send<VideoSourceItem>('POST', '/sources', body),
  updateSource: (id: string, body: Record<string, unknown>) => send<VideoSourceItem>('PATCH', `/sources/${id}`, body),
  deleteSource: (id: string, version: number) => send<{ deleted: boolean }>('DELETE', `/sources/${id}?expectedVersion=${version}`),
  defaults: () => v('/defaults') as Promise<Defaults>,
  updateDefaults: (body: Record<string, unknown>) => send<Defaults>('PUT', '/defaults', body),
  previewApply: (body: Record<string, unknown>) => send<{ defaultsVersion: number; items: ApplyItem[] }>('POST', '/defaults/preview-apply', body),
  apply: (body: Record<string, unknown>) => send<{ applied: Array<{ tileId: string; sourceId: string; created: boolean }>; skipped: number }>('POST', '/defaults/apply', body),
  updateSettings: (body: { allowedNetworks: string[]; expectedVersion: number }) => send<Settings>('PUT', '/settings', body),
  createTest: (body: { connection?: ConnectionInput; sourceId?: string }) => send<SourceTest>('POST', '/source-tests', body),
  getTest: (id: string) => v(`/source-tests/${id}`) as Promise<SourceTest>,
  deleteTest: (id: string) => send<{ deleted: boolean }>('DELETE', `/source-tests/${id}`),
  liveSession: (sourceId: string) => send<LiveSession>('POST', `/sources/${sourceId}/live-sessions`),
  storageStatus: (signal?: AbortSignal) => v('/storage-status', undefined, signal) as Promise<StorageStatus>,
  capabilities: () => v('/capabilities') as Promise<Capabilities>,
  updateStoragePolicy: (body: Record<string, unknown>) => send<StorageStatus>('PUT', '/storage-policy', body),
  availability: (sourceIds: string[], from: number, to: number, signal?: AbortSignal) => v('/recordings/availability', { sourceIds: sourceIds.join(','), from, to }, signal) as Promise<Availability>,
  calendar: (sourceIds: string[], from: number, to: number, timeZone: string, signal?: AbortSignal) => v('/recordings/calendar', { sourceIds: sourceIds.join(','), from, to, timeZone }, signal) as Promise<{ days: string[] }>,
  playback: (body: { sourceIds: string[]; from: number; to: number }) => send<{ from: number; to: number; expiresAt: number; sessions: Array<{ sourceId: string; name: string; manifestUrl: string }> }>('POST', '/playback-sessions', body),
  manifest: async (url: string, signal?: AbortSignal): Promise<Manifest> => {
    const response = await fetch(url.startsWith('http') ? url : `${apiBase().replace(/\/syncdrive-api$/, '')}${url}`, { signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.message || `HTTP ${response.status}`, response.status);
    return data as Manifest;
  },
  createExport: (body: { sourceId: string; from: number; to: number }) => send<Job>('POST', '/exports', body),
  job: (id: string) => v(`/jobs/${id}`) as Promise<Job>,
  deletePreview: (body: { sourceIds: string[]; from: number; to: number }) => send<{ segments: number; bytes: number; protectedSegments: number; note: string }>('POST', '/recordings/delete-preview', body),
  deleteRecordings: (body: { sourceIds: string[]; from: number; to: number; confirm: true }) => send<Job>('POST', '/recordings/deletions', body),
  protect: (body: { sourceIds: string[]; from: number; to: number; until: number | null }) => send<{ updated: number }>('POST', '/recordings/protect', body),
};

/** 後端回的相對網址（/syncdrive-api/...）轉成瀏覽器可用的完整網址 */
export function mediaUrl(path: string) {
  return path.startsWith('http') ? path : `${apiBase().replace(/\/syncdrive-api$/, '')}${path}`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
