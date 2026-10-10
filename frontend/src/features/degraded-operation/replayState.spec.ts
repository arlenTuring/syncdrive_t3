import { describe, expect, it } from "vitest";
import type { ParameterChange, ReplayFrame } from "./api";
import {
  gapAt,
  orderOverrideFrom,
  parametersAt,
  stateAt,
  stateFromSnapshot,
  typicalTelemetryInterval,
  visibleVehicles,
} from "./replayState";

let seq = 0;
function frame(
  stream: ReplayFrame["stream"],
  code: string | null,
  operatingAt: number,
  payload: Record<string, unknown>,
  extra: Partial<ReplayFrame> = {},
): ReplayFrame {
  seq += 1;
  return {
    seq,
    stream,
    kind: "live",
    vehicle_code: code,
    topic: null,
    received_at: operatingAt,
    operating_at: operatingAt,
    vehicle_ts: operatingAt,
    payload,
    ...extra,
  };
}

const T0 = 1_000_000;

describe("replay state reconstruction", () => {
  const initial = [
    frame("telemetry", "PMS01", T0, { x: 1 }, { kind: "initial" }),
    frame("operation", "PMS01", T0, { order_id: "A", vehicle_phase: "DWELLING" }, { kind: "initial" }),
  ];
  const live = [
    frame("telemetry", "PMS01", T0 + 1_000, { x: 2 }),
    frame("operation", "PMS01", T0 + 1_500, { order_id: "A", vehicle_phase: "RUNNING" }),
    frame("telemetry", "PMS01", T0 + 2_000, { x: 3 }),
    frame("operation", "PMS01", T0 + 3_000, { order_id: "B", vehicle_phase: "RUNNING" }),
    frame("telemetry", "PMS01", T0 + 3_000, { x: 4 }),
  ];
  const base = stateFromSnapshot(initial, null);

  it("applies only frames not later than T — no future arrivals or task switches", () => {
    const at = stateAt(base, live, T0 + 1_999);
    expect(at.telemetry.get("PMS01")?.payload).toEqual({ x: 2 });
    expect(at.operation.get("PMS01")?.payload).toEqual({ order_id: "A", vehicle_phase: "RUNNING" });
  });

  it("rebuilds from the start when dragged backwards, leaving no later state behind", () => {
    const later = stateAt(base, live, T0 + 3_000);
    expect(later.operation.get("PMS01")?.payload.order_id).toBe("B");
    const earlier = stateAt(base, live, T0 + 500);
    expect(earlier.telemetry.get("PMS01")?.payload).toEqual({ x: 1 });
    expect(earlier.operation.get("PMS01")?.payload.order_id).toBe("A");
    // 起點本身沒有被改
    expect(base.telemetry.get("PMS01")?.payload).toEqual({ x: 1 });
  });

  it("orders frames at the same operating time by seq", () => {
    const sameTime = [
      frame("telemetry", "PMS02", T0 + 10, { x: "first" }),
      frame("telemetry", "PMS02", T0 + 10, { x: "second" }),
    ];
    expect(stateAt(base, sameTime, T0 + 10).telemetry.get("PMS02")?.payload.x).toBe("second");
  });

  it("hides a vehicle whose last frame is before a data gap instead of carrying it across", () => {
    const state = stateAt(base, live, T0 + 2_000);
    const gaps = [
      { from_real: 0, to_real: 0, from_operating: T0 + 2_100, to_operating: T0 + 2_900, reason: "backend_restart" },
    ];
    expect(visibleVehicles(state, T0 + 2_050, gaps, 5_000).vehicles.map((v) => v.code)).toEqual(["PMS01"]);
    const during = visibleVehicles(state, T0 + 2_500, gaps, 5_000);
    expect(during.vehicles).toHaveLength(0);
    expect(during.hidden).toEqual([{ code: "PMS01", reason: "gap" }]);
    expect(gapAt(gaps, T0 + 2_500)?.reason).toBe("backend_restart");
    expect(gapAt(gaps, T0 + 3_000)).toBeNull();
  });

  it("marks a vehicle stale when other data kept arriving but it stopped reporting", () => {
    const frames = [
      ...live.slice(0, 1),
      frame("telemetry", "PMS03", T0 + 9_000, { x: 9 }, { received_at: T0 + 9_000 }),
    ];
    const state = stateAt(base, frames, T0 + 9_000);
    const result = visibleVehicles(state, T0 + 9_000, [], 5_000);
    expect(result.vehicles.map((v) => v.code)).toEqual(["PMS03"]);
    expect(result.hidden).toEqual([{ code: "PMS01", reason: "stale" }]);
  });

  it("uses only stored order snapshots for route stations", () => {
    const orders = [
      frame("order", "PMS01", T0, { order_id: "A", stations: ["S1", "S2"], transition_purpose: "exit" }, { topic: "A" }),
    ];
    const override = orderOverrideFrom(stateFromSnapshot(orders, null));
    expect(override.stationsById).toEqual({ A: ["S1", "S2"] });
    expect(override.metaById.A.transitionPurpose).toBe("exit");
  });

  it("measures the typical telemetry interval per vehicle", () => {
    expect(typicalTelemetryInterval(live)).toBe(1_000);
  });
});

describe("parameters at the replay cursor", () => {
  const change = (
    action: string,
    effective: number | null,
    level: number | null,
    speed: number | null,
  ): ParameterChange => ({
    event_id: action + effective,
    action,
    operator_id: "tester",
    operated_at_real: effective ?? 0,
    effective_at_operating: effective,
    level,
    speed_limit_kmh: speed,
    previous_level: null,
    previous_speed_limit_kmh: null,
    control: { result: "not_dispatched", dispatched_at_real: null, reason: null },
  });
  const changes = [
    change("immediate_submitted", T0, 3, 30),
    change("parameters_adjusted", T0 + 15 * 60_000, 3, 20),
    change("parameters_adjusted", T0 + 20 * 60_000, 2, 15),
  ];

  it("uses the value in effect at the cursor, not the final value", () => {
    expect(parametersAt(changes, T0 - 1)).toBeNull();
    expect(parametersAt(changes, T0 + 60_000)).toMatchObject({ level: 3, speedLimitKmh: 30 });
    expect(parametersAt(changes, T0 + 16 * 60_000)).toMatchObject({ level: 3, speedLimitKmh: 20 });
    expect(parametersAt(changes, T0 + 25 * 60_000)).toMatchObject({ level: 2, speedLimitKmh: 15 });
  });

  it("ignores changes that never took effect", () => {
    expect(
      parametersAt([change("schedule_submitted", null, 1, 5), ...changes], T0 + 60_000),
    ).toMatchObject({ level: 3, speedLimitKmh: 30 });
  });
});
