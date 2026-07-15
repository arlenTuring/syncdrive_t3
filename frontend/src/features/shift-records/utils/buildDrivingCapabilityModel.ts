import type { ShiftRecordDetail } from '../api/shiftRecordsApi';

export type TaskLaneFilter = 'all' | 'main' | 'secondary';

export type TimelineEventKind =
  | 'depart'
  | 'door_open'
  | 'door_close'
  | 'dock'
  | 'broadcast'
  | 'interlock'
  | 'alarm'
  | 'generic';

export type TimelineEvent = {
  id: string;
  lane: 'main' | 'secondary';
  kind: TimelineEventKind;
  atMs: number;
  label: string;
  station?: string;
  accelerated?: boolean;
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

const MAINLINE_TRIP = /^[DU]\d{4}$/i;
const MAIN_TASK_NAMES = new Set([
  'STATION_DEPARTURE',
  'PLATFORM_DOCKING',
  'OPEN_DOORS',
  'CLOSE_DOORS',
  'ACQUIRE_INTERLOCK',
]);
const SECONDARY_TASK_NAMES = new Set(['PRE_DEPARTURE_BROADCAST']);

const TASK_LABELS: Record<string, string> = {
  STATION_DEPARTURE: '發車',
  PLATFORM_DOCKING: '進站停靠',
  OPEN_DOORS: '車門開啟',
  CLOSE_DOORS: '車門關閉',
  PRE_DEPARTURE_BROADCAST: '播放音樂',
  ACQUIRE_INTERLOCK: '辨識號誌',
};

function parseTripScheduleMs(tripCode: string): number | null {
  const m = MAINLINE_TRIP.exec(tripCode.trim());
  if (!m) return null;
  const hour = parseInt(tripCode.slice(1, 3), 10);
  const minute = parseInt(tripCode.slice(3, 5), 10);
  if (hour > 23 || minute > 59) return null;
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

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

function resolveRangeMs(detail: ShiftRecordDetail): { startMs: number; endMs: number } {
  const plannedStart = detail.planned_start ? Number(detail.planned_start) : NaN;
  const scheduleStart = parseTripScheduleMs(detail.trip_code);
  const startMs = Number.isFinite(plannedStart)
    ? plannedStart
    : scheduleStart ?? Date.now();

  const plannedEnd = detail.payload?.planned_end
    ? Number(detail.payload.planned_end)
    : NaN;
  const defaultLegMs = 6 * 60_000;
  let endMs = Number.isFinite(plannedEnd)
    ? plannedEnd
    : startMs + defaultLegMs;

  if (detail.completed_at) {
    const completed = Number(detail.completed_at);
    if (Number.isFinite(completed) && completed > startMs) {
      endMs = Math.max(endMs, completed);
    }
  }

  if (endMs <= startMs) endMs = startMs + defaultLegMs;
  return { startMs, endMs };
}

function routeEndpoints(routeLabel: string, tripCode: string): string {
  const parts = routeLabel.split('→').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}站 ➔ ${parts[parts.length - 1]}站`;
  }
  const code = tripCode.trim().toUpperCase();
  if (code.startsWith('U')) return 'S2W站 ➔ N2W站';
  if (code.startsWith('D')) return 'N2W站 ➔ S2W站';
  return routeLabel || '—';
}

function directionLabel(tripCode: string): string {
  const code = tripCode.trim().toUpperCase();
  if (code.startsWith('U')) return '上行路線';
  if (code.startsWith('D')) return '下行路線';
  return '路線';
}

function taskLane(taskName: string): 'main' | 'secondary' {
  if (SECONDARY_TASK_NAMES.has(taskName)) return 'secondary';
  return 'main';
}

function taskKind(taskName: string): TimelineEventKind {
  switch (taskName) {
    case 'STATION_DEPARTURE':
      return 'depart';
    case 'OPEN_DOORS':
      return 'door_open';
    case 'CLOSE_DOORS':
      return 'door_close';
    case 'PLATFORM_DOCKING':
      return 'dock';
    case 'PRE_DEPARTURE_BROADCAST':
      return 'broadcast';
    case 'ACQUIRE_INTERLOCK':
      return 'interlock';
    default:
      return 'generic';
  }
}

function resolveTaskAtMs(
  task: Record<string, unknown>,
  index: number,
  total: number,
  startMs: number,
  endMs: number,
): number {
  const start = task.actual_start_time ?? task.actual_end_time;
  if (start != null && start !== '') {
    const n = Number(start);
    if (Number.isFinite(n)) return n;
  }
  const span = endMs - startMs;
  const ratio = total <= 1 ? 0.5 : index / (total - 1);
  return Math.round(startMs + span * ratio * 0.92 + span * 0.04);
}

function stationFromDockTask(
  task: Record<string, unknown>,
  routeLabel: string,
  dockIndex: number,
): string {
  const params = (task.task_params ?? {}) as Record<string, unknown>;
  const nodeId = String(params.node_id ?? '');
  if (nodeId.includes('N2W')) return 'N2W';
  if (nodeId.includes('S2W')) return 'S2W';
  if (nodeId.includes('T3')) return 'T3';
  const stops = routeLabel.split('→').map((s) => s.trim()).filter(Boolean);
  if (stops.length >= 2) {
    const mid = stops.slice(1, -1);
    if (mid[dockIndex]) return mid[dockIndex];
    return stops[Math.min(dockIndex + 1, stops.length - 1)];
  }
  return '站點';
}

function buildStatusSegments(
  events: TimelineEvent[],
  startMs: number,
  endMs: number,
): StatusSegment[] {
  const main = events
    .filter((e) => e.lane === 'main')
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

    if (ev.kind === 'dock') {
      if (ev.atMs > cursor) {
        segments.push({
          id: `travel-${segments.length}`,
          fromMs: cursor,
          toMs: ev.atMs,
          label: '行駛中',
          tone: 'green',
        });
      }
      const station = ev.station ?? '站點';
      const dwellEnd = Math.min(endMs, ev.atMs + 60_000);
      segments.push({
        id: `dock-${dockCount}`,
        fromMs: ev.atMs,
        toMs: dwellEnd,
        label: `${station}站 停靠中`,
        tone: 'blue',
      });
      cursor = dwellEnd;
      dockCount += 1;
      continue;
    }

    if (ev.kind === 'depart' && ev.atMs > cursor) {
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

export function buildDrivingCapabilityModel(detail: ShiftRecordDetail): DrivingCapabilityModel {
  const { startMs, endMs } = resolveRangeMs(detail);
  const durationMs = endMs - startMs;
  const tasks = [...detail.task_group].sort((a, b) => {
    const seqA = String(a.task_id ?? '').split('_').pop() ?? '';
    const seqB = String(b.task_id ?? '').split('_').pop() ?? '';
    return seqA.localeCompare(seqB);
  });

  let dockIdx = 0;
  const events: TimelineEvent[] = tasks
    .filter((task) => {
      const name = String(task.task_name ?? '');
      return MAIN_TASK_NAMES.has(name) || SECONDARY_TASK_NAMES.has(name);
    })
    .map((task, index, arr) => {
      const taskName = String(task.task_name ?? 'generic');
      const atMs = resolveTaskAtMs(task, index, arr.length, startMs, endMs);
      let label = TASK_LABELS[taskName] ?? taskName;
      if (taskName === 'PLATFORM_DOCKING') {
        const station = stationFromDockTask(task, detail.route_label, dockIdx);
        label = `${station}站 停靠`;
        dockIdx += 1;
        return {
          id: String(task.task_id ?? `${taskName}-${index}`),
          lane: taskLane(taskName),
          kind: taskKind(taskName),
          atMs,
          label,
          station,
          accelerated: detail.delay_minutes > 0 && taskLane(taskName) === 'main',
        };
      }
      if (taskName === 'STATION_DEPARTURE' && index === 0) {
        label = '發車';
      }
      return {
        id: String(task.task_id ?? `${taskName}-${index}`),
        lane: taskLane(taskName),
        kind: taskKind(taskName),
        atMs,
        label,
        accelerated: detail.delay_minutes > 0 && taskLane(taskName) === 'main',
      };
    });

  if (detail.execution_status === 'faulted') {
    events.push({
      id: 'fault-alarm',
      lane: 'main',
      kind: 'alarm',
      atMs: Math.round(startMs + durationMs * 0.7),
      label: '告警',
      accelerated: true,
    });
  }

  events.sort((a, b) => a.atMs - b.atMs);

  if (events.length === 0) {
    events.push(
      {
        id: 'fallback-depart',
        lane: 'main',
        kind: 'depart',
        atMs: startMs,
        label: '發車',
      },
      {
        id: 'fallback-broadcast',
        lane: 'secondary',
        kind: 'broadcast',
        atMs: startMs + 55_000,
        label: '播放音樂',
      },
      {
        id: 'fallback-door-open',
        lane: 'main',
        kind: 'door_open',
        atMs: startMs + 60_000,
        label: '車門開啟',
      },
      {
        id: 'fallback-door-close',
        lane: 'main',
        kind: 'door_close',
        atMs: startMs + 120_000,
        label: '車門關閉',
      },
    );
  }

  const statusSegments = buildStatusSegments(events, startMs, endMs);
  const punctuality = punctualityLabel(detail);

  return {
    tripCode: detail.trip_code,
    routeEndpoints: routeEndpoints(detail.route_label, detail.trip_code),
    directionLabel: directionLabel(detail.trip_code),
    timeRangeLabel: `${formatHms(startMs)} - ${formatHms(endMs)} | 總時長 ${Math.max(1, Math.round(durationMs / 60_000))} 分鐘`,
    durationMinutes: Math.max(1, Math.round(durationMs / 60_000)),
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
  if (filter === 'main') return events.filter((e) => e.lane === 'main');
  return events.filter((e) => e.lane === 'secondary');
}
