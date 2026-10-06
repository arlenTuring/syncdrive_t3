/**
 * 營運時鐘：實際時間 → 營運時間。
 *
 * 正式營運時兩者相同（realtime）。加速重播時，執行端（模擬器或任何車端程式）用明確的動作
 * 宣告「從實際時刻 R 起，營運時間從 O 開始、以 rate 倍推進」；暫停、繼續、改倍速各是一段。
 * 儀表板的班次狀態、延誤、ETA、倒數都經過這裡換算，所以加速只是同一套規則推進得比較快，
 * 不另外定義完成或延誤的公式。
 *
 * 執行端要定期回報心跳；太久沒消息就標示「執行中斷／落後」，營運時間停在最後一次可信的時刻，
 * 不會在沒人推進的情況下自己往前跑，把所有班次判成延誤。
 */

import { operatingDayOf } from './operating-day';

export type ClockSegment = {
  /** 這一段從哪個實際時刻開始（Epoch 毫秒） */
  realStart: number;
  /** 這一段開始時的營運時刻（Epoch 毫秒） */
  opStart: number;
  /** 倍速；暫停時仍保留原倍速，paused 決定是否推進 */
  rate: number;
  paused: boolean;
};

export type ClockState = {
  mode: 'realtime' | 'replay';
  /** 誰在推進（執行 ID）；realtime 為 null */
  runId: string | null;
  /** 推進的是哪個營運日 */
  operatingDay: string | null;
  /** 依 realStart 遞增；最後一段是目前這一段 */
  segments: ClockSegment[];
  /** 執行端最後一次回報的實際時刻 */
  heartbeatAt: number | null;
  /** 執行端回報的落後量（營運毫秒）：該發生卻還沒處理完的生命週期事件拖了多久 */
  lagMs: number;
  /** 執行已結束（停止或跑完）：營運時間停在結束那一刻 */
  ended: boolean;
};

/** 心跳超過這麼久（實際時間）就視為中斷；營運時間停在最後心跳之後這麼久的位置 */
export const CLOCK_STALE_AFTER_MS = 15_000;
/** 支援的最大倍速（與模擬器、後端驗證共用） */
export const MAX_CLOCK_RATE = 180;
/** 只保留最近這麼多段，夠換算一整天的暫停／繼續 */
const MAX_SEGMENTS = 500;

export const REALTIME_CLOCK: ClockState = {
  mode: 'realtime',
  runId: null,
  operatingDay: null,
  segments: [],
  heartbeatAt: null,
  lagMs: 0,
  ended: false,
};

function segmentFor(state: ClockState, realTs: number): ClockSegment | null {
  let found: ClockSegment | null = null;
  for (const segment of state.segments) {
    if (segment.realStart <= realTs) found = segment;
    else break;
  }
  return found ?? state.segments[0] ?? null;
}

function advance(segment: ClockSegment, realTs: number): number {
  if (segment.paused) return segment.opStart;
  return segment.opStart + Math.max(0, realTs - segment.realStart) * segment.rate;
}

/** 心跳逾時了嗎（只有進行中的重播會逾時） */
export function isClockStale(state: ClockState, realNow: number): boolean {
  if (state.mode !== 'replay' || state.ended) return false;
  const last = state.heartbeatAt ?? state.segments.at(-1)?.realStart ?? realNow;
  return realNow - last > CLOCK_STALE_AFTER_MS;
}

/** 某個實際時刻對應的營運時刻 */
export function operatingTimeAt(state: ClockState, realTs: number, realNow = realTs): number {
  if (state.mode !== 'replay') return realTs;
  const segment = segmentFor(state, realTs);
  if (!segment) return realTs;
  let effective = realTs;
  // 中斷：不推進超過最後心跳＋容許時間
  if (!state.ended && isClockStale(state, realNow)) {
    const last = state.heartbeatAt ?? segment.realStart;
    effective = Math.min(effective, last + CLOCK_STALE_AFTER_MS);
  }
  return advance(segment, effective);
}

export type ClockUpdate = {
  mode: 'realtime' | 'replay';
  runId?: string | null;
  operatingDay?: string | null;
  /** 執行端此刻的營運時刻 */
  operatingNow?: number;
  rate?: number;
  paused?: boolean;
  ended?: boolean;
  lagMs?: number;
};

/**
 * 套用執行端的回報。營運時刻、倍速、暫停任一個改變才開新的一段；只是心跳就只更新心跳。
 * 換了執行 ID 或從 realtime 切進來，從頭開始。
 */
export function applyClockUpdate(state: ClockState, update: ClockUpdate, realNow: number): ClockState {
  if (update.mode === 'realtime') return { ...REALTIME_CLOCK };
  const runId = update.runId ?? null;
  const rate = Number(update.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_CLOCK_RATE) {
    throw new Error(`倍速需介於 0 與 ${MAX_CLOCK_RATE} 之間`);
  }
  const operatingNow = Number(update.operatingNow);
  if (!Number.isFinite(operatingNow)) throw new Error('需要 operatingNow（此刻的營運時刻）');
  // 結束等同暫停：營運時間停在結束那一刻
  const paused = update.paused === true || update.ended === true;
  const fresh = state.mode !== 'replay' || state.runId !== runId;
  const base: ClockState = fresh
    ? { ...REALTIME_CLOCK, mode: 'replay', runId, operatingDay: update.operatingDay ?? null, segments: [] }
    : state;
  const current = base.segments.at(-1);
  const expected = current ? advance(current, realNow) : null;
  // 執行端回報的營運時刻跟我們推算的差超過容許量才當成新的一段（避免心跳抖動切出一堆段）。
  // 容許量是一秒營運時間或 250 毫秒實際時間（網路延遲）乘上倍速，取大者
  const drift = expected == null ? Infinity : Math.abs(expected - operatingNow);
  const tolerance = Math.max(1_000, rate * 250);
  const changed = !current || current.rate !== rate || current.paused !== paused || drift > tolerance;
  const segments = changed
    ? [...base.segments, { realStart: realNow, opStart: operatingNow, rate, paused }].slice(-MAX_SEGMENTS)
    : base.segments;
  return {
    mode: 'replay',
    runId,
    operatingDay: update.operatingDay ?? base.operatingDay,
    segments,
    heartbeatAt: realNow,
    lagMs: Math.max(0, Number(update.lagMs) || 0),
    ended: update.ended === true,
  };
}

/** 給儀表板的快照 */
export function describeClock(state: ClockState, realNow: number) {
  const current = state.segments.at(-1) ?? null;
  const operatingNow = operatingTimeAt(state, realNow, realNow);
  const stale = isClockStale(state, realNow);
  return {
    mode: state.mode,
    run_id: state.runId,
    operating_day: state.operatingDay ?? operatingDayOf(operatingNow),
    operating_now: operatingNow,
    real_now: realNow,
    rate: state.mode === 'replay' ? current?.rate ?? 1 : 1,
    paused: state.mode === 'replay' ? (current?.paused ?? false) || state.ended : false,
    ended: state.ended,
    stale,
    lag_ms: state.lagMs,
    heartbeat_at: state.heartbeatAt,
  };
}
