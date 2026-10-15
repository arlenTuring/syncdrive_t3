import { cursorOf, frameAtOrBefore, frameOrder, type ReplayCursor } from "../../replay-core/cursor";
import type { ReplayFrame } from "../../replay-core/replayState";
import type { InvestigatedVehicle } from "../api";

/**
 * 測試用的記憶體內運行歷史後端：照真正 API 的規則依 vehicle_id、scope 篩選，篩選後才套筆數上限，
 * 每頁很小（逼出跨頁）。只在測試裡用。
 */
export type FakeBackend = {
  fetch: typeof fetch;
  calls: string[];
  /** 下一次這個路徑（含查詢字串片段）的回應延後多久（毫秒） */
  delay: (match: string, ms: number) => void;
};

const MAX_SEQ = "9223372036854775807";
const VEHICLE_STREAMS = new Set(["telemetry", "operation", "health", "event", "command_ack", "order", "order_action"]);

export function createFakeHistoryBackend(input: {
  vehicles: InvestigatedVehicle[];
  frames: ReplayFrame[];
  pageSize?: number;
  shifts?: Record<string, { vehicleCodes: string[]; from: number; to: number }>;
}): FakeBackend {
  const all = [...input.frames].sort(frameOrder);
  const pageSize = input.pageSize ?? 3;
  const calls: string[] = [];
  const delays: Array<{ match: string; ms: number }> = [];
  const byId = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));

  const inScope = (frame: ReplayFrame, code: string, scope: string, forSnapshot: boolean) => {
    if (scope === "background") return frame.vehicle_code !== code;
    if (frame.vehicle_code === code && VEHICLE_STREAMS.has(frame.stream)) return true;
    return forSnapshot && ["map", "model", "clock"].includes(frame.stream);
  };
  const cursorFrom = (url: URL, t: string, s: string): ReplayCursor => ({
    t: Number(url.searchParams.get(t)),
    seq: url.searchParams.get(s) ?? null,
  });
  const strictlyAfter = (frame: ReplayFrame, cursor: ReplayCursor) =>
    !frameAtOrBefore(frame, { t: cursor.t, seq: cursor.seq ?? MAX_SEQ });

  const handle = (url: URL): { status: number; body: unknown } => {
    const path = url.pathname.replace("/syncdrive-api/vehicle-history/", "");
    if (path === "vehicles") return { status: 200, body: { items: input.vehicles.map((vehicle) => ({ ...vehicle, history_first_real: 1, history_last_real: 2 })) } };
    const vehicle = byId.get(url.searchParams.get("vehicle_id") ?? "");
    if (path === "resolve/shift") {
      const shift = input.shifts?.[url.searchParams.get("code") ?? ""];
      if (!shift) return { status: 200, body: { mode: "shift", code: url.searchParams.get("code"), state: "not_found", state_label: "查無此班次", candidates: [] } };
      const candidates = shift.vehicleCodes.map((code) => ({ vehicle_code: code, records: 1, vehicle: input.vehicles.find((item) => item.vehicle_code === code) ?? null }));
      const chosen = vehicle ?? (candidates.length === 1 ? candidates[0].vehicle : null);
      if (!chosen)
        return { status: 200, body: { mode: "shift", code: url.searchParams.get("code"), state: "multi_vehicle", state_label: "這次執行涉及多台載具，請選擇", window: null, vehicle: null, vehicle_candidates: candidates } };
      return {
        status: 200,
        body: {
          mode: "shift",
          code: url.searchParams.get("code"),
          state: "complete",
          state_label: "已完整錄製",
          trip_code: "T1",
          window: { from_real: shift.from, to_real: shift.to, ongoing: false },
          coverage: { state: "complete", recorded: [{ from_real: shift.from, to_real: shift.to }], gaps: [], health_keepalive_ms: 10_000 },
          vehicle: chosen,
          vehicle_records: recordsOf(chosen.vehicle_code, shift.from, shift.to),
          vehicle_candidates: candidates,
          stale_after_ms: 60_000,
        },
      };
    }
    if (!vehicle) return { status: 400, body: { message: "請指定調查載具" } };
    const code = vehicle.vehicle_code;
    const scope = url.searchParams.get("scope") ?? "vehicle";
    if (path === "resolve/range") {
      const from = Date.parse(url.searchParams.get("from")!);
      const to = Date.parse(url.searchParams.get("to")!);
      return {
        status: 200,
        body: {
          mode: "range",
          vehicle,
          vehicle_records: recordsOf(code, from, to),
          timezone: "Asia/Taipei",
          window: { from_real: from, to_real: to, requested_to_real: to, ongoing: false },
          coverage: { state: "complete", recorded: [{ from_real: from, to_real: to }], gaps: [], health_keepalive_ms: 10_000 },
          vehicles: [],
          clock_runs: [],
          stale_after_ms: 60_000,
          max_frames_per_request: pageSize,
        },
      };
    }
    if (path === "snapshot") {
      const at = cursorFrom(url, "at", "seq");
      const latest = new Map<string, ReplayFrame>();
      for (const frame of all) {
        if (!inScope(frame, code, scope, true) || !frameAtOrBefore(frame, { t: at.t, seq: at.seq ?? MAX_SEQ })) continue;
        latest.set(frame.stream_key ?? `${frame.stream}|${frame.vehicle_code}`, frame);
      }
      return { status: 200, body: { vehicle, scope, frames: [...latest.values()], reference: null } };
    }
    if (path === "frames") {
      const after = { t: Number(url.searchParams.get("after_t") ?? url.searchParams.get("from")), seq: url.searchParams.get("after_seq") };
      const to = Number(url.searchParams.get("to"));
      // 先篩選再套上限
      const rows = all.filter((frame) => inScope(frame, code, scope, false) && strictlyAfter(frame, after) && frame.t <= to);
      const page = rows.slice(0, pageSize);
      const truncated = rows.length > pageSize;
      const last = page.at(-1);
      return { status: 200, body: { vehicle, scope, frames: page, covered_to: truncated && last ? last.t : to, next: truncated && last ? cursorOf(last) : null } };
    }
    if (path === "neighbor") {
      const at = cursorFrom(url, "at", "seq");
      const min = Number(url.searchParams.get("min"));
      const max = Number(url.searchParams.get("max"));
      const own = all.filter((frame) => inScope(frame, code, "vehicle", false));
      const bound = { t: at.t, seq: at.seq ?? MAX_SEQ };
      const frame =
        url.searchParams.get("dir") === "prev"
          ? [...own].reverse().find((item) => frameOrder(item, bound) < 0 && item.t >= min) ?? null
          : own.find((item) => frameOrder(item, bound) > 0 && item.t <= max) ?? null;
      return { status: 200, body: { vehicle, frame } };
    }
    if (path === "vehicle-events") return { status: 200, body: { vehicle: code, events: [], commands: [] } };
    return { status: 404, body: { message: "not found" } };
  };

  function recordsOf(code: string, from: number, to: number) {
    const own = all.filter((frame) => frame.vehicle_code === code && VEHICLE_STREAMS.has(frame.stream) && frame.t >= from && frame.t <= to);
    return { count: own.length, first_real: own[0]?.t ?? null, last_real: own.at(-1)?.t ?? null, last_before_real: null };
  }

  const fakeFetch = (async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(resource), "http://test.local");
    calls.push(`${url.pathname.replace("/syncdrive-api/vehicle-history/", "")}?${url.searchParams}`);
    const delayIndex = delays.findIndex((item) => url.search.includes(item.match) || url.pathname.includes(item.match));
    const wait = delayIndex >= 0 ? delays.splice(delayIndex, 1)[0].ms : 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
    const { status, body } = handle(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  return { fetch: fakeFetch, calls, delay: (match, ms) => delays.push({ match, ms }) };
}
