// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { VehicleDataPanel } from "./VehicleDataPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(props: Record<string, unknown>) {
  const box = document.createElement("div");
  document.body.appendChild(box);
  const root = createRoot(box);
  act(() => root.render(createElement(VehicleDataPanel, { vehicleCode: "PMS01", state: null, cursor: null, staleAfterMs: 5000, hidden: [], ...props } as never)));
  return { box, unmount: () => { act(() => root.unmount()); box.remove(); } };
}

describe("車輛資料面板的兩種用法", () => {
  it("運行管理紀錄：固定調查載具，唯讀，沒有切車選單", () => {
    const { box, unmount } = render({ investigated: { displayName: "甲車", vehicleCode: "PMS01" } });
    expect(box.querySelector("select")).toBeNull();
    expect(box.textContent).toContain("調查載具：甲車");
    unmount();
  });

  it("歷史降級播放器：維持原本可以在面板上切車", () => {
    const { box, unmount } = render({ vehicles: ["PMS01", "PMS02"], onSelect: () => undefined });
    const select = box.querySelector<HTMLButtonElement>('#replay-vehicle-select')!;
    act(() => select.click());
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent?.trim())).toEqual(["PMS01", "PMS02"]);
    unmount();
  });
});
