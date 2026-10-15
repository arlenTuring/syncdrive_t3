import type { OrderTaskMeta } from "../map-editor/vehicles/yardExitStaging";
import { cursorOf, frameAtOrBefore, frameOrder, type ReplayCursor } from "./cursor";

/**
 * 回放的一筆保存資料（一般運行紀錄與歷史降級共用）。
 *
 * t 是回放時間軸：歷史降級用營運時間，一般運行紀錄用後端實際收到的時間。received_at、
 * operating_at、vehicle_ts 照原樣保留給畫面顯示，不互相代用。
 */
export type ReplayFrame = {
  seq: string;
  t: number;
  stream: string;
  kind?: "initial" | "live";
  vehicle_code: string | null;
  topic: string | null;
  stream_key?: string;
  order_id?: string | null;
  received_at: number;
  operating_at: number | null;
  clock_run?: string | null;
  vehicle_ts: number | null;
  source?: string;
  payload: Record<string, unknown>;
  derived?: Record<string, unknown> | null;
};

/** 回放時間軸上的缺段（不同來源各自換算成 t 之後傳進來） */
export type TimelineGap = { from: number | null; to: number | null; reason: string; count?: number };

/**
 * 回放狀態重建（純函式）。
 *
 * 規則：從起點（指定游標的 snapshot）開始，依 (t, seq) 順序套用不晚於游標的資料；每個狀態來源
 * 只留最後一筆。游標之後的資料一筆都不看，所以不會提前出現到站、任務切換或參數變更。往回時從
 * 起點重新套，不沿用後面才發生的狀態，也不反向推算。
 */
export type ReplayState = {
  telemetry: Map<string, ReplayFrame>;
  operation: Map<string, ReplayFrame>;
  health: Map<string, ReplayFrame>;
  facility: Map<string, ReplayFrame>;
  orders: Map<string, ReplayFrame>;
  /** 所有串流各自最後一筆（依狀態來源鍵）：資料面板、地圖／模型版本參照用 */
  byKey: Map<string, ReplayFrame>;
  /** 已套用資料中最後收到的那一筆（判斷過期用的參考時刻） */
  reference: { receivedAt: number; t: number; seq: string } | null;
  /** 游標所在的那一筆（最後套用的；起點快照時是 null） */
  last: ReplayFrame | null;
};

export function emptyReplayState(): ReplayState {
  return {
    telemetry: new Map(),
    operation: new Map(),
    health: new Map(),
    facility: new Map(),
    orders: new Map(),
    byKey: new Map(),
    reference: null,
    last: null,
  };
}

export function cloneReplayState(state: ReplayState): ReplayState {
  return {
    telemetry: new Map(state.telemetry),
    operation: new Map(state.operation),
    health: new Map(state.health),
    facility: new Map(state.facility),
    orders: new Map(state.orders),
    byKey: new Map(state.byKey),
    reference: state.reference ? { ...state.reference } : null,
    last: state.last,
  };
}

export function frameKey(frame: ReplayFrame): string {
  if (frame.stream_key) return frame.stream_key;
  const id = frame.stream === "facility" || frame.stream === "order" ? frame.topic ?? frame.order_id : frame.vehicle_code;
  return `${frame.stream}|${id ?? ""}`;
}

/** 即時系統當時拒收的資料（比已收到的舊或重複）：照實保存、可以逐幀看到，但不改變狀態 */
export function isRejectedFrame(frame: ReplayFrame): boolean {
  return !!frame.derived && typeof frame.derived === "object" && "rejected" in frame.derived;
}

/** 套用一筆（就地修改）。比目前保存的那一筆舊的不覆蓋 */
export function applyFrame(state: ReplayState, frame: ReplayFrame): void {
  state.last = frame;
  if (isRejectedFrame(frame)) return;
  const typed =
    frame.stream === "telemetry"
      ? state.telemetry
      : frame.stream === "operation"
        ? state.operation
        : frame.stream === "health"
          ? state.health
          : frame.stream === "facility"
            ? state.facility
            : frame.stream === "order"
              ? state.orders
              : null;
  const typedKey =
    frame.stream === "facility"
      ? frame.topic ?? ""
      : frame.stream === "order"
        ? frame.topic ?? frame.order_id ?? ""
        : frame.vehicle_code ?? "";
  const key = frameKey(frame);
  const current = state.byKey.get(key);
  if (current && frameOrder(current, frame) > 0) return;
  state.byKey.set(key, frame);
  if (typed && typedKey) typed.set(typedKey, frame);
  const isLive = frame.kind !== "initial" && frame.source !== "system" && frame.source !== "db";
  if (isLive && (!state.reference || frame.received_at >= state.reference.receivedAt)) {
    state.reference = { receivedAt: frame.received_at, t: frame.t, seq: frame.seq };
  }
}

export function stateFromSnapshot(
  frames: readonly ReplayFrame[],
  reference: { received_at: number; t: number; seq: string } | null,
): ReplayState {
  const state = emptyReplayState();
  [...frames].sort(frameOrder).forEach((frame) => applyFrame(state, frame));
  if (reference) state.reference = { receivedAt: reference.received_at, t: reference.t, seq: reference.seq };
  // 起點快照的「最後一筆」不代表游標所在的那一筆（它們是各來源各自的最後狀態）
  state.last = null;
  return state;
}

/** 起點＋期間資料 → 游標的狀態。frames 必須已依 (t, seq) 排序；回傳新物件，不改 base */
export function stateAt(base: ReplayState, frames: readonly ReplayFrame[], cursor: ReplayCursor): ReplayState {
  const state = cloneReplayState(base);
  for (const frame of frames) {
    if (!frameAtOrBefore(frame, cursor)) break;
    applyFrame(state, frame);
  }
  return state;
}

/** frames 中最後一筆已包含在游標狀態裡的索引；一筆都沒有時 -1（二分搜尋） */
export function lastAppliedIndex(frames: readonly ReplayFrame[], cursor: ReplayCursor): number {
  let low = 0;
  let high = frames.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (frameAtOrBefore(frames[mid], cursor)) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * 下一幀：已載入資料中第一筆晚於游標的那一筆。沒有（要載入下一段）時回 null。
 */
export function nextFrameCursor(frames: readonly ReplayFrame[], cursor: ReplayCursor): ReplayCursor | null {
  const index = lastAppliedIndex(frames, cursor);
  const next = frames[index + 1];
  return next ? cursorOf(next) : null;
}

/**
 * 上一幀：把「游標所在那一筆」退掉之後的游標＝它前一筆的位置。
 * - 游標所在那一筆是已載入的第一筆：退回起點快照的游標（起點快照正是它之前的狀態）
 * - 游標已經在起點：前一筆在更早的地方，回 "outside"，呼叫端向後端要前一筆再重建
 */
export function prevFrameCursor(
  frames: readonly ReplayFrame[],
  cursor: ReplayCursor,
  baseCursor: ReplayCursor,
): ReplayCursor | "outside" {
  const index = lastAppliedIndex(frames, cursor);
  if (index < 0) return "outside";
  if (index === 0) return baseCursor;
  return cursorOf(frames[index - 1]);
}

/** 同一毫秒的第幾筆（1 起算）與該毫秒總筆數；看同時刻不同幀用 */
export function positionInMillisecond(
  frames: readonly ReplayFrame[],
  frame: ReplayFrame | null,
): { index: number; total: number } | null {
  if (!frame) return null;
  const same = frames.filter((item) => item.t === frame.t);
  const index = same.findIndex((item) => item.seq === frame.seq);
  return index < 0 ? null : { index: index + 1, total: same.length };
}

export type ReplayVehicle = {
  code: string;
  telemetry: ReplayFrame;
  operation: ReplayFrame | null;
};

export type HiddenVehicle = { code: string; reason: "stale" | "gap" };

/**
 * 游標當下畫得出來的車：
 * - 有遙測
 * - 那筆遙測之後、游標之前沒有落在缺段裡（缺段期間不知道它去了哪裡，不畫、不補移動）
 * - 跟最後收到的資料相比沒有過期（與即時圖台同一個門檻）
 */
export function visibleVehicles(
  state: ReplayState,
  at: number,
  gaps: readonly TimelineGap[],
  staleAfterMs: number,
  options: {
    /** 判斷過期的參考時刻；不給就用這份狀態最後收到的那一筆（降級回放的舊行為） */
    referenceAt?: number;
    /** 只看這些車／排除這些車（調查載具與背景車隊分開算） */
    only?: ReadonlySet<string>;
    exclude?: ReadonlySet<string>;
  } = {},
): { vehicles: ReplayVehicle[]; hidden: HiddenVehicle[] } {
  const vehicles: ReplayVehicle[] = [];
  const hidden: HiddenVehicle[] = [];
  for (const [code, telemetry] of state.telemetry) {
    if (options.only && !options.only.has(code)) continue;
    if (options.exclude?.has(code)) continue;
    const crossesGap = gaps.some((gap) => gap.from != null && gap.from >= telemetry.t && gap.from <= at);
    if (crossesGap) {
      hidden.push({ code, reason: "gap" });
      continue;
    }
    const reference = options.referenceAt ?? state.reference?.receivedAt ?? telemetry.received_at;
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

/** 游標是否落在某段缺段內 */
export function gapAt(gaps: readonly TimelineGap[], at: number): TimelineGap | null {
  return gaps.find((gap) => gap.from != null && at >= gap.from && at <= (gap.to ?? Number.POSITIVE_INFINITY)) ?? null;
}

/** 回放用的訂單站序與用途：只用保存下來的那一份（站序可能是站點 ID 字串或站點物件） */
export function orderOverrideFrom(state: ReplayState): {
  stationsById: Record<string, readonly string[]>;
  metaById: Record<string, OrderTaskMeta>;
} {
  const stationsById: Record<string, readonly string[]> = {};
  const metaById: Record<string, OrderTaskMeta> = {};
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  for (const [orderId, frame] of state.orders) {
    const stations = Array.isArray(frame.payload.stations)
      ? (frame.payload.stations as unknown[])
          .map((value) =>
            typeof value === "string"
              ? value
              : value && typeof value === "object"
                ? str((value as { station_id?: unknown }).station_id) ?? ""
                : "",
          )
          .filter((value) => !!value)
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

/** 同一台車相鄰兩筆遙測的回放時間間隔中位數（決定播放時的補間長度） */
export function typicalTelemetryInterval(frames: readonly ReplayFrame[]): number | null {
  const last = new Map<string, number>();
  const gaps: number[] = [];
  for (const frame of frames) {
    if (frame.stream !== "telemetry" || !frame.vehicle_code) continue;
    const previous = last.get(frame.vehicle_code);
    if (previous !== undefined && frame.t > previous) gaps.push(frame.t - previous);
    last.set(frame.vehicle_code, frame.t);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
