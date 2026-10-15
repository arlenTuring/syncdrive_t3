import { resolveBrowserApiBaseUrl } from "../../lib/browserApiBase";
import type { ReplayCursor } from "../replay-core/cursor";
import type { ReplayFrame } from "../replay-core/replayState";
import type { RelatedRecords } from "../replay-core/VehicleDataPanel";

/** 運行管理紀錄（唯讀）：權限 vehicle.log.view，與降級操作權限無關 */
const API = "/syncdrive-api/vehicle-history";

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${resolveBrowserApiBaseUrl()}${path}`, {
    signal,
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join("、") : body?.message;
    if (response.status === 403) throw new Error(message || "沒有檢視運行管理紀錄的權限");
    throw new Error(message || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type CoverageGap = {
  from_real: number;
  to_real: number;
  reason: "not_recorded" | "write_failed" | "backpressure" | "backend_restart";
  count?: number;
  detail?: string | null;
};

export type Coverage = {
  state: "none" | "partial" | "complete";
  recorded: Array<{ from_real: number; to_real: number }>;
  gaps: CoverageGap[];
  health_keepalive_ms: number;
};

/** 調查載具：id 是穩定識別（前後端關聯一律用它），vehicle_code 是通訊代號（只供辨認） */
export type InvestigatedVehicle = { id: string; vehicle_code: string; display_name: string; is_active: boolean };

export type VehicleOption = InvestigatedVehicle & { history_first_real: number | null; history_last_real: number | null };

/** 調查載具在範圍內自己的紀錄數（不含其他車與系統參照） */
export type VehicleRecords = { count: number; first_real: number | null; last_real: number | null; last_before_real: number | null };

export type HistoryScope = "vehicle" | "background";

export type RangeVehicle = { vehicle_code: string; streams: string[]; first_real: number; last_real: number };
export type ClockRun = { clock_run: string; mode: string | null; run_id: string | null; from_real: number; to_real: number };

export type RangeResolution = {
  mode: "range";
  vehicle: InvestigatedVehicle;
  vehicle_records: VehicleRecords;
  timezone: string;
  window: { from_real: number; to_real: number; requested_to_real: number; ongoing: boolean };
  coverage: Coverage;
  vehicles: RangeVehicle[];
  clock_runs: ClockRun[];
  stale_after_ms: number;
  max_frames_per_request: number;
};

export type ShiftState =
  | "not_found"
  | "ambiguous"
  | "not_started"
  | "no_history"
  | "no_vehicle"
  | "multi_vehicle"
  | "running"
  | "partial"
  | "complete";

export type ShiftResolution = {
  mode: "shift";
  code: string;
  state: ShiftState;
  state_label: string;
  candidates?: Array<{ code: string; trip_code: string | null; vehicle_code: string | null; status: string }>;
  order_id?: string;
  created_at?: number;
  trip_code?: string | null;
  vehicle_code?: string | null;
  operating_day?: string | null;
  plan_run_id?: string | null;
  status?: string;
  record_source?: "history" | "orders";
  window?: { from_real: number; to_real: number; ongoing: boolean } | null;
  range_basis?: { from: string | null; to: string | null } | null;
  coverage?: Coverage | null;
  stale_after_ms?: number;
  /** 固定的調查載具；多台時為 null，要先選 */
  vehicle?: InvestigatedVehicle | null;
  vehicle_records?: VehicleRecords;
  vehicle_candidates?: Array<{ vehicle_code: string; records: number; vehicle: InvestigatedVehicle | null }>;
};

export function fetchInvestigableVehicles(signal?: AbortSignal) {
  return json<{ items: VehicleOption[] }>(`${API}/vehicles`, signal);
}

export function resolveRange(input: { vehicleId: string; from: string; to: string; tz: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ vehicle_id: input.vehicleId, from: input.from, to: input.to, tz: input.tz });
  return json<RangeResolution>(`${API}/resolve/range?${query}`, signal);
}

export function resolveShift(code: string, vehicleId: string | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ code });
  if (vehicleId) query.set("vehicle_id", vehicleId);
  return json<ShiftResolution>(`${API}/resolve/shift?${query}`, signal);
}

export function fetchHistorySnapshot(vehicleId: string, scope: HistoryScope, cursor: ReplayCursor, signal?: AbortSignal) {
  const query = new URLSearchParams({ vehicle_id: vehicleId, scope, at: String(Math.floor(cursor.t)) });
  if (cursor.seq != null) query.set("seq", cursor.seq);
  return json<{ at: number; seq: string | null; frames: ReplayFrame[]; reference: { t: number; received_at: number; seq: string } | null }>(
    `${API}/snapshot?${query}`,
    signal,
  );
}

export function fetchHistoryFrames(
  input: { vehicleId: string; scope: HistoryScope; from: number; to: number; after: ReplayCursor },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    vehicle_id: input.vehicleId,
    scope: input.scope,
    from: String(Math.floor(input.from)),
    to: String(Math.floor(input.to)),
    after_t: String(Math.floor(input.after.t)),
  });
  if (input.after.seq != null) query.set("after_seq", input.after.seq);
  return json<{ from: number; to: number; frames: ReplayFrame[]; covered_to: number; next: { t: number; seq: string } | null }>(
    `${API}/frames?${query}`,
    signal,
  );
}

export function fetchHistoryNeighbor(
  vehicleId: string,
  cursor: ReplayCursor,
  dir: "prev" | "next",
  bounds: { min: number; max: number },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ vehicle_id: vehicleId, at: String(Math.floor(cursor.t)), dir, min: String(bounds.min), max: String(bounds.max) });
  if (cursor.seq != null) query.set("seq", cursor.seq);
  return json<{ frame: ReplayFrame | null }>(`${API}/neighbor?${query}`, signal);
}

export function fetchHistoryMap(hash: string, signal?: AbortSignal) {
  return json<{ map_id: string; map_hash: string; version: string | null; document: unknown }>(
    `${API}/map?${new URLSearchParams({ hash })}`,
    signal,
  );
}

export function fetchVehicleRelated(input: { vehicleId: string; from: number; to: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({ vehicle_id: input.vehicleId, from: String(Math.floor(input.from)), to: String(Math.floor(input.to)) });
  return json<RelatedRecords & { vehicle: string }>(`${API}/vehicle-events?${query}`, signal);
}
