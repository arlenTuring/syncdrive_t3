import { OperationOrder, OrderStatus } from '../database/entities/operation-order.entity';
import { orderBusinessKind } from './order-business-kind';

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

/**
 * 舊示範正線的路線（訂單記錄的 route_id）→ 路線顯示。看的是訂單上的路線，不是班次代號開頭。
 * 新訂單的路線名稱與站序在 payload.route_name／stations。
 */
const MAINLINE_ROUTE_LABELS: Readonly<Record<string, string>> = {
  'ROUTE-MAINLINE-UP': 'S2W→T3→N2W',
  'ROUTE-MAINLINE-DOWN': 'N2W→T3→S2W',
};

export function resolveExecutionStatus(order: OperationOrder): {
  key: ExecutionStatusKey;
  label: string;
} {
  if (order.status === OrderStatus.END) {
    return { key: 'completed', label: '已完成' };
  }
  if (order.status === OrderStatus.FAULTED) {
    // 中心端取消後車端照協議回報 FAULTED：是操作結束，不是車輛故障（篩選仍歸在 faulted）
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    if (payload.cancel_requested_at) return { key: 'faulted', label: '已中止（中心端取消）' };
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
  const routeName = String(order.payload?.route_name ?? '').trim();
  if (routeName) return routeName;
  const stations = Array.isArray(order.payload?.stations) ? order.payload.stations : [];
  const stationNames = stations
    .map((station: Record<string, unknown>) => String(station.station_name ?? station.station_id ?? '').trim())
    .filter(Boolean);
  if (stationNames.length > 1) return stationNames.join('→');
  return MAINLINE_ROUTE_LABELS[String(order.routeId ?? '')] ?? '—';
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

/** 計畫發車時刻只看訂單的 planned_start；沒有就是沒有，不從班次代號推 */
export function resolveDepartTime(order: OperationOrder): string | null {
  return formatHmsFromMs(order.plannedStart);
}

export function resolveEndTime(order: OperationOrder): string | null {
  if (order.status !== OrderStatus.END) return null;
  const fromPlanned = formatHmsFromMs(order.plannedEnd);
  if (fromPlanned) return fromPlanned;
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
  // 業務分類全系統同一套（見 order-business-kind.ts）；舊版模擬器的 TEST 單在這裡換算
  const lineKind = String(
    orderBusinessKind({ lineKind: order.lineKind, payload: order.payload as Record<string, unknown> | null })
      ?? order.lineKind ?? '',
  ).toUpperCase();
  if (tab === 'maintenance') {
    return lineKind === 'MAINTENANCE';
  }
  // 分類不明的單兩個分頁都不列（跟 listShiftRecords 的 SQL 一致），不拿班次代號猜
  return lineKind === 'MAINLINE' || lineKind === 'TRANSITION' || lineKind === 'TEST';
}
