import { describe, expect, it } from "vitest";
import type { RangeResolution } from "./api";
import { appliedVehicle, checkRangeDraft, draftDiffers, matchVehicle, type Resolved } from "./queryConditions";

const A = { id: "11111111-1111-4111-8111-111111111111", vehicle_code: "PMS01", display_name: "甲車", is_active: true };
const NOW = Date.parse("2026-10-15T12:00:00+08:00");
const draft = { vehicleId: A.id, from: "2026-10-15T08:00", to: "2026-10-15T09:00", timeZone: "Asia/Taipei" };

describe("查詢條件", () => {
  it("沒選調查載具或時間不合法就不能送出", () => {
    expect(checkRangeDraft({ ...draft, vehicleId: null }, NOW)).toEqual({ ok: false, error: "請選擇調查載具" });
    expect(checkRangeDraft({ ...draft, to: "2026-10-15T07:00" }, NOW)).toMatchObject({ ok: false });
    expect(checkRangeDraft({ ...draft, to: "2026-10-15T21:00" }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("12 小時") });
    expect(checkRangeDraft({ ...draft, from: "2026-10-15T13:00", to: "2026-10-15T14:00" }, NOW)).toMatchObject({ ok: false });
    expect(checkRangeDraft(draft, NOW)).toEqual({ ok: true, vehicleId: A.id, fromIso: "2026-10-15T08:00:00+08:00", toIso: "2026-10-15T09:00:00+08:00" });
  });

  it("分得出待查詢條件與已套用條件", () => {
    const resolved: Resolved = {
      id: "r1",
      kind: "range",
      value: {
        vehicle: A,
        window: { from_real: Date.parse("2026-10-15T08:00:00+08:00"), to_real: Date.parse("2026-10-15T09:00:00+08:00"), requested_to_real: Date.parse("2026-10-15T09:00:00+08:00"), ongoing: false },
      } as RangeResolution,
    };
    expect(draftDiffers(draft, resolved)).toBe(false);
    expect(draftDiffers({ ...draft, vehicleId: "22222222-2222-4222-8222-222222222222" }, resolved)).toBe(true);
    expect(draftDiffers({ ...draft, to: "2026-10-15T09:30" }, resolved)).toBe(true);
    expect(appliedVehicle(resolved)).toBe(A);
    expect(appliedVehicle(null)).toBeNull();
  });

  it("以名稱或通訊代號搜尋", () => {
    expect(matchVehicle(A, "甲")).toBe(true);
    expect(matchVehicle(A, "pms01")).toBe(true);
    expect(matchVehicle(A, "PMS02")).toBe(false);
  });
});
