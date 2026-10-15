import { resolveBrowserApiBaseUrl } from "../../lib/browserApiBase";
import { getDemoAccount } from "../schedule-management/utils/demoAccountPreference";
import type { ReplayVehicleModelSnapshot } from "../replay-core/ReplayMapLayer";
import type { ReplayCursor } from "../replay-core/cursor";
import type { ReplayFrame as CoreReplayFrame } from "../replay-core/replayState";

const API = "/syncdrive-api/degraded-operation";

export type DegradedOperationPlan = {
  id: string;
  name: string;
  description: string;
  level: number;
  speed_limit_kmh: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DegradedOperationPlanInput = Pick<
  DegradedOperationPlan,
  "name" | "description" | "level" | "speed_limit_kmh"
>;

export type PlanListResponse = {
  items: DegradedOperationPlan[];
  total: number;
  page: number;
  page_size: number;
};

export type ExecutionResponse = DegradedOperationPlanInput & {
  execution_id: string;
  source_plan_id: string | null;
  operator_id: string;
  execution_status:
    | "scheduled"
    | "activating"
    | "active"
    | "restoring"
    | "ended"
    | "cancelled"
    | "failed";
  control_status: "not_dispatched" | "pending" | "applied" | "failed";
  command_tracking: unknown[];
  schedule_mode: "immediate" | "scheduled";
  scheduled_for_operating: string | null;
  scheduled_timezone: string;
  started_at_operating: string | null;
  started_at_real: string | null;
  ended_at_operating: string | null;
  ended_at_real: string | null;
  restore_speed_limit_kmh: number | null;
  restore_checks: Record<string, boolean> | null;
  error_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  message: string;
};

export type OperationStatus = {
  mode: "normal" | "degraded" | "unknown";
  pending: ExecutionResponse | null;
  active_execution: ExecutionResponse | null;
  operating_now: number;
  real_now: number;
  updated_at: number;
  source: "system_settings";
};

export type ExecutionSchedule = {
  schedule_mode: "immediate" | "scheduled";
  scheduled_time?: string;
  time_zone: string;
};

const operatorHeaders = () => {
  const account = getDemoAccount();
  return { "x-syncdrive-operator": `${account.id}:${account.name}` };
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveBrowserApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("、")
      : body?.message;
    throw new Error(message || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDegradedOperationPlans(
  params: {
    sortBy?: "name" | "level" | "speed";
    direction?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.sortBy) query.set("sort_by", params.sortBy);
  if (params.direction) query.set("sort_direction", params.direction);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("page_size", String(params.pageSize));
  return json<PlanListResponse>(`${API}/plans${query.size ? `?${query}` : ""}`);
}

export function fetchDegradedOperationPlan(id: string) {
  return json<DegradedOperationPlan>(`${API}/plans/${encodeURIComponent(id)}`);
}

export function createDegradedOperationPlan(input: DegradedOperationPlanInput) {
  return json<DegradedOperationPlan>(`${API}/plans`, {
    method: "POST",
    headers: operatorHeaders(),
    body: JSON.stringify(input),
  });
}

export function updateDegradedOperationPlan(
  id: string,
  input: DegradedOperationPlanInput,
  version?: number,
) {
  return json<DegradedOperationPlan>(`${API}/plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: operatorHeaders(),
    body: JSON.stringify({ ...input, version }),
  });
}

export function deleteDegradedOperationPlan(id: string) {
  return json<{ deleted: true; id: string }>(
    `${API}/plans/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: operatorHeaders() },
  );
}

export function executeDegradedOperation(
  input: DegradedOperationPlanInput & {
    source_plan_id?: string;
  } & ExecutionSchedule,
) {
  return json<ExecutionResponse>(`${API}/executions`, {
    method: "POST",
    headers: operatorHeaders(),
    body: JSON.stringify({ ...input, idempotency_key: crypto.randomUUID() }),
  });
}

export function cancelDegradedSchedule(id: string, version: number) {
  return json<ExecutionResponse>(
    `${API}/executions/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify({ version }),
    },
  );
}

export function adjustDegradedExecution(
  id: string,
  input: { level: number; speed_limit_kmh: number; version: number },
) {
  return json<ExecutionResponse>(
    `${API}/executions/${encodeURIComponent(id)}/parameters`,
    {
      method: "PATCH",
      headers: operatorHeaders(),
      body: JSON.stringify(input),
    },
  );
}

export function updateDegradedExecutionContent(
  id: string,
  input: { name: string; description: string; version: number },
) {
  return json<ExecutionResponse>(
    `${API}/executions/${encodeURIComponent(id)}/content`,
    {
      method: "PATCH",
      headers: operatorHeaders(),
      body: JSON.stringify(input),
    },
  );
}

export function restoreDegradedExecution(
  id: string,
  input: {
    personnel_and_vehicles_cleared: boolean;
    alarms_cleared: boolean;
    version: number;
  },
) {
  return json<ExecutionResponse>(
    `${API}/executions/${encodeURIComponent(id)}/restore`,
    { method: "POST", headers: operatorHeaders(), body: JSON.stringify(input) },
  );
}

export function saveDegradedDraft(
  kind: string,
  value: Record<string, unknown>,
  status: "open" | "cancelled" | "submitted" = "open",
) {
  return json(`${API}/drafts/${encodeURIComponent(kind)}`, {
    method: "POST",
    headers: operatorHeaders(),
    body: JSON.stringify({ value, status }),
  });
}

export function recordDegradedInteraction(
  action: "plan_selected" | "dialog_opened" | "dialog_cancelled",
  detail: { plan_id?: string; execution_id?: string; draft_key?: string } = {},
) {
  return json(`${API}/events`, {
    method: "POST",
    headers: operatorHeaders(),
    body: JSON.stringify({ action, ...detail }),
  });
}

export function fetchDegradedOperationStatus() {
  return json<OperationStatus>(`${API}/status`);
}

export async function fetchActiveMapId(): Promise<string> {
  const body = await json<{ mapId?: string }>(
    "/syncdrive-api/map/library/active",
  );
  const mapId = String(body.mapId ?? "").trim();
  if (!mapId) throw new Error("目前沒有啟用的地圖");
  return mapId;
}

// ── 歷史紀錄與回放（唯讀）────────────────────────────────────────────

export type ReplayAvailability = {
  state: "not_started" | "none" | "partial" | "complete" | "recording";
  reason: string | null;
};

export type HistoryItem = {
  execution_id: string;
  source_plan_id: string | null;
  name: string;
  description: string;
  level: number;
  speed_limit_kmh: number;
  execution_status: ExecutionResponse["execution_status"];
  control_status: string;
  schedule_mode: "immediate" | "scheduled";
  scheduled_for_operating: number | null;
  started_at_operating: number | null;
  started_at_real: number | null;
  ended_at_operating: number | null;
  ended_at_real: number | null;
  operator_id: string;
  created_at: number | null;
  replay: ReplayAvailability;
};

export type ParameterChange = {
  event_id: string;
  action: string;
  operator_id: string;
  operated_at_real: number;
  effective_at_operating: number | null;
  level: number | null;
  speed_limit_kmh: number | null;
  previous_level: number | null;
  previous_speed_limit_kmh: number | null;
  control: {
    result: string;
    dispatched_at_real: number | null;
    reason: string | null;
  };
};

export type HistoryDetail = HistoryItem & {
  parameter_changes: ParameterChange[];
};

export type ReplayGap = {
  from_real: number;
  to_real: number;
  from_operating: number | null;
  to_operating: number | null;
  reason: string;
  count?: number;
};

export type ReplayMeta = {
  execution_id: string;
  availability: ReplayAvailability;
  window: { from_operating: number; to_operating: number; ongoing: boolean } | null;
  map: {
    map_id: string;
    map_hash: string;
    version: string | null;
    display_name: string | null;
  } | null;
  coverage: {
    status: string;
    initial_captured: boolean;
    frame_count: number;
    dropped_count: number;
    gaps: ReplayGap[];
    last_error: string | null;
    /** history：資料來自一般運行歷史（同一份錄製）；degraded：舊紀錄，降級自己保存的 */
    frames_source?: "history" | "degraded";
  } | null;
  stale_after_ms: number;
  max_frames_per_request: number;
  /** 開始時的車輛模型快照；null＝這筆紀錄沒有保存（功能上線前） */
  vehicle_model: ReplayVehicleModelSnapshot | null;
};

export type { ReplayVehicleModelSnapshot } from "../replay-core/ReplayMapLayer";

/** 一筆回放資料：與一般運行紀錄共用格式；t＝營運時間，seq 以字串保留 bigint 精度 */
export type ReplayFrame = CoreReplayFrame;

export type ReplaySnapshot = {
  execution_id: string;
  at: number;
  seq: string | null;
  frames: ReplayFrame[];
  reference: { t: number; received_at: number; operating_at: number; seq: string } | null;
};

export type ReplayFramesPage = {
  execution_id: string;
  from: number;
  to: number;
  frames: ReplayFrame[];
  covered_to: number;
  next: { from: number; after_seq: string } | null;
};

const executionPath = (id: string) => `${API}/executions/${encodeURIComponent(id)}`;

export function fetchDegradedHistory(
  params: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("page_size", String(params.pageSize));
  return json<{ items: HistoryItem[]; total: number; page: number; page_size: number }>(
    `${API}/executions${query.size ? `?${query}` : ""}`,
    { signal },
  );
}

export function fetchDegradedHistoryDetail(id: string, signal?: AbortSignal) {
  return json<HistoryDetail>(executionPath(id), { signal });
}

export function fetchReplayMeta(id: string, signal?: AbortSignal) {
  return json<ReplayMeta>(`${executionPath(id)}/replay`, { signal });
}

export function fetchReplayMap(id: string, signal?: AbortSignal) {
  return json<{ map_id: string; map_hash: string; version: string | null; document: unknown }>(
    `${executionPath(id)}/replay/map`,
    { signal },
  );
}

export function fetchReplaySnapshot(id: string, cursor: ReplayCursor, signal?: AbortSignal) {
  const query = new URLSearchParams({ at: String(Math.floor(cursor.t)) });
  if (cursor.seq != null) query.set("seq", cursor.seq);
  return json<ReplaySnapshot>(`${executionPath(id)}/replay/snapshot?${query}`, { signal });
}

/** 游標前一筆／後一筆（逐幀跨出已載入範圍時用） */
export function fetchReplayNeighbor(
  id: string,
  cursor: ReplayCursor,
  dir: "prev" | "next",
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ at: String(Math.floor(cursor.t)), dir });
  if (cursor.seq != null) query.set("seq", cursor.seq);
  return json<{ execution_id: string; frame: ReplayFrame | null }>(
    `${executionPath(id)}/replay/neighbor?${query}`,
    { signal },
  );
}

export function fetchReplayFrames(
  id: string,
  input: { from: number; to: number; afterSeq?: string; limit?: number },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    from: String(Math.floor(input.from)),
    to: String(Math.floor(input.to)),
  });
  if (input.afterSeq !== undefined) query.set("after_seq", input.afterSeq);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  return json<ReplayFramesPage>(`${executionPath(id)}/replay/frames?${query}`, {
    signal,
  });
}
