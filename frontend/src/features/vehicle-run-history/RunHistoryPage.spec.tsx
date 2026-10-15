// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayFrame } from "../replay-core/replayState";
import { zonedInputToIso } from "../replay-core/time";
import type { InvestigatedVehicle } from "./api";
import { createFakeHistoryBackend, type FakeBackend } from "./__tests__/fakeHistoryBackend";
import { RunHistoryPage } from "./RunHistoryPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 地圖層換成紀錄 props 的替身：驗證餵給地圖的車、高亮對象、有沒有點選處理 */
type MapProps = {
  vehicles: Array<{ code: string; telemetry: ReplayFrame }>;
  selectedVehicle: string | null;
  highlight?: string;
  onSelectVehicle?: unknown;
  state: { telemetry: Map<string, ReplayFrame> } | null;
};
const mapCalls: MapProps[] = [];
vi.mock("../replay-core/ReplayMapLayer", () => ({
  ReplayMapLayer: (props: MapProps) => {
    mapCalls.push(props);
    return createElement("div", { "data-testid": "map" });
  },
}));
vi.mock("../degraded-operation/MapViewport", () => ({
  MapViewport: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const A: InvestigatedVehicle = { id: "11111111-1111-4111-8111-111111111111", vehicle_code: "PMS01", display_name: "甲車", is_active: true };
const B: InvestigatedVehicle = { id: "22222222-2222-4222-8222-222222222222", vehicle_code: "PMS02", display_name: "乙車", is_active: false };
const T0 = Math.floor(Date.now() / 1000) * 1000 - 30 * 60_000;

function frame(seq: number, dt: number, stream: string, vehicle: InvestigatedVehicle | null, payload: Record<string, unknown> = {}): ReplayFrame {
  const code = vehicle?.vehicle_code ?? null;
  return {
    seq: String(seq),
    t: T0 + dt,
    stream,
    stream_key: vehicle ? `${stream}|${code}` : `${stream}|active`,
    vehicle_code: code,
    topic: null,
    order_id: null,
    received_at: T0 + dt,
    operating_at: T0 + dt,
    vehicle_ts: T0 + dt,
    source: vehicle ? "mqtt" : "system",
    payload: { vehicle_code: code, ...payload },
    derived: null,
  };
}
const tel = (x: number) => ({ local_pose: { position: { x, y: 0 } }, energy: { battery_level: x } });

/** A、B 交錯，A 在同一毫秒有兩筆（遙測＋健康） */
const INTERLEAVED: ReplayFrame[] = [
  frame(99, -100, "map", null, { map_hash: "a".repeat(64), map_id: "m1" }),
  frame(101, 1000, "telemetry", A, tel(1)),
  frame(102, 1000, "telemetry", B, tel(901)),
  frame(103, 1500, "operation", A, { order_id: "OA" }),
  frame(104, 2000, "telemetry", B, tel(902)),
  frame(105, 3000, "telemetry", A, tel(3)),
  frame(106, 3000, "health", A, { overall_health: "OK" }),
  frame(107, 3000, "operation", B, { order_id: "OB" }),
  frame(108, 4000, "telemetry", A, tel(4)),
  frame(109, 5000, "telemetry", B, tel(905)),
  frame(110, 6000, "operation", A, { order_id: "OA" }),
  frame(111, 7000, "telemetry", A, tel(7)),
];
const A_SEQS = ["101", "103", "105", "106", "108", "110", "111"];

let root: Root | null = null;
let box: HTMLDivElement | null = null;
let backend: FakeBackend;

beforeEach(() => {
  mapCalls.length = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  root = null;
  vi.unstubAllGlobals();
});

function mount(frames = INTERLEAVED, shifts?: Parameters<typeof createFakeHistoryBackend>[0]["shifts"]) {
  backend = createFakeHistoryBackend({ vehicles: [A, B], frames, pageSize: 3, shifts });
  vi.stubGlobal("fetch", backend.fetch);
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(createElement(RunHistoryPage)));
}

async function settle(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function byLabel<T extends HTMLElement>(label: string): T {
  const node = box!.querySelector(`[aria-label="${label}"]`);
  if (!node) throw new Error(`找不到 ${label}`);
  return node as T;
}
const submitButton = () => [...box!.querySelectorAll("button[type=submit]")][0] as HTMLButtonElement;

async function chooseVehicle(vehicle: InvestigatedVehicle) {
  const input = byLabel<HTMLInputElement>("調查載具");
  act(() => input.blur());
  act(() => input.focus());
  await settle(2);
  const option = [...box!.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes(vehicle.display_name)) as HTMLElement;
  act(() => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

async function query(vehicle: InvestigatedVehicle) {
  await chooseVehicle(vehicle);
  act(() => submitButton().click());
  await settle();
}

const currentSeq = () => /seq (\d+)/.exec(box!.textContent ?? "")?.[1] ?? null;
const panelText = () => (box!.querySelector('[aria-label$="車輛資料"][class*="text-sm"]') as HTMLElement | null)?.textContent ?? "";

async function step(dir: "上一幀" | "下一幀") {
  act(() => byLabel<HTMLButtonElement>(dir).click());
  await settle(6);
}

describe("運行管理紀錄：固定調查載具", () => {
  it("結束時間的「此刻」按鈕會依目前時區填入現在", async () => {
    mount();
    await settle(3);
    const nowButton = [...box!.querySelectorAll("button")].find((node) => node.textContent?.trim() === "此刻") as HTMLButtonElement;
    const before = Date.now();
    act(() => nowButton.click());
    await settle(1);
    const after = Date.now();
    const endInput = [...box!.querySelectorAll('input[type="datetime-local"]')][1] as HTMLInputElement;
    expect(endInput.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?$/);
    const filled = Date.parse(zonedInputToIso(endInput.value.replace(/\.000$/, ""), "Asia/Taipei")!);
    expect(filled).toBeGreaterThanOrEqual(before - 1000);
    expect(filled).toBeLessThanOrEqual(after);
  });

  it("1. 時間區間模式沒選載具不能查詢", async () => {
    mount();
    await settle(3);
    expect(submitButton().disabled).toBe(true);
    expect(box!.textContent).toContain("請選擇調查載具");
    await chooseVehicle(A);
    expect(submitButton().disabled).toBe(false);
  });

  it("2、3、4、7. 查 A 之後：面板只有 A、逐幀只走 A 的紀錄（含同毫秒兩筆）、沒有切車選單", async () => {
    mount();
    await settle(3);
    await query(A);
    // 已套用條件與畫面都明確標示調查載具
    expect(box!.querySelector('[data-testid="applied-vehicle"]')?.textContent).toContain("甲車");
    expect(box!.querySelector('[data-testid="investigated-vehicle"]')?.textContent).toContain("甲車");
    expect(box!.querySelector("#replay-vehicle-select")).toBeNull();
    // 車輛資料區沒有任何下拉選單（畫面上其他 select 只有查詢表單的時區與播放倍速）
    const panel = box!.querySelector('[data-testid="investigated-vehicle"]')!.closest('[aria-label$="車輛資料"]')!;
    expect(panel.querySelector("select")).toBeNull();
    expect([...box!.querySelectorAll("select")].map((node) => node.getAttribute("aria-label") ?? "時區").sort()).toEqual(["回放倍速", "時區"]);
    const visited: string[] = [];
    for (let index = 0; index < A_SEQS.length + 2; index += 1) {
      await step("下一幀");
      const seq = currentSeq()!;
      if (visited.at(-1) !== seq) visited.push(seq);
      // 面板的資料時間、序號都是 A 的，沒有 B 的序號
      expect(panelText()).not.toMatch(/\b(102|104|107|109)\b/);
    }
    expect(visited).toEqual(A_SEQS);
    expect(box!.textContent).toContain("已是最後一幀");
    // 同一毫秒兩筆：位置顯示 1／2、2／2 時曾分別停過（逐筆往回確認）
    for (const expected of [...A_SEQS].reverse().slice(1)) {
      await step("上一幀");
      expect(currentSeq()).toBe(expected);
    }
  });

  it("5. 跨分頁、往回跳轉與預取不漏幀，也不向後端要全系統資料", async () => {
    mount();
    await settle(3);
    await query(A);
    const vehicleFrameCalls = backend.calls.filter((call) => call.startsWith("frames?") && call.includes("scope=vehicle"));
    expect(vehicleFrameCalls.length).toBeGreaterThan(0);
    // 每個調查請求都帶穩定識別
    for (const call of backend.calls.filter((item) => /^(snapshot|frames|neighbor)\?/.test(item))) expect(call).toContain(`vehicle_id=${A.id}`);
    // 往後走到第 5 筆，拖回起點，再一路往後：序列一致
    for (let index = 0; index < 5; index += 1) await step("下一幀");
    const slider = byLabel<HTMLInputElement>("回放時間軸");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(slider, "0");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    const visited: string[] = [];
    for (let index = 0; index < A_SEQS.length; index += 1) {
      await step("下一幀");
      visited.push(currentSeq()!);
    }
    expect(visited).toEqual(A_SEQS);
  });

  it("6、12. 地圖：A 持續高亮、沒有點選處理；背景有 B 但不讀游標之後的資料、不影響幀數", async () => {
    mount();
    await settle(3);
    await query(A);
    await step("下一幀"); // A 的第一筆 101（同毫秒 B 的 102 序號較大，還不能出現）
    await settle(10);
    const last = mapCalls.at(-1)!;
    expect(last.selectedVehicle).toBe("PMS01");
    expect(last.highlight).toBe("investigated");
    expect(last.onSelectVehicle).toBeUndefined();
    expect(last.vehicles.map((item) => item.code)).toEqual(["PMS01"]);
    await step("下一幀"); // 103 @1500：背景 B 的 102 已經發生
    await settle(10);
    const later = mapCalls.at(-1)!;
    expect(later.vehicles.map((item) => item.code).sort()).toEqual(["PMS01", "PMS02"]);
    const b = later.vehicles.find((item) => item.code === "PMS02")!;
    expect(b.telemetry.seq).toBe("102"); // 不是之後的 104
    expect(later.selectedVehicle).toBe("PMS01");
    // 地圖上只標示調查載具；名稱與代號不同時各寫一次
    expect(box!.querySelector('[data-testid="stage-investigated"]')?.textContent).toBe("調查載具：甲車PMS01");
    expect(box!.textContent).not.toContain("背景車隊");
  });

  it("8. A 沒有位置時說明原因，不改顯示 B", async () => {
    const frames = [
      INTERLEAVED[0],
      frame(201, 1000, "operation", A, { order_id: "OA" }),
      frame(202, 1100, "telemetry", B, tel(900)),
      frame(203, 2000, "operation", A, { order_id: "OA" }),
    ];
    mount(frames);
    await settle(3);
    await query(A);
    await step("下一幀");
    await settle(10);
    expect(box!.querySelector('[data-testid="stage-investigated"]')?.textContent).toContain("無有效位置：游標之前沒有保存這台車的遙測");
    expect(mapCalls.at(-1)!.selectedVehicle).toBe("PMS01");
    expect(panelText()).toContain("甲車");
    expect(panelText()).not.toContain("乙車");
  });

  it("9、10. 改表單不影響已套用的 A；重新查 B 後 A 的延遲回應不會蓋掉", async () => {
    mount();
    await settle(3);
    await query(A);
    await chooseVehicle(B);
    await settle(2);
    expect(box!.textContent).toContain("待查詢：條件已修改，尚未套用");
    expect(box!.querySelector('[data-testid="applied-vehicle"]')?.textContent).toContain("甲車");
    expect(box!.querySelector('[data-testid="investigated-vehicle"]')?.textContent).toContain("甲車");
    // 先送 A（慢），立刻送 B（快）：最後套用的是 B
    await chooseVehicle(A);
    backend.delay(`vehicle_id=${A.id}`, 300);
    act(() => submitButton().click());
    await chooseVehicle(B);
    act(() => submitButton().click());
    await settle(30);
    expect(box!.querySelector('[data-testid="applied-vehicle"]')?.textContent).toContain("乙車");
    expect(box!.querySelector('[data-testid="investigated-vehicle"]')?.textContent).toContain("乙車");
    await step("下一幀");
    expect(["102", "104", "107", "109"]).toContain(currentSeq());
    expect(mapCalls.at(-1)!.selectedVehicle).toBe("PMS02");
  });

  it("11. 班次唯一碼：固定該次執行的車；涉及多台時先選，不自動挑第一台", async () => {
    mount(INTERLEAVED, {
      "ORD-1@1791000000000": { vehicleCodes: ["PMS02"], from: T0, to: T0 + 8000 },
      "ORD-2@1791000000000": { vehicleCodes: ["PMS01", "PMS02"], from: T0, to: T0 + 8000 },
    });
    await settle(3);
    const shiftTab = [...box!.querySelectorAll('[role="radio"]')].find((node) => node.textContent?.includes("指定班次")) as HTMLElement;
    act(() => shiftTab.click());
    const codeInput = box!.querySelector('input[placeholder^="例："]') as HTMLInputElement;
    const typeCode = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(codeInput, value);
        codeInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => submitButton().click());
      await settle();
    };
    await typeCode("ORD-1@1791000000000");
    expect(box!.querySelector('[data-testid="applied-vehicle"]')?.textContent).toContain("乙車");
    await typeCode("ORD-2@1791000000000");
    expect(box!.textContent).toContain("請選擇");
    expect(box!.querySelector('[data-testid="applied-vehicle"]')).toBeNull();
    // 還沒選定調查載具：沒有可逐幀的播放器
    expect(box!.querySelector('[aria-label="下一幀"]')).toBeNull();
    const pick = [...box!.querySelectorAll('[aria-label="選擇調查載具"] button')].find((node) => node.textContent?.includes("甲車")) as HTMLElement;
    act(() => pick.click());
    await settle();
    expect(box!.querySelector('[data-testid="applied-vehicle"]')?.textContent).toContain("甲車");
    expect(backend.calls.some((call) => call.startsWith("resolve/shift?") && call.includes(`vehicle_id=${A.id}`))).toBe(true);
  });
});
