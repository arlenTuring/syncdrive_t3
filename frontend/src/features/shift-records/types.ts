export type ShiftTab = 'mainline' | 'maintenance';

export type ExecutionStatusKey =
  | 'pending'
  | 'running'
  | 'delayed'
  | 'fault_pending'
  | 'faulted'
  | 'cancelled'
  | 'completed';

export type ShiftRecordListItem = {
  order_id: string;
  trip_code: string;
  vehicle_code: string;
  line_kind: string | null;
  order_status: string;
  execution_status: ExecutionStatusKey;
  execution_status_label: string;
  route_label: string;
  depart_time: string | null;
  end_time: string | null;
  delay_minutes: number;
  planned_start: string | null;
  planned_end?: string | null;
  completed_at: string | null;
  payload: Record<string, unknown> | null;
};

export const EXECUTION_STATUS_OPTIONS: Array<{ value: ExecutionStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '全部狀態' },
  { value: 'pending', label: '待發' },
  { value: 'running', label: '執行中' },
  { value: 'delayed', label: '延誤中' },
  { value: 'fault_pending', label: '車輛故障（結案待確認）' },
  { value: 'faulted', label: '故障' },
  { value: 'cancelled', label: '已中止（中心端取消）' },
  { value: 'completed', label: '已完成' },
];

/**
 * 畫面上顯示的執行狀態。中心端取消後車端照協議回報 FAULTED 結案的單是「已中止」，
 * 不是車輛故障；後端已回 cancelled，舊回應（faulted＋cancel_requested_at）也照樣顯示成已中止。
 */
export type ExecutionDisplayKey = ExecutionStatusKey;

export function executionDisplayKey(row: {
  execution_status: ExecutionStatusKey;
  payload?: Record<string, unknown> | null;
}): ExecutionDisplayKey {
  return row.execution_status === 'faulted' && row.payload?.cancel_requested_at ? 'cancelled' : row.execution_status;
}

export type StatusTagStyle = {
  container: string;
  dot: string;
};

export const EXECUTION_TAG_STYLE: Record<ExecutionDisplayKey, StatusTagStyle> = {
  pending: {
    container: 'bg-[rgba(153,161,175,0.2)]',
    dot: 'bg-[#99A1AF]',
  },
  running: {
    container: 'bg-status-success-light',
    dot: 'bg-status-success',
  },
  delayed: {
    container: 'bg-status-warning-light',
    dot: 'bg-status-warning',
  },
  faulted: {
    container: 'bg-status-error-light',
    dot: 'bg-status-error',
  },
  completed: {
    container: 'bg-[rgba(153,161,175,0.2)]',
    dot: 'bg-[#99A1AF]',
  },
  fault_pending: {
    container: 'bg-status-error-light',
    dot: 'bg-status-error',
  },
  cancelled: {
    container: 'bg-[rgba(153,161,175,0.2)]',
    dot: 'bg-[#99A1AF]',
  },
};

export function dateInputToPlannedStartMs(dateStr: string, endOfDay = false): string | undefined {
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return undefined;
  return String(ms);
}
