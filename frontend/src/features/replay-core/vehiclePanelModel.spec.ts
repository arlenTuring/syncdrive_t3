import { describe, expect, it } from "vitest";
import { stateFromSnapshot, type ReplayFrame } from "./replayState";
import { buildPanelSections, countLeaves, filterNodes, streamStatuses, type FieldNode } from "./vehiclePanelModel";
import { zonedInputToIso } from "./time";

const T = 1_790_000_000_000;

function frame(stream: string, payload: Record<string, unknown>, extra: Partial<ReplayFrame> = {}): ReplayFrame {
  return {
    seq: String(Math.floor(Math.random() * 1e9)),
    t: T,
    stream,
    stream_key: `${stream}|PMS01`,
    vehicle_code: "PMS01",
    topic: null,
    received_at: T,
    operating_at: T,
    vehicle_ts: T,
    source: "mqtt",
    payload,
    ...extra,
  };
}

function find(nodes: readonly FieldNode[], path: string): FieldNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = find(node.children, path);
    if (child) return child;
  }
  return undefined;
}

describe("vehicle data panel", () => {
  const telemetry = frame(
    "telemetry",
    {
      vehicle_code: "PMS-01",
      timestamp: T - 20,
      kinematics: { velocity: 0, acceleration: null },
      signals: { hazard_light: false, turn_indicator: "" },
      actuation_feedback: { gear: "D" },
      prediction: { path: [] },
      vendor_extra: { foo: { bar: 1 } },
    },
    { derived: { location: { label: "D1" } } },
  );
  const operation = frame("operation", {
    vehicle_code: "PMS01",
    order_id: "A1",
    task_group: [
      { task_id: "t1", task_name: "OPEN_DOORS", status: "COMPLETED" },
      { task_id: "t2", task_name: "CLOSE_DOORS", status: "PENDING", note: "" },
    ],
  });
  const state = stateFromSnapshot([telemetry, operation], null);
  const sections = buildPanelSections(state, "PMS01");
  const all = sections.flatMap((section) => section.nodes);

  it("shows every field, keeping unknown ones with their raw path", () => {
    const unknown = find(all, "vendor_extra.foo.bar");
    expect(unknown).toMatchObject({ label: null, kind: "number", value: 1 });
    expect(sections.find((section) => section.category === "other")?.nodes.map((node) => node.path)).toContain("vendor_extra");
    // 原始內容照存：車號是車端寫法，不被正規化
    expect(find(all, "vehicle_code")?.value).toBe("PMS-01");
  });

  it("tells missing, null, empty, zero and false apart", () => {
    expect(find(all, "kinematics.velocity")).toMatchObject({ kind: "number", value: 0, unit: "m/s" });
    expect(find(all, "kinematics.acceleration")?.kind).toBe("null");
    expect(find(all, "signals.hazard_light")).toMatchObject({ kind: "boolean", value: false });
    expect(find(all, "signals.turn_indicator")?.kind).toBe("empty-string");
    expect(find(all, "prediction.path")?.kind).toBe("empty-array");
    // 文件規定、這筆沒有的欄位
    expect(find(all, "energy")?.kind).toBe("missing");
    expect(find(all, "trip_code")?.kind).toBe("missing");
  });

  it("lists array items one by one with Chinese labels and enum meanings", () => {
    const tasks = find(all, "task_group")!;
    expect(tasks.children).toHaveLength(2);
    expect(tasks.children[0].label).toContain("第 1 項（OPEN_DOORS）");
    expect(find(all, "task_group[1].status")).toMatchObject({ label: "任務狀態", valueText: "未抵達節點" });
    expect(find(all, "actuation_feedback.gear")?.valueText).toBe("前進");
  });

  it("keeps the backend-derived location separate from the raw payload", () => {
    const pose = sections.find((section) => section.category === "pose")!;
    expect(pose.nodes.some((node) => node.label?.includes("衍生"))).toBe(true);
  });

  it("filters by label, raw path or value", () => {
    const tasks = sections.find((section) => section.category === "tasks")!.nodes;
    // 值的中文也搜得到；上層名稱符合時整個項目留下
    expect(countLeaves(filterNodes(tasks, "未抵達"))).toBe(1);
    expect(countLeaves(filterNodes(tasks, "CLOSE_DOORS"))).toBe(4);
    expect(filterNodes(all, "vendor_extra.foo").length).toBe(1);
  });

  it("reports each stream's own time and staleness, and says why data is missing", () => {
    const statuses = streamStatuses(state, "PMS01", T + 8_000, 5_000, { healthKeepaliveMs: 10_000 });
    const byStream = Object.fromEntries(statuses.map((status) => [status.stream, status]));
    expect(byStream.telemetry).toMatchObject({ stale: true, ageMs: 8_000 });
    expect(byStream.health).toMatchObject({ frame: null, stale: false });
    expect(byStream.health.note).toContain("沒有保存");
  });
});

describe("time zone input", () => {
  it("turns a Taipei local date-time into an explicit +08:00 ISO string", () => {
    expect(zonedInputToIso("2026-10-15T08:00")).toBe("2026-10-15T08:00:00+08:00");
    expect(zonedInputToIso("2026-10-15T08:00:05", "UTC")).toBe("2026-10-15T08:00:05+00:00");
    expect(zonedInputToIso("not a date")).toBeNull();
  });
});
