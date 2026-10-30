import { getDataSourceById } from '../../dashboard/store/useDataSourceStore';
import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase';
import type { ExecutionStatusKey, ShiftRecordListItem, ShiftTab } from '../types';

export function resolveShiftRecordsBackendUrl(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl);
}

export type ShiftRecordListQuery = {
  tab: ShiftTab;
  keyword?: string;
  execution_status?: ExecutionStatusKey | 'all';
  vehicle_code?: string;
  planned_start_from?: string;
  planned_start_to?: string;
  page?: number;
  page_size?: number;
};

export type ShiftRecordListResponse = {
  items: ShiftRecordListItem[];
  total: number;
  page: number;
  page_size: number;
  time_zone: string;
};

export type ShiftRecordAction = {
  action_id: string;
  station_id: string;
  station_display_name?: string | null;
  action_type: string;
  action_status: string;
  node_id: string | null;
  actual_start_time?: number | null;
  actual_end_time?: number | null;
  note?: string | null;
};

export type ShiftRecordDetail = ShiftRecordListItem & {
  /** 訂單 payload（調度引擎下單時寫的）：路線代號與有序站序 */
  payload?: {
    route_code?: string | null;
    stations?: Array<{ station_id?: string | null }>;
  } | null;
  actions: ShiftRecordAction[];
  task_group: Array<Record<string, unknown>>;
  vehicle_phase: unknown;
  current_leg: unknown;
  /** 訂單建立時刻（Unix ms） */
  created_at?: number | string | null;
  /** 班次唯一碼：訂單號＠建立時刻；運行管理紀錄以它對到同一次執行 */
  run_code?: string | null;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

/** 清單請求逾時：後端卡住時要能結束這一支，讓下一次重查接手，而不是一直掛著 */
const LIST_TIMEOUT_MS = 15_000;

/**
 * signal：條件換了、頁面卸載時由呼叫端中止；另外自帶逾時。
 */
export async function fetchShiftRecordList(
  query: ShiftRecordListQuery,
  backendUrl = resolveShiftRecordsBackendUrl(),
  signal?: AbortSignal,
): Promise<ShiftRecordListResponse> {
  const qs = buildQuery({
    tab: query.tab,
    keyword: query.keyword,
    execution_status: query.execution_status ?? 'all',
    vehicle_code: query.vehicle_code,
    planned_start_from: query.planned_start_from,
    planned_start_to: query.planned_start_to,
    page: query.page ?? 1,
    page_size: query.page_size ?? 20,
  });
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LIST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const res = await fetch(`${backendUrl}/syncdrive-api/order/list?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`載入班次列表失敗（${res.status}）`);
    }
    return await (res.json() as Promise<ShiftRecordListResponse>);
  } catch (error) {
    if (timedOut) throw new Error(`載入班次列表逾時（${LIST_TIMEOUT_MS / 1000} 秒）`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchShiftRecordDetail(
  orderId: string,
  backendUrl = resolveShiftRecordsBackendUrl(),
): Promise<ShiftRecordDetail> {
  const res = await fetch(
    `${backendUrl}/syncdrive-api/order/detail?id=${encodeURIComponent(orderId)}`,
  );
  if (!res.ok) {
    throw new Error(`載入班次詳情失敗（${res.status}）`);
  }
  return res.json() as Promise<ShiftRecordDetail>;
}

export function exportShiftRecordsCsv(
  items: ShiftRecordListItem[],
  filename = 'shift-records.csv',
  timeZone = 'Asia/Taipei',
): void {
  const headers = [
    '班次代號',
    '執行狀態',
    '執行路線',
    '執行載具',
    `發車時間（${timeZone}）`,
    `結束時間（${timeZone}）`,
    '訂單編號',
  ];
  const rows = items.map((row) => [
    row.trip_code,
    row.execution_status_label,
    row.route_label,
    row.vehicle_code,
    row.depart_time ?? '',
    row.end_time ?? '',
    row.order_id,
  ]);
  const escape = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const csv = [headers, ...rows].map((line) => line.map(escape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
