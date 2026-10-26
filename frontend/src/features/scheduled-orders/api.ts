import { resolveBrowserApiBaseUrl } from "../../lib/browserApiBase";

export type CalendarCategory =
  "running" | "pending" | "fault" | "completed" | "cancelled";
export type ScheduleStation = {
  order: number;
  station_id: string;
  station_name: string;
  actions: string[];
};
export type CalendarItem = {
  source: "schedule" | "order" | "plan";
  source_id: string;
  schedule_id: string | null;
  order_id: string | null;
  display_name: string;
  vehicle_code: string;
  route_id: string | null;
  route_name: string;
  category: CalendarCategory;
  status: string;
  status_hint: string | null;
  planned_start: number;
  planned_end: number | null;
  actual_start: number | null;
  actual_end: number | null;
  reason: string | null;
  stations: ScheduleStation[];
};
export type CalendarResponse = {
  time_zone: string;
  from: number;
  to: number;
  total: number;
  limit_per_group: number;
  unscheduled_count: number;
  days: Record<
    string,
    { counts: Record<CalendarCategory, number>; items: CalendarItem[] }
  >;
};
export type ScheduleOptions = {
  time_zone: string;
  map_id: string | null;
  vehicles: Array<{ vehicle_code: string; display_name: string }>;
  routes: Array<{
    route_id: string;
    route_name: string;
    line_kind: string;
    group_name: string;
    available: boolean;
    unavailable_reason: string | null;
    estimated_minutes: number | null;
    stations: ScheduleStation[];
  }>;
};

const base = () => `${resolveBrowserApiBaseUrl()}/syncdrive-api/order/schedule`;
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!response.ok)
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join("、")
        : body.message || `HTTP ${response.status}`,
    );
  return body as T;
}
export const fetchScheduleOptions = (signal?: AbortSignal) =>
  json<ScheduleOptions>(`${base()}/options`, { signal });
export const fetchScheduleCalendar = (
  from: number,
  to: number,
  vehicleCode: string,
  limitPerGroup: number,
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams({
    from: String(from),
    to: String(to),
    limit_per_group: String(limitPerGroup),
  });
  if (vehicleCode) query.set("vehicle_code", vehicleCode);
  return json<CalendarResponse>(`${base()}/calendar?${query}`, { signal });
};
export const fetchScheduleDetail = (
  item: Pick<CalendarItem, "source" | "source_id">,
  signal?: AbortSignal,
) =>
  json<CalendarItem>(
    `${base()}/detail?source=${item.source}&id=${encodeURIComponent(item.source_id)}`,
    { signal },
  );
export const createSchedule = (input: {
  request_key: string;
  display_name: string;
  vehicle_code: string;
  route_id: string;
  planned_start: number;
}) =>
  json<CalendarItem>(base(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
