import { resolveBrowserApiBaseUrl } from "../../lib/browserApiBase";
import { getDemoAccount } from "../schedule-management/utils/demoAccountPreference";

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
  input: { name: string; description: string; level: number; version: number },
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
