// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { cursorOf, frameAtOrBefore, frameOrder, type ReplayCursor } from "./cursor";
import { frameKey, stateAt, stateFromSnapshot, type ReplayFrame } from "./replayState";
import { useReplayPlayer, type ReplayPlayer, type ReplaySource } from "./useReplayPlayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = 1_790_000_000_000;
let counter = 100;
function frame(t: number, code: string, x: number): ReplayFrame {
  counter += 1;
  return {
    seq: String(counter),
    t,
    stream: "telemetry",
    vehicle_code: code,
    topic: null,
    received_at: t,
    operating_at: t,
    vehicle_ts: t,
    source: "mqtt",
    payload: { x },
  };
}

/** 假的歷史後端：每頁只給 3 筆，逼播放器跨頁 */
function fakeSource(all: ReplayFrame[], window_: { from: number; to: number }): ReplaySource & { calls: string[] } {
  const sorted = [...all].sort(frameOrder);
  const calls: string[] = [];
  const after = (frame: ReplayFrame, cursor: ReplayCursor) => !frameAtOrBefore(frame, cursor);
  return {
    key: "test",
    calls,
    window: { ...window_, ongoing: false },
    snapshot: async (cursor) => {
      calls.push(`snapshot ${cursor.t}:${cursor.seq}`);
      const latest = new Map<string, ReplayFrame>();
      for (const item of sorted) if (frameAtOrBefore(item, cursor)) latest.set(frameKey(item), item);
      return { frames: [...latest.values()], reference: null };
    },
    frames: async ({ after: from, to }) => {
      calls.push(`frames ${from.t}:${from.seq}`);
      const rows = sorted.filter((item) => after(item, from) && item.t <= to);
      const page = rows.slice(0, 3);
      const truncated = rows.length > 3;
      const last = page.at(-1);
      return { frames: page, coveredTo: truncated && last ? last.t : to, next: truncated && last ? cursorOf(last) : null };
    },
    neighbor: async (cursor, dir) => {
      calls.push(`neighbor ${dir} ${cursor.t}:${cursor.seq}`);
      if (dir === "next") return sorted.find((item) => after(item, cursor) && item.t <= window_.to) ?? null;
      // 與後端相同：游標是整毫秒時「之前」含該毫秒（(t, MAX) 之前）
      const before = (item: ReplayFrame) =>
        cursor.seq == null ? item.t <= cursor.t : frameOrder(item, { t: cursor.t, seq: cursor.seq }) < 0;
      return [...sorted].reverse().find((item) => before(item) && item.t >= window_.from) ?? null;
    },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function mount(source: ReplaySource) {
  const box: { player: ReplayPlayer | null } = { player: null };
  function Probe() {
    box.player = useReplayPlayer(source);
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Probe)));
  return box;
}

describe("useReplayPlayer stepping", () => {
  // 同一毫秒三筆、其他零散；起點之前有一筆（在起點快照裡）
  const all = [
    frame(T - 500, "PMS01", 0),
    frame(T + 100, "PMS01", 1),
    frame(T + 100, "PMS02", 2),
    frame(T + 100, "PMS03", 3),
    frame(T + 200, "PMS01", 4),
    frame(T + 300, "PMS02", 5),
    frame(T + 400, "PMS01", 6),
    frame(T + 500, "PMS03", 7),
  ];
  const window_ = { from: T, to: T + 1_000 };
  const inWindow = all.filter((item) => item.t >= window_.from).sort(frameOrder);
  const expected = (cursor: ReplayCursor) => {
    const base = stateFromSnapshot(all.filter((item) => frameAtOrBefore(item, { t: T, seq: null })), null);
    return stateAt(base, inWindow, cursor);
  };

  it("stops at the start after loading, without autoplay", async () => {
    const box = mount(fakeSource(all, window_));
    await settle();
    expect(box.player!.playing).toBe(false);
    expect(box.player!.cursor).toEqual({ t: T, seq: null });
    expect(box.player!.state?.telemetry.get("PMS01")?.payload).toEqual({ x: 0 });
  });

  it("visits every stored record once going forward, across pages, then stops at the end", async () => {
    const box = mount(fakeSource(all, window_));
    await settle();
    const visited: string[] = [];
    for (let index = 0; index < inWindow.length + 2; index += 1) {
      act(() => box.player!.stepNext());
      await settle();
      const cursor = box.player!.cursor!;
      if (!visited.includes(cursor.seq ?? "")) visited.push(cursor.seq ?? "");
      // 地圖、面板共用的狀態＝直接從頭套到這一筆的結果
      expect(box.player!.state?.telemetry).toEqual(expected(cursor).telemetry);
    }
    expect(visited).toEqual(inWindow.map((item) => item.seq));
    expect(box.player!.atEnd).toBe(true);
  });

  it("steps back one record at a time from the end, rebuilding a correct state each time", async () => {
    const box = mount(fakeSource(all, window_));
    await settle();
    act(() => box.player!.seek(T + 600));
    await settle();
    const visited: string[] = [];
    for (let index = 0; index < inWindow.length + 1; index += 1) {
      act(() => box.player!.stepPrev());
      await settle();
      const cursor = box.player!.cursor!;
      visited.push(cursor.seq ?? "start");
      expect(box.player!.state?.telemetry).toEqual(expected(cursor).telemetry);
      if (box.player!.atStart) break;
    }
    // 游標停在整毫秒時，所在那一筆是最後套用的 108；上一幀是 107，一路退到時段內第一筆 102，
    // 同一毫秒的三筆也一筆一筆退。再往前是起點之前的資料：停在 102 並標示已是第一幀
    expect([...new Set(visited)]).toEqual(inWindow.map((item) => item.seq).reverse().slice(1));
    expect(box.player!.atStart).toBe(true);
  });

  it("pauses playback when stepping", async () => {
    const box = mount(fakeSource(all, window_));
    await settle();
    act(() => box.player!.play());
    expect(box.player!.playing).toBe(true);
    act(() => box.player!.stepNext());
    await settle();
    expect(box.player!.playing).toBe(false);
    expect(box.player!.jumped).toBe(true);
  });

  it("shows the position inside a millisecond with several records", async () => {
    const box = mount(fakeSource(all, window_));
    await settle();
    act(() => box.player!.stepNext());
    await settle();
    act(() => box.player!.stepNext());
    await settle();
    expect(box.player!.framePosition).toEqual({ index: 2, total: 3 });
  });
});
