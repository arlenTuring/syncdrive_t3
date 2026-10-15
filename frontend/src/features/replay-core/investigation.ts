import { emptyReplayState, type ReplayState } from "./replayState";

/**
 * 地圖用的顯示狀態：背景車隊（其他車、場站設施、地圖參照）＋調查載具。
 *
 * 兩份狀態各自重建、各自不含游標之後的資料。調查載具的鍵只取調查載具那一份，背景裡就算有
 * 同一台車的資料也不採用（背景本來就排除它），兩邊不會互相覆蓋。面板只看調查載具那一份。
 */
const SYSTEM_KEYS = new Set(["map|active", "model|active", "clock|run"]);

export function mergeDisplayState(investigated: ReplayState | null, background: ReplayState | null, vehicleCode: string): ReplayState | null {
  if (!investigated && !background) return null;
  const out = emptyReplayState();
  const copy = (from: Map<string, unknown> | undefined, to: Map<string, unknown>, keep: (key: string) => boolean) => {
    if (!from) return;
    for (const [key, value] of from) if (keep(key)) to.set(key, value);
  };
  const notInvestigated = (key: string) => key !== vehicleCode;
  const ownKey = (key: string) => !key.endsWith(`|${vehicleCode}`);
  copy(background?.telemetry, out.telemetry as Map<string, unknown>, notInvestigated);
  copy(background?.operation, out.operation as Map<string, unknown>, notInvestigated);
  copy(background?.health, out.health as Map<string, unknown>, notInvestigated);
  copy(background?.facility, out.facility as Map<string, unknown>, () => true);
  copy(background?.orders, out.orders as Map<string, unknown>, () => true);
  copy(background?.byKey, out.byKey as Map<string, unknown>, ownKey);
  for (const [key, value] of investigated?.telemetry ?? []) if (key === vehicleCode) out.telemetry.set(key, value);
  for (const [key, value] of investigated?.operation ?? []) if (key === vehicleCode) out.operation.set(key, value);
  for (const [key, value] of investigated?.health ?? []) if (key === vehicleCode) out.health.set(key, value);
  for (const [key, value] of investigated?.orders ?? []) out.orders.set(key, value);
  for (const [key, value] of investigated?.byKey ?? []) {
    // 地圖、模型、時鐘參照：背景跟著游標更新；背景還沒載入時才用調查載具起點快照附的那一份
    if (SYSTEM_KEYS.has(key) && out.byKey.has(key)) continue;
    out.byKey.set(key, value);
  }
  out.reference = investigated?.reference ?? background?.reference ?? null;
  out.last = investigated?.last ?? null;
  return out;
}

export type InvestigatedPosition =
  | { state: "visible" }
  | { state: "missing"; reason: string };

/** 調查載具在游標當下畫不出來的原因（不回退顯示別台車） */
export function investigatedPositionReason(
  investigated: ReplayState | null,
  vehicleCode: string,
  visible: boolean,
  hiddenReason: "stale" | "gap" | null,
): InvestigatedPosition {
  if (visible) return { state: "visible" };
  if (!investigated) return { state: "missing", reason: "調查載具資料載入中" };
  if (hiddenReason === "gap") return { state: "missing", reason: "最後一筆位置在資料缺段之前，缺段期間位置不明" };
  if (hiddenReason === "stale") return { state: "missing", reason: "位置資料已過期（之後沒有再收到遙測）" };
  if (!investigated.telemetry.has(vehicleCode)) return { state: "missing", reason: "游標之前沒有保存這台車的遙測（沒有位置）" };
  return { state: "missing", reason: "遙測沒有有效的場域座標，無法定位" };
}
