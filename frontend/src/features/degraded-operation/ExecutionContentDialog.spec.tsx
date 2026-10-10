// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveDraft = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("./api", () => ({ saveDegradedDraft: saveDraft }));

import { ExecutionContentDialog } from "./ActiveExecutionDialogs";
import type { ExecutionResponse } from "./api";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const execution = {
  execution_id: "execution-1",
  name: "天災降速行駛",
  description: "原說明",
  level: 3,
  speed_limit_kmh: 30,
  version: 4,
} as ExecutionResponse;

describe("ExecutionContentDialog", () => {
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("has no level field, shows the current speed read-only and submits only name and description", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <ExecutionContentDialog execution={execution} onClose={() => undefined} onSubmit={onSubmit} />,
      );
    });
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("計畫等級");
    expect(document.querySelector("select")).toBeNull();
    expect(text).toContain("速限30km/h");
    expect(document.querySelector('img[src="/dowgrade-operation-icons/speed_limit.svg"]')).not.toBeNull();

    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("天災降速行駛", "原說明");
    expect(onSubmit.mock.calls[0]).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    const draft = saveDraft.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(draft).toEqual({ execution_id: "execution-1", name: "天災降速行駛", description: "原說明" });
  });
});
