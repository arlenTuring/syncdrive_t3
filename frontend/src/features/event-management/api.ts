import { downloadCsv, getJson, postJson } from '../event-log-shared/api';

export type EventItem = {
  id: string;
  eventId: string;
  sourceType: 'VEHICLE' | 'FACILITY' | 'SYSTEM';
  sourceId: string | null;
  sourceName: string | null;
  origin: 'REPORTED' | 'CENTER';
  vehicleCode: string | null;
  eventCode: string;
  eventLabel: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  occurredAt: number;
  occurredAtValid: boolean | null;
  receivedAt: number | null;
  summary: string;
  acknowledged: boolean;
  acknowledgedAt: number | null;
  acknowledgedByName: string | null;
  acknowledgementNote: string | null;
  recoveryStatus: 'UNKNOWN';
};

export type EventDetail = EventItem & {
  location: unknown;
  params: unknown;
  detail: string | null;
  acknowledgementNote: string | null;
  trail: Array<{ id: string; action: string; operatorName: string | null; sourceIp: string | null; result: string; failureReason: string | null; note: string | null; at: number }>;
  alreadyAcknowledged?: boolean;
};

export type EventList = { items: EventItem[]; total: number; page: number; pageSize: number; snapshot: string; range: { from: number; to: number }; timeZone: string };

export type LiveBucket = 'pending' | 'confirmed';
/** 事件管理工作集合：待確認／已確認由後端分開查詢與排序。 */
export type LiveEvents = {
  items: EventItem[];
  total: number;
  pendingTotal: number;
  confirmedTotal: number;
  hasMore: boolean;
  nextCursor: string | null;
  version: string;
  serverTime: number;
  timeZone: string;
};

export type EventOptions = {
  vehicles: Array<{ vehicleCode: string; displayName: string; active: boolean }>;
  eventCodes: Array<{ value: string; label: string }>;
  severities: Array<{ value: string; label: string }>;
  sourceTypes: Array<{ value: string; label: string }>;
  timeZone: string;
  pageSize: number;
  exportLimit: number;
};

export type EventQuery = {
  from: number;
  to: number;
  vehicleCode?: string;
  eventCode?: string;
  severity?: string;
  sourceType?: string;
  sortBy: string;
  direction: 'asc' | 'desc';
};

export type Playback = {
  event: { id: string; eventCode: string; eventLabel: string; occurredAt: number; occurredAtValid: boolean | null; vehicleCode: string | null };
  window: { from: number; to: number; beforeMs: number; afterMs: number };
  vehicle: { id: string; vehicleCode: string; displayName: string; active: boolean } | null;
  trajectoryAvailable: boolean;
  timeZone: string;
  permissions: { trajectory: boolean; video: boolean };
};

export const fetchEventOptions = (signal?: AbortSignal) => getJson<EventOptions>('/events/options', undefined, signal);
export const fetchEvents = (query: EventQuery & { page: number; snapshot?: string }, signal?: AbortSignal) => getJson<EventList>('/events', query, signal);
export const fetchLiveEvents = (params: { bucket: LiveBucket; limit: number; after?: string }, signal?: AbortSignal) => getJson<LiveEvents>('/events/live', params, signal);
export const fetchEvent = (id: string, signal?: AbortSignal) => getJson<EventDetail>(`/events/${encodeURIComponent(id)}`, undefined, signal);
export const acknowledgeEvent = (id: string, note: string) => postJson<EventDetail>(`/events/${encodeURIComponent(id)}/acknowledgement`, { note });
export const fetchPlayback = (id: string, signal?: AbortSignal) => getJson<Playback>(`/events/${encodeURIComponent(id)}/playback`, undefined, signal);
export const exportEvents = (query: EventQuery) => downloadCsv('/events/export', query);
