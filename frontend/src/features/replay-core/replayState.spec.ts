import { describe, expect, it } from "vitest";
import { compareSeq, cursorOrder, frameAtOrBefore, frameOrder } from "./cursor";
import {
  lastAppliedIndex,
  nextFrameCursor,
  positionInMillisecond,
  prevFrameCursor,
  stateAt,
  stateFromSnapshot,
  type ReplayFrame,
} from "./replayState";

function frame(seq: string, t: number, stream: string, code: string | null, payload: Record<string, unknown>, extra: Partial<ReplayFrame> = {}): ReplayFrame {
  return {
    seq,
    t,
    stream,
    vehicle_code: code,
    topic: null,
    received_at: t,
    operating_at: t,
    vehicle_ts: t,
    source: "mqtt",
    payload,
    ...extra,
  };
}

describe("cursor ordering", () => {
  it("compares bigint sequence numbers as exact decimal strings", () => {
    // 2^53 + 1 與 2^53：轉成 Number 會相等，字串比較不會
    expect(compareSeq("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
    expect(Number("9007199254740993")).toBe(Number("9007199254740992"));
    expect(compareSeq("10", "9")).toBeGreaterThan(0);
    expect(compareSeq("007", "7")).toBe(0);
  });

  it("orders by time, then by seq within the same millisecond", () => {
    const a = { t: 100, seq: "5" };
    const b = { t: 100, seq: "6" };
    const c = { t: 101, seq: "1" };
    expect([c, b, a].sort(frameOrder)).toEqual([a, b, c]);
  });

  it("treats a whole-millisecond cursor as after every frame in that millisecond", () => {
    expect(frameAtOrBefore({ t: 100, seq: "999" }, { t: 100, seq: null })).toBe(true);
    expect(frameAtOrBefore({ t: 100, seq: "6" }, { t: 100, seq: "5" })).toBe(false);
    expect(cursorOrder({ t: 100, seq: null }, { t: 100, seq: "999" })).toBeGreaterThan(0);
  });
});

describe("frame stepping", () => {
  const T = 1_000_000;
  const base = stateFromSnapshot([frame("1", T, "telemetry", "PMS01", { x: 0 })], null);
  // 同一毫秒兩筆（不同車），各自是一幀
  const frames = [
    frame("10", T + 100, "telemetry", "PMS01", { x: 1 }),
    frame("11", T + 100, "telemetry", "PMS02", { x: 7 }),
    frame("12", T + 200, "operation", "PMS01", { order_id: "A" }),
    frame("13", T + 300, "telemetry", "PMS01", { x: 2 }),
  ];
  const baseCursor = { t: T, seq: null };

  it("steps one stored record at a time, including records in the same millisecond", () => {
    let cursor = nextFrameCursor(frames, baseCursor)!;
    expect(cursor).toEqual({ t: T + 100, seq: "10" });
    let state = stateAt(base, frames, cursor);
    expect(state.telemetry.get("PMS01")?.payload).toEqual({ x: 1 });
    // 同一毫秒的第二筆還沒套用
    expect(state.telemetry.has("PMS02")).toBe(false);
    expect(positionInMillisecond(frames, state.last)).toEqual({ index: 1, total: 2 });

    cursor = nextFrameCursor(frames, cursor)!;
    expect(cursor).toEqual({ t: T + 100, seq: "11" });
    state = stateAt(base, frames, cursor);
    expect(state.telemetry.get("PMS02")?.payload).toEqual({ x: 7 });
    expect(positionInMillisecond(frames, state.last)).toEqual({ index: 2, total: 2 });
  });

  it("steps back by rebuilding from the start snapshot, leaving nothing from later frames", () => {
    const at = { t: T + 300, seq: "13" };
    const later = stateAt(base, frames, at);
    expect(later.telemetry.get("PMS01")?.payload).toEqual({ x: 2 });
    const back = prevFrameCursor(frames, at, baseCursor);
    expect(back).toEqual({ t: T + 200, seq: "12" });
    const state = stateAt(base, frames, back as { t: number; seq: string });
    expect(state.telemetry.get("PMS01")?.payload).toEqual({ x: 1 });
    expect(state.operation.get("PMS01")?.payload).toEqual({ order_id: "A" });
    // 起點狀態本身沒有被改
    expect(base.telemetry.get("PMS01")?.payload).toEqual({ x: 0 });
  });

  it("returns the start cursor before the first loaded frame, and 'outside' when already at the start", () => {
    expect(prevFrameCursor(frames, { t: T + 100, seq: "10" }, baseCursor)).toBe(baseCursor);
    expect(prevFrameCursor(frames, baseCursor, baseCursor)).toBe("outside");
  });

  it("has no next frame at the end of the loaded data (the player asks the server instead of skipping)", () => {
    expect(nextFrameCursor(frames, { t: T + 300, seq: "13" })).toBeNull();
    expect(lastAppliedIndex(frames, { t: T + 250, seq: null })).toBe(2);
  });

  it("keeps a rejected (stale or duplicate) message as its own frame without changing state", () => {
    const rejected = frame("14", T + 400, "telemetry", "PMS01", { x: -1 }, { derived: { rejected: "stale_or_duplicate" } });
    const state = stateAt(base, [...frames, rejected], { t: T + 400, seq: "14" });
    expect(state.last?.seq).toBe("14");
    expect(state.telemetry.get("PMS01")?.payload).toEqual({ x: 2 });
  });

  it("does not let an older frame overwrite a newer one for the same source", () => {
    const state = stateFromSnapshot(
      [frame("20", T + 50, "telemetry", "PMS03", { x: "new" }), frame("19", T + 40, "telemetry", "PMS03", { x: "old" })],
      null,
    );
    expect(state.telemetry.get("PMS03")?.payload.x).toBe("new");
    expect(state.last).toBeNull();
  });
});
