import { describe, expect, it } from "vitest";
import { investigatedPositionReason, mergeDisplayState } from "./investigation";
import { stateFromSnapshot, type ReplayFrame } from "./replayState";

const f = (seq: string, stream: string, code: string | null, key?: string): ReplayFrame => ({
  seq,
  t: 1000,
  stream,
  stream_key: key ?? `${stream}|${code}`,
  vehicle_code: code,
  topic: null,
  received_at: 1000,
  operating_at: 1000,
  vehicle_ts: 1000,
  source: "mqtt",
  payload: { seq },
});

describe("調查載具與背景車隊", () => {
  const investigated = stateFromSnapshot([f("1", "telemetry", "PMS01"), f("2", "map", null, "map|active")], null);
  // 背景照理不含調查載具；就算有，也不採用
  const background = stateFromSnapshot([f("3", "telemetry", "PMS02"), f("4", "telemetry", "PMS01"), f("5", "map", null, "map|active")], null);

  it("調查載具的資料只取調查那一份，背景的地圖參照優先（跟著游標）", () => {
    const merged = mergeDisplayState(investigated, background, "PMS01")!;
    expect(merged.telemetry.get("PMS01")?.seq).toBe("1");
    expect(merged.telemetry.get("PMS02")?.seq).toBe("3");
    expect(merged.byKey.get("telemetry|PMS01")?.seq).toBe("1");
    expect(merged.byKey.get("map|active")?.seq).toBe("5");
    // 背景還沒載入：用調查載具起點快照附的地圖參照
    expect(mergeDisplayState(investigated, null, "PMS01")!.byKey.get("map|active")?.seq).toBe("2");
  });

  it("調查載具沒有位置時給原因，不改用別台車", () => {
    const noTelemetry = stateFromSnapshot([f("9", "operation", "PMS01")], null);
    expect(investigatedPositionReason(noTelemetry, "PMS01", false, null)).toEqual({ state: "missing", reason: expect.stringContaining("沒有保存這台車的遙測") });
    expect(investigatedPositionReason(investigated, "PMS01", false, "gap").state).toBe("missing");
    expect(investigatedPositionReason(investigated, "PMS01", true, null)).toEqual({ state: "visible" });
  });
});
