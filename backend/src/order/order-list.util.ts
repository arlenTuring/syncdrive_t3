import { OperationOrder, OrderStatus } from '../database/entities/operation-order.entity';

export type ShiftTab = 'mainline' | 'maintenance';

export type ExecutionStatusKey =
  | 'pending'
  | 'running'
  | 'delayed'
  | 'faulted'
  | 'completed';

export type ShiftRecordListItem = {
  order_id: string;
  trip_code: string;
  vehicle_code: string;
  line_kind: string | null;
  order_status: OrderStatus;
  execution_status: ExecutionStatusKey;
  execution_status_label: string;
  route_label: string;
  depart_time: string | null;
  end_time: string | null;
  delay_minutes: number;
  planned_start: string | null;
  planned_end: string | null;
  completed_at: string | null;
  payload: Record<string, unknown> | null;
};

const SHIFT_TRIP_PATTERN = /^[DU]\d{4}$/i;

export function resolveExecutionStatus(order: OperationOrder): {
  key: ExecutionStatusKey;
  label: string;
} {
  if (order.status === OrderStatus.END) {
    return { key: 'completed', label: '已完成' };
  }
  if (order.status === OrderStatus.FAULTED) {
    return { key: 'faulted', label: '故障' };
  }
  if (order.status === OrderStatus.PENDING) {
    return { key: 'pending', label: '待發' };
  }
  if (order.status === OrderStatus.PROCESSING) {
    const delay = Number(order.delayMinutes ?? 0);
    if (delay > 0) {
      return { key: 'delayed', label: '延誤中' };
    }
    return { key: 'running', label: '執行中' };
  }
  return { key: 'pending', label: '待發' };
}

export function mainlineRouteLabel(tripCode: string): string {
  const code = tripCode.trim().toUpperCase();
  if (code.startsWith('U')) return 'S2W→T3→N2W';
  if (code.startsWith('D')) return 'N2W→T3→S2W';
  return '—';
}

export function buildRouteLabel(order: OperationOrder): string {
  const lineKind = String(order.lineKind ?? '').toUpperCase();
  if (lineKind === 'MAINTENANCE') {
    const payload = order.payload ?? {};
    const slot =
      String(payload.yard_slot_id ?? '').trim()
      || String(order.nextStation ?? '').trim()
      || String(order.maintStation ?? '').trim()
      || '—';
    return `S2W→${slot}`;
  }
  if (SHIFT_TRIP_PATTERN.test(order.tripCode ?? '')) {
    return mainlineRouteLabel(order.tripCode);
  }
  return '—';
}

function tripScheduleTimes(tripCode: string): { startMs: number; endMs: number } | null {
  const m = SHIFT_TRIP_PATTERN.exec(tripCode.trim());
  if (!m) return null;
  const hour = parseInt(tripCode.slice(1, 3), 10);
  const minute = parseInt(tripCode.slice(3, 5), 10);
  if (hour > 23 || minute > 59) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(hour, minute, 0, 0);
  const legMs = 6 * 60_000;
  return { startMs: start.getTime(), endMs: start.getTime() + legMs };
}

export function formatHmsFromMs(ms: string | number | null | undefined): string | null {
  if (ms == null || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function resolveDepartTime(order: OperationOrder): string | null {
  const fromPlanned = formatHmsFromMs(order.plannedStart);
  if (fromPlanned) return fromPlanned;
  const schedule = tripScheduleTimes(order.tripCode ?? '');
  if (!schedule) return null;
  return formatHmsFromMs(schedule.startMs);
}

export function resolveEndTime(order: OperationOrder): string | null {
  if (order.status !== OrderStatus.END) return null;
  const fromPlanned = formatHmsFromMs(order.plannedEnd);
  if (fromPlanned) return fromPlanned;
  const schedule = tripScheduleTimes(order.tripCode ?? '');
  if (schedule) return formatHmsFromMs(schedule.endMs);
  if (order.plannedStart) {
    return formatHmsFromMs(Number(order.plannedStart) + 6 * 60_000);
  }
  return null;
}

export function toShiftRecordListItem(order: OperationOrder): ShiftRecordListItem {
  const exec = resolveExecutionStatus(order);
  return {
    order_id: order.id,
    trip_code: order.tripCode,
    vehicle_code: order.vehicleCode,
    line_kind: order.lineKind ?? null,
    order_status: order.status,
    execution_status: exec.key,
    execution_status_label: exec.label,
    route_label: buildRouteLabel(order),
    depart_time: resolveDepartTime(order),
    end_time: resolveEndTime(order),
    delay_minutes: Number(order.delayMinutes ?? 0),
    planned_start: order.plannedStart ?? null,
    planned_end: order.plannedEnd ?? null,
    completed_at: order.completedAt ?? null,
    payload: (order.payload as Record<string, unknown> | null) ?? null,
  };
}

export function matchesTab(order: OperationOrder, tab: ShiftTab): boolean {
  const lineKind = String(order.lineKind ?? '').toUpperCase();
  if (tab === 'maintenance') {
    return lineKind === 'MAINTENANCE';
  }
  if (lineKind === 'MAINTENANCE') return false;
  if (lineKind === 'MAINLINE') return true;
  return SHIFT_TRIP_PATTERN.test(order.tripCode ?? '');
}
