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
};

export type ShiftRecordDetail = ShiftRecordListItem & {
  actions: Array<{
    action_id: string;
    station_id: string;
    action_type: string;
    action_status: string;
    node_id: string | null;
  }>;
  task_group: Array<Record<string, unknown>>;
  vehicle_phase: unknown;
  current_leg: unknown;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

export async function fetchShiftRecordList(
  query: ShiftRecordListQuery,
  backendUrl = resolveShiftRecordsBackendUrl(),
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
  const res = await fetch(`${backendUrl}/syncdrive-api/order/list?${qs}`);
  if (!res.ok) {
    throw new Error(`載入班次列表失敗（${res.status}）`);
  }
  return res.json() as Promise<ShiftRecordListResponse>;
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

export function exportShiftRecordsCsv(items: ShiftRecordListItem[], filename = 'shift-records.csv'): void {
  const headers = [
    '班次代號',
    '執行狀態',
    '執行路線',
    '執行載具',
    '發車時間',
    '結束時間',
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
