import type { OrderTaskMeta } from "../map-editor/vehicles/yardExitStaging";
import type { ParameterChange, ReplayFrame, ReplayGap } from "./api";

/**
 * 回放狀態重建（純函式）。
 *
 * 規則：從起點（指定時刻的 snapshot）開始，依（營運時間, seq）順序套用不晚於 T 的資料；
 * 每個串流只留最後一筆。T 之後的資料一筆都不看，所以不會提前出現到站、任務切換或
 * 參數變更。往回拖時從起點重新套，不沿用後面才發生的狀態。
 */
export type ReplayState = {
  telemetry: Map<string, ReplayFrame>;
  operation: Map<string, ReplayFrame>;
  health: Map<string, ReplayFrame>;
  facility: Map<string, ReplayFrame>;
  orders: Map<string, ReplayFrame>;
  /** 已套用資料中最後收到的那一筆（判斷過期用的參考時刻） */
  reference: { receivedAt: number; operatingAt: number; seq: number } | null;
};

export function emptyReplayState(): ReplayState {
  return {
    telemetry: new Map(),
    operation: new Map(),
    health: new Map(),
    facility: new Map(),
    orders: new Map(),
    reference: null,
  };
}

export function cloneReplayState(state: ReplayState): ReplayState {
  return {
    telemetry: new Map(state.telemetry),
    operation: new Map(state.operation),
    health: new Map(state.health),
    facility: new Map(state.facility),
    orders: new Map(state.orders),
    reference: state.reference ? { ...state.reference } : null,
  };
}

/** 比較兩筆資料的先後：營運時間，再看 seq（同一毫秒的穩定順序） */
export function frameOrder(a: Pick<ReplayFrame, "operating_at" | "seq">, b: Pick<ReplayFrame, "operating_at" | "seq">): number {
  return a.operating_at - b.operating_at || a.seq - b.seq;
}

/** 套用一筆（就地修改）。比目前保存的那一筆舊的不覆蓋 */
export function applyFrame(state: ReplayState, frame: ReplayFrame): void {
  const target =
    frame.stream === "telemetry"
      ? state.telemetry
      : frame.stream === "operation"
        ? state.operation
        : frame.stream === "health"
          ? state.health
          : frame.stream === "facility"
            ? state.facility
            : state.orders;
  const key =
    frame.stream === "facility" || frame.stream === "order"
      ? frame.topic ?? ""
      : frame.vehicle_code ?? "";
  if (!key) return;
  const current = target.get(key);
  if (current && frameOrder(current, frame) > 0) return;
  target.set(key, frame);
  if (
    frame.kind === "live" &&
    (!state.reference || frame.received_at >= state.reference.receivedAt)
  ) {
    state.reference = {
      receivedAt: frame.received_at,
      operatingAt: frame.operating_at,
      seq: frame.seq,
    };
  }
}

export function stateFromSnapshot(
  frames: ReplayFrame[],
  reference: { received_at: number; operating_at: number; seq: number } | null,
): ReplayState {
  const state = emptyReplayState();
  [...frames].sort(frameOrder).forEach((frame) => applyFrame(state, frame));
  state.reference = reference
    ? {
        receivedAt: reference.received_at,
        operatingAt: reference.operating_at,
        seq: reference.seq,
      }
    : state.reference;
  return state;
}

/**
 * 起點＋期間資料 → T 的狀態。frames 必須已依 frameOrder 排序。
 * 回傳新物件，不改 base。
 */
export function stateAt(base: ReplayState, frames: readonly ReplayFrame[], at: number): ReplayState {
  const state = cloneReplayState(base);
  for (const frame of frames) {
    if (frame.operating_at > at) break;
    applyFrame(state, frame);
  }
  return state;
}

export type ReplayVehicle = {
  code: string;
  telemetry: ReplayFrame;
  operation: ReplayFrame | null;
};

export type HiddenVehicle = { code: string; reason: "stale" | "gap" };

/**
 * T 當下畫得出來的車：
 * - 有遙測
 * - 那筆遙測之後、T 之前沒有落在缺段裡（缺段期間不知道它去了哪裡，不畫、不補移動）
 * - 跟最後收到的資料相比沒有過期（與即時圖台同一個門檻；斷訊的車即時畫面也不畫）
 */
export function visibleVehicles(
  state: ReplayState,
  at: number,
  gaps: readonly ReplayGap[],
  staleAfterMs: number,
): { vehicles: ReplayVehicle[]; hidden: HiddenVehicle[] } {
  const vehicles: ReplayVehicle[] = [];
  const hidden: HiddenVehicle[] = [];
  for (const [code, telemetry] of state.telemetry) {
    const crossesGap = gaps.some(
      (gap) =>
        gap.from_operating != null &&
        gap.from_operating >= telemetry.operating_at &&
        gap.from_operating <= at,
    );
    if (crossesGap) {
      hidden.push({ code, reason: "gap" });
      continue;
    }
    const reference = state.reference?.receivedAt ?? telemetry.received_at;
    if (reference - telemetry.received_at > staleAfterMs) {
      hidden.push({ code, reason: "stale" });
      continue;
    }
    vehicles.push({ code, telemetry, operation: state.operation.get(code) ?? null });
  }
  vehicles.sort((a, b) => a.code.localeCompare(b.code));
  hidden.sort((a, b) => a.code.localeCompare(b.code));
  return { vehicles, hidden };
}

/** T 是否落在某段缺段內 */
export function gapAt(gaps: readonly ReplayGap[], at: number): ReplayGap | null {
  return (
    gaps.find(
      (gap) =>
        gap.from_operating != null &&
        at >= gap.from_operating &&
        at <= (gap.to_operating ?? Number.POSITIVE_INFINITY),
    ) ?? null
  );
}

/** 回放用的訂單站序與用途：只用保存下來的那一份 */
export function orderOverrideFrom(state: ReplayState): {
  stationsById: Record<string, readonly string[]>;
  metaById: Record<string, OrderTaskMeta>;
} {
  const stationsById: Record<string, readonly string[]> = {};
  const metaById: Record<string, OrderTaskMeta> = {};
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  for (const [orderId, frame] of state.orders) {
    const stations = Array.isArray(frame.payload.stations)
      ? (frame.payload.stations as unknown[]).filter(
          (value): value is string => typeof value === "string" && !!value,
        )
      : [];
    stationsById[orderId] = stations;
    metaById[orderId] = {
      transitionPurpose: str(frame.payload.transition_purpose),
      transitionFacility: str(frame.payload.transition_facility),
      yardSlotId: null,
    };
  }
  return { stationsById, metaById };
}

/**
 * T 當下生效的等級與速限：最後一筆生效時間不晚於 T、帶參數的變更。
 * 沒開始以前回 null。
 */
export function parametersAt(
  changes: readonly ParameterChange[],
  at: number,
): { level: number; speedLimitKmh: number; since: number } | null {
  let current: { level: number; speedLimitKmh: number; since: number } | null = null;
  for (const change of changes) {
    if (change.effective_at_operating == null || change.effective_at_operating > at) continue;
    if (change.level == null || change.speed_limit_kmh == null) continue;
    if (current && change.effective_at_operating < current.since) continue;
    current = {
      level: change.level,
      speedLimitKmh: change.speed_limit_kmh,
      since: change.effective_at_operating,
    };
  }
  return current;
}

/** 同一台車相鄰兩筆遙測的營運時間間隔中位數（決定播放時的補間長度） */
export function typicalTelemetryInterval(frames: readonly ReplayFrame[]): number | null {
  const last = new Map<string, number>();
  const gaps: number[] = [];
  for (const frame of frames) {
    if (frame.stream !== "telemetry" || !frame.vehicle_code) continue;
    const previous = last.get(frame.vehicle_code);
    if (previous !== undefined && frame.operating_at > previous)
      gaps.push(frame.operating_at - previous);
    last.set(frame.vehicle_code, frame.operating_at);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
