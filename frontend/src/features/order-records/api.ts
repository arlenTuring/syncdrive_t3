import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

export type OrderCategory = 'running' | 'pending' | 'fault' | 'completed' | 'cancelled';
export type OrderRecord = {
  source: 'order';
  source_id: string;
  order_id: string;
  display_name: string;
  vehicle_code: string;
  route_name: string;
  category: OrderCategory;
  status: string;
  status_hint: string | null;
  planned_start: number | null;
  planned_end: number | null;
  actual_start: number | null;
  actual_end: number | null;
  reason: string | null;
  stations: Array<{ order: number; station_id: string; station_name: string; actions: string[] }>;
};
export type OrderRecordOptions = {
  time_zone: string;
  page_size: number;
  vehicles: Array<{ vehicle_code: string; display_name: string; active: boolean }>;
  categories: Array<{ value: OrderCategory; label: string }>;
};
export type OrderRecordPage = {
  items: OrderRecord[];
  total: number;
  page: number;
  page_size: number;
  sort_by: string;
  direction: 'asc' | 'desc';
  time_zone: string;
  snapshot: number;
};

const base = () => `${resolveBrowserApiBaseUrl()}/syncdrive-api/order/schedule/records`;
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({})) as { message?: string | string[] };
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join('、') : body.message || `HTTP ${response.status}`);
  return body as T;
}

export const fetchOrderRecordOptions = (signal?: AbortSignal) => json<OrderRecordOptions>(`${base()}/options`, signal);
export const fetchOrderRecords = (query: Record<string, string | number | undefined>, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return json<OrderRecordPage>(`${base()}?${params}`, signal);
};
export const fetchOrderRecordDetail = (id: string, signal?: AbortSignal) => json<OrderRecord>(`${base()}/detail?id=${encodeURIComponent(id)}`, signal);
