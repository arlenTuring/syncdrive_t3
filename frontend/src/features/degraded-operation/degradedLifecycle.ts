import type { ExecutionResponse, OperationStatus } from "./api";

/** 已經正式開始、還沒恢復完成的階段：右側只顯示影響範圍 */
const IN_EFFECT: ReadonlyArray<ExecutionResponse["execution_status"]> = [
  "activating",
  "active",
  "restoring",
];

export type DegradedSidePanel =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "plans" }
  | { kind: "impact"; execution: ExecutionResponse };

/**
 * 右側面板跟著後端狀態走，不給使用者切換。
 *
 * 不能只看 active_execution 有沒有值：判斷依據是執行生命週期。待執行預約（scheduled）
 * 還沒開始，維持計畫清單（預約資訊另外顯示）；狀態不一致或讀取失敗就明說未知，
 * 不假裝正常營運。
 */
export function degradedSidePanel(
  status: { loading: boolean; value: OperationStatus | null; error: string | null },
): DegradedSidePanel {
  if (status.error) return { kind: "error", message: status.error };
  if (!status.value) return status.loading ? { kind: "loading" } : { kind: "error", message: "營運狀態未知" };
  if (status.value.mode === "unknown")
    return { kind: "error", message: "營運狀態與執行紀錄不一致，狀態未知" };
  const execution = status.value.active_execution;
  if (execution && IN_EFFECT.includes(execution.execution_status))
    return { kind: "impact", execution };
  if (status.value.mode === "degraded")
    return { kind: "error", message: "後端回報降級中，但找不到進行中的執行紀錄" };
  return { kind: "plans" };
}

export function isInEffect(execution: ExecutionResponse | null | undefined): boolean {
  return !!execution && IN_EFFECT.includes(execution.execution_status);
}
