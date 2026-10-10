import { describe, expect, it } from "vitest";
import { emptyPlanDraft, planDraftPayload } from "./DegradedPlanForm";

describe("degraded plan form validation", () => {
  it("accepts an optional blank description and stopped speed 0", () => {
    expect(
      planDraftPayload({ ...emptyPlanDraft(), name: "  停駛計畫  " }),
    ).toEqual({
      name: "停駛計畫",
      description: "",
      level: 3,
      speed_limit_kmh: 0,
    });
  });

  it("accepts non-shortcut speeds but rejects blank names and invalid custom speeds", () => {
    expect(
      planDraftPayload({
        ...emptyPlanDraft(),
        name: "自定義",
        speedMode: "custom",
        customSpeed: "55",
      })?.speed_limit_kmh,
    ).toBe(55);
    expect(planDraftPayload({ ...emptyPlanDraft(), name: "  " })).toBeNull();
    expect(
      planDraftPayload({
        ...emptyPlanDraft(),
        name: "錯誤",
        speedMode: "custom",
        customSpeed: "0",
      }),
    ).toBeNull();
  });
});
