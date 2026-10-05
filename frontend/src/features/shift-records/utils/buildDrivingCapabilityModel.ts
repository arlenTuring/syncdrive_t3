import type { ShiftRecordAction, ShiftRecordDetail } from '../api/shiftRecordsApi';
import {
  catalogVisualForActionType,
  catalogVisualForCode,
} from './mapProtocolActionToCatalog';

export type TaskLaneFilter = 'all' | 'action' | 'event';

export type TimelineEventKind =
  | 'enter'
  | 'exit'
  | 'music'
  | 'door_open'
  | 'door_close'
  | 'signal'
  | 'alert'
  | 'dispatch'
  | 'charging'
  | 'wash'
  | 'maintenance'
  | 'repair'
  | 'parking'
  | 'generic';

export type TimelineEvent = {
  id: string;
  channel: 'action' | 'event';
  kind: TimelineEventKind;
  atMs: number;
  label: string;
  station?: string;
  iconUrl?: string | null;
  actionType?: string;
  actionStatus?: string;
  accelerated?: boolean;
  delayLabel?: string;
  description?: string;
};

export type StatusSegment = {
  id: string;
  fromMs: number;
  toMs: number;
  label: string;
  tone: 'green' | 'blue' | 'red';
};

export type DrivingCapabilityModel = {
  tripCode: string;
  routeEndpoints: string;
  directionLabel: string;
  timeRangeLabel: string;
  durationMinutes: number;
  plannedDurationHms: string;
  actualDurationHms: string;
  punctuality: '準時' | '延誤' | '進行中' | '—';
  rangeStartMs: number;
  rangeEndMs: number;
  statusSegments: StatusSegment[];
  events: TimelineEvent[];
};

const EVENT_KINDS = new Set<TimelineEventKind>(['alert']);
const KIND_SET = new Set<TimelineEventKind>([
  'enter',
  'exit',
  'music',
  'door_open',
  'door_close',
  'signal',
  'alert',
  'dispatch',
  'charging',
  'wash',
  'maintenance',
  'repair',
  'parking',
]);

function formatHms(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDurationHms(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function parseEpoch(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // unix 秒（約 1e9）誤當毫秒會變成 1970，時軸會被拉成數十年
  if (n < 1e11) return Math.round(n * 1000);
  return Math.round(n);
}

function actionAtMs(action: ShiftRecordAction): number | null {
  return parseEpoch(action.actual_start_time) ?? parseEpoch(action.actual_end_time);
}

/** 與實際動作差超過此時距的計劃／完成時間視為跨日殘值，不納入總時長 */
const RANGE_ANCHOR_WINDOW_MS = 3 * 60 * 60_000;
const DEFAULT_LEG_MS = 6 * 60_000;
const RANGE_PAD_MS = 20_000;

function isNearTrip(candidate: number, anchorMin: number, anchorMax: number): boolean {
  return (
    candidate >= anchorMin - RANGE_ANCHOR_WINDOW_MS
    && candidate <= anchorMax + RANGE_ANCHOR_WINDOW_MS
  );
}

function alignClockOnDay(sourceMs: number, dayAnchorMs: number): number {
  const src = new Date(sourceMs);
  const aligned = new Date(dayAnchorMs);
  aligned.setHours(
    src.getHours(),
    src.getMinutes(),
    src.getSeconds(),
    src.getMilliseconds(),
  );
  return aligned.getTime();
}

function resolveRangeMs(
  detail: ShiftRecordDetail,
  actionTimes: number[],
): { startMs: number; endMs: number; durationMs: number } {
  const plannedStartRaw = parseEpoch(detail.planned_start);
  const plannedEndRaw =
    parseEpoch(detail.planned_end) ?? parseEpoch(detail.payload?.planned_end);
  const completed = parseEpoch(detail.completed_at);

  let startMs: number;
  let endMs: number;

  if (actionTimes.length > 0) {
    const minT = Math.min(...actionTimes);
    const maxT = Math.max(...actionTimes);
    const plannedStart =
      plannedStartRaw != null ? alignClockOnDay(plannedStartRaw, minT) : null;
    const plannedEnd =
      plannedEndRaw != null ? alignClockOnDay(plannedEndRaw, minT) : null;
    const plannedSpanOk =
      plannedStart != null
      && plannedEnd != null
      && plannedEnd > plannedStart
      && plannedEnd - plannedStart <= 90 * 60_000;

    if (plannedSpanOk) {
      startMs = Math.min(plannedStart, minT);
      endMs = Math.max(plannedEnd, maxT);
    } else {
      startMs = minT;
      endMs = Math.max(maxT, minT + 1_000);
    }
    if (completed != null && isNearTrip(completed, startMs, endMs)) {
      endMs = Math.max(endMs, completed);
    }
  } else {
    // 沒有計畫時刻的舊單用現在當畫面範圍起點，不從班次代號推發車時刻
    startMs = plannedStartRaw ?? Date.now();
    endMs =
      (plannedEndRaw != null && plannedEndRaw > startMs ? plannedEndRaw : null)
      ?? startMs + DEFAULT_LEG_MS;
  }

  if (endMs <= startMs) endMs = startMs + DEFAULT_LEG_MS;
  const durationMs = endMs - startMs;
  return {
    startMs: startMs - RANGE_PAD_MS,
    endMs: endMs + RANGE_PAD_MS,
    durationMs,
  };
}

function routeParts(routeLabel: string): string[] {
  return routeLabel.split('→').map((s) => s.trim()).filter(Boolean);
}

/** 起訖站只看訂單的路線（route_label），不看班次代號開頭 */
function routeEndpoints(routeLabel: string): string {
  const parts = routeParts(routeLabel);
  if (parts.length >= 2) {
    return `${parts[0]}站 ➔ ${parts[parts.length - 1]}站`;
  }
  return routeLabel || '—';
}

/** 上下行看路線起訖（S2W→N2W 上行、N2W→S2W 下行）；看不出來就只寫「路線」 */
function directionLabel(routeLabel: string): string {
  const parts = routeParts(routeLabel);
  const from = parts[0]?.replace(/(上行|下行).*$/, '');
  const to = parts[parts.length - 1]?.replace(/(上行|下行).*$/, '');
  if (from === 'S2W' && to === 'N2W') return '上行路線';
  if (from === 'N2W' && to === 'S2W') return '下行路線';
  return '路線';
}

function asKind(code: string | null): TimelineEventKind {
  if (code && KIND_SET.has(code as TimelineEventKind)) return code as TimelineEventKind;
  return 'generic';
}

function actionChannel(
  kind: TimelineEventKind,
  status: string,
): 'action' | 'event' {
  if (EVENT_KINDS.has(kind)) return 'event';
  if (status === 'FAILED' || status.includes('ALARM')) return 'event';
  return 'action';
}

function stationLabel(action: ShiftRecordAction): string | undefined {
  const named = String(action.station_display_name ?? '').trim();
  if (named) return named;
  const id = String(action.station_id ?? '');
  if (id.includes('N2W') || id === 'station_1' || id === 'station_2') return 'N2W';
  if (id.includes('S2W') || id === 'station_5' || id === 'station_6') return 'S2W';
  if (id.includes('T3') || id === 'station_3' || id === 'station_4') return 'T3';
  return undefined;
}

function eventLabel(
  action: ShiftRecordAction,
  visualLabel: string,
  kind: TimelineEventKind,
  _station?: string,
): string {
  const protocol = String(action.action_type ?? '').toUpperCase();
  if (protocol === 'EMERGENCY_BRAKE') return '緊急剎車';
  if (kind === 'enter') return '進站';
  if (kind === 'exit') return '出站';
  if (kind === 'music') return '播放音樂';
  if (kind === 'door_open') return '車門開啟';
  if (kind === 'door_close') return '車門關閉';
  if (kind === 'signal') return '判斷號誌';
  if (kind === 'alert') return visualLabel === '告警' ? '告警' : visualLabel;
  if (kind === 'dispatch') return '發車';
  return visualLabel || action.action_type;
}

function stationBarLabel(station: string): string {
  const name = station.trim();
  if (!name) return '站點';
  return name.endsWith('站') ? name : `${name}站`;
}

function buildStatusSegments(
  events: TimelineEvent[],
  startMs: number,
  endMs: number,
): StatusSegment[] {
  const main = events
    .filter((e) => e.channel === 'action')
    .sort((a, b) => a.atMs - b.atMs);

  if (main.length === 0) {
    return [
      {
        id: 'travel-all',
        fromMs: startMs,
        toMs: endMs,
        label: '行駛中',
        tone: 'green',
      },
    ];
  }

  const segments: StatusSegment[] = [];
  let cursor = startMs;
  let dockCount = 0;

  for (const ev of main) {
    if (ev.atMs <= cursor) continue;

    if (ev.kind === 'enter') {
      if (ev.atMs > cursor) {
        segments.push({
          id: `travel-${segments.length}`,
          fromMs: cursor,
          toMs: ev.atMs,
          label: '行駛中',
          tone: 'green',
        });
      }
      const station = stationBarLabel(ev.station ?? '站點');
      const dwellEnd = Math.min(endMs, ev.atMs + 60_000);
      segments.push({
        id: `dock-${dockCount}`,
        fromMs: ev.atMs,
        toMs: dwellEnd,
        label: station,
        tone: 'blue',
      });
      cursor = dwellEnd;
      dockCount += 1;
      continue;
    }

    if (ev.kind === 'exit' && ev.atMs > cursor) {
      segments.push({
        id: `travel-${segments.length}`,
        fromMs: cursor,
        toMs: ev.atMs,
        label: '行駛中',
        tone: 'green',
      });
      cursor = ev.atMs;
    }
  }

  if (cursor < endMs) {
    segments.push({
      id: `travel-tail`,
      fromMs: cursor,
      toMs: endMs,
      label: '行駛中',
      tone: 'green',
    });
  }

  return segments.length > 0
    ? segments
    : [{ id: 'travel-all', fromMs: startMs, toMs: endMs, label: '行駛中', tone: 'green' }];
}

function punctualityLabel(detail: ShiftRecordDetail): DrivingCapabilityModel['punctuality'] {
  if (detail.execution_status === 'running' || detail.execution_status === 'pending') {
    return '進行中';
  }
  if (detail.delay_minutes > 0) return '延誤';
  if (detail.execution_status === 'completed') return '準時';
  return '—';
}

function toTimelineEvent(
  action: ShiftRecordAction,
  delayLabel?: string,
): TimelineEvent | null {
  const atMs = actionAtMs(action);
  if (atMs == null) return null;

  const visual = catalogVisualForActionType(action.action_type);
  const kind = asKind(visual?.code ?? null);
  if (kind === 'generic') return null;
  const station = stationLabel(action);
  const status = String(action.action_status ?? '').toUpperCase();
  const channel = actionChannel(kind, status);
  return {
    id: action.action_id,
    channel,
    kind,
    atMs,
    label: eventLabel(action, visual?.label ?? action.action_type, kind, station),
    station,
    iconUrl: visual?.iconUrl ?? null,
    actionType: action.action_type,
    actionStatus: action.action_status,
    delayLabel: kind === 'signal' ? delayLabel : undefined,
    description: String(action.note ?? ''),
  };
}

function dedupeTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const kept: TimelineEvent[] = [];
  for (const event of events) {
    const prev = kept[kept.length - 1];
    if (
      prev
      && prev.channel === event.channel
      && prev.kind === event.kind
      && prev.station === event.station
      && Math.abs(event.atMs - prev.atMs) < 2500
    ) {
      continue;
    }
    kept.push(event);
  }
  return kept;
}

export function iconUrlForTimelineKind(kind: TimelineEventKind): string | null {
  return catalogVisualForCode(kind)?.iconUrl ?? null;
}

export function buildDrivingCapabilityModel(detail: ShiftRecordDetail): DrivingCapabilityModel {
  const timedActions = detail.actions
    .map((action) => ({ action, atMs: actionAtMs(action) }))
    .filter((row): row is { action: ShiftRecordAction; atMs: number } => row.atMs != null);

  const { startMs, endMs, durationMs } = resolveRangeMs(
    detail,
    timedActions.map((row) => row.atMs),
  );

  const delayLabel =
    detail.delay_minutes > 0 ? `延誤 +${detail.delay_minutes}分` : undefined;
  const events = dedupeTimelineEvents(
    timedActions
      .map((row) => toTimelineEvent(row.action, delayLabel))
      .filter((ev): ev is TimelineEvent => ev != null)
      .sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id)),
  );

  const statusSegments = buildStatusSegments(events, startMs, endMs);
  const punctuality = punctualityLabel(detail);
  const minutes = Math.max(1, Math.round(durationMs / 60_000));

  return {
    tripCode: detail.trip_code,
    routeEndpoints: routeEndpoints(detail.route_label),
    directionLabel: directionLabel(detail.route_label),
    timeRangeLabel: `${formatHms(startMs + RANGE_PAD_MS)} - ${formatHms(endMs - RANGE_PAD_MS)}`,
    durationMinutes: minutes,
    plannedDurationHms: formatDurationHms(durationMs),
    actualDurationHms: formatDurationHms(durationMs),
    punctuality,
    rangeStartMs: startMs,
    rangeEndMs: endMs,
    statusSegments,
    events,
  };
}

export function filterEventsByLane(
  events: TimelineEvent[],
  filter: TaskLaneFilter,
): TimelineEvent[] {
  if (filter === 'all') return events;
  if (filter === 'action') return events.filter((e) => e.channel === 'action');
  return events.filter((e) => e.channel === 'event');
}
