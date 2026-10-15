import { zonedInputToIso } from "../replay-core/time";
import type { InvestigatedVehicle, RangeResolution, ShiftResolution } from "./api";

/** 一次最多查 12 小時（與後端一致） */
export const MAX_RANGE_MS = 12 * 60 * 60_000;

/** 已套用的查詢結果：調查載具與範圍都從這裡來，表單上還沒送出的修改不會混進來 */
export type Resolved =
  | { id: string; kind: "range"; value: RangeResolution }
  | { id: string; kind: "shift"; value: ShiftResolution };

/** 時間區間表單（待查詢條件） */
export type RangeDraft = { vehicleId: string | null; from: string; to: string; timeZone: string };

export type RangeCheck =
  | { ok: true; vehicleId: string; fromIso: string; toIso: string }
  | { ok: false; error: string };

/** 待查詢條件能不能送出：一定要有調查載具，時間區間要合法 */
export function checkRangeDraft(draft: RangeDraft, now = Date.now()): RangeCheck {
  if (!draft.vehicleId) return { ok: false, error: "請選擇調查載具" };
  const fromIso = zonedInputToIso(draft.from, draft.timeZone);
  const toIso = zonedInputToIso(draft.to, draft.timeZone);
  if (!fromIso || !toIso) return { ok: false, error: "請輸入完整的開始與結束日期時間" };
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (toMs <= fromMs) return { ok: false, error: "結束時間必須晚於開始時間" };
  if (toMs - fromMs > MAX_RANGE_MS) return { ok: false, error: "一次最多查 12 小時，請縮短區間" };
  if (fromMs > now) return { ok: false, error: "開始時間在未來，沒有歷史資料" };
  return { ok: true, vehicleId: draft.vehicleId, fromIso, toIso };
}

/** 已套用條件固定的調查載具；班次要先選車（多台）時是 null */
export function appliedVehicle(resolved: Resolved | null): InvestigatedVehicle | null {
  if (!resolved) return null;
  return resolved.kind === "range" ? resolved.value.vehicle : (resolved.value.vehicle ?? null);
}

/** 表單跟已套用的條件不同（使用者改了但還沒重新查詢） */
export function draftDiffers(draft: RangeDraft, resolved: Resolved | null): boolean {
  if (!resolved || resolved.kind !== "range") return true;
  const check = checkRangeDraft(draft, Number.POSITIVE_INFINITY);
  if (!check.ok) return true;
  return (
    check.vehicleId !== resolved.value.vehicle.id ||
    Date.parse(check.fromIso) !== resolved.value.window.from_real ||
    Date.parse(check.toIso) !== resolved.value.window.requested_to_real
  );
}

/** 名稱或通訊代號搜尋（不分大小寫） */
export function matchVehicle(vehicle: InvestigatedVehicle, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return vehicle.display_name.toLowerCase().includes(needle) || vehicle.vehicle_code.toLowerCase().includes(needle);
}
