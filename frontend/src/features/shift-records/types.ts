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
  { value: 'faulted', label: '故障' },
  { value: 'completed', label: '已完成' },
];

/**
 * 畫面上顯示的執行狀態。中心端取消後車端照協議回報 FAULTED 結案的單是「已中止」，
 * 不是車輛故障——篩選仍歸在 faulted（後端 execution_status 不變），只是文字與顏色分開。
 */
export type ExecutionDisplayKey = ExecutionStatusKey | 'cancelled';

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
    container: 'bg-[rgba(0,212,146,0.2)]',
    dot: 'bg-[#00D492]',
  },
  delayed: {
    container: 'bg-[rgba(251,146,60,0.2)]',
    dot: 'bg-[#FB923C]',
  },
  faulted: {
    container: 'bg-[rgba(239,68,68,0.2)]',
    dot: 'bg-[#EF4444]',
  },
  completed: {
    container: 'bg-[rgba(153,161,175,0.2)]',
    dot: 'bg-[#99A1AF]',
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
