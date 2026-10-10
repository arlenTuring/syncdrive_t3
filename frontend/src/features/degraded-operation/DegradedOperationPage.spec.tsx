// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  plans: vi.fn(),
  status: vi.fn(),
  map: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("./api", () => ({
  fetchDegradedOperationPlans: api.plans,
  fetchDegradedOperationStatus: api.status,
  fetchActiveMapId: api.map,
  executeDegradedOperation: api.execute,
  fetchDegradedOperationPlan: vi.fn(),
  createDegradedOperationPlan: vi.fn(),
  updateDegradedOperationPlan: vi.fn(),
  deleteDegradedOperationPlan: vi.fn(),
}));
vi.mock("../dashboard/elements/MapPlatformLayer", () => ({
  MapPlatformLayer: () => <div>map</div>,
}));

import { DegradedOperationPage } from "./DegradedOperationPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DegradedOperationPage states", () => {
  let root: Root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root")!);
    api.status.mockResolvedValue({
      mode: "normal",
      updated_at: 1,
      source: "system_settings",
    });
    api.map.mockResolvedValue("map-test");
  });

  afterEach(() => act(() => root.unmount()));

  async function render() {
    await act(async () => {
      root.render(<DegradedOperationPage />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return document.body.textContent ?? "";
  }

  it("does not present an API failure as an empty plan list", async () => {
    api.plans.mockRejectedValueOnce(new Error("offline"));
    const failed = await render();
    expect(failed).toContain("Total —");
    expect(failed).toContain("降級計畫載入失敗");
    expect(failed).not.toContain("無計畫");
  });

  it("renders persisted active execution truthfully without invented impact values", async () => {
    api.plans.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
    });
    api.status.mockResolvedValue({
      mode: "degraded",
      pending: null,
      operating_now: 120_000,
      real_now: 120_000,
      updated_at: 1,
      source: "system_settings",
      active_execution: {
        execution_id: "execution-1",
        source_plan_id: null,
        name: "測試降級",
        description: "測試內容",
        level: 3,
        speed_limit_kmh: 30,
        operator_id: "tester",
        execution_status: "active",
        control_status: "not_dispatched",
        command_tracking: [],
        schedule_mode: "immediate",
        scheduled_for_operating: null,
        scheduled_timezone: "Asia/Taipei",
        started_at_operating: "60000",
        started_at_real: "60000",
        ended_at_operating: null,
        ended_at_real: null,
        restore_speed_limit_kmh: 40,
        restore_checks: null,
        error_reason: null,
        version: 1,
        created_at: "60000",
        updated_at: "60000",
        message: "",
      },
    });
    const rendered = await render();
    expect(rendered).toContain("降級運轉中　Level 3");
    expect(rendered).toContain("持續時間 00:01:00");
    expect(rendered).toContain("控制結果：未下發");
    expect(rendered).toContain("— %");
    expect(rendered).not.toContain("21 %");
  });
});
