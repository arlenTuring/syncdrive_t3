import { useEffect, useMemo, useState } from 'react';
import { getDataSourceById } from '../store/useDataSourceStore';
import { usePlaneSourceResolver } from '../context/PlaneDataSourceContext';
import { subscribeDatasourceInvalidation } from './datasourceInvalidationBus';

/**
 * 營運時鐘（後端 GET /syncdrive-api/dispatch/operating-clock，規則見 backend operating-day/operating-clock.ts）。
 *
 * 儀表板的班次狀態、延誤、ETA、倒數都以營運時間為準：正式營運時就是實際時間；加速重播時由執行端推進，
 * 畫面在兩次查詢之間照倍速往前推。暫停、等待、結束、中斷時不推。
 * 認證、逾時、訊息新鮮度這類技術判斷不經過這裡，照實際時間。
 */
export type OperatingClockSnapshot = {
  mode: 'realtime' | 'replay';
  run_id: string | null;
  operating_day: string;
  operating_now: number;
  real_now: number;
  rate: number;
  paused: boolean;
  ended: boolean;
  stale: boolean;
  lag_ms: number;
};

export type OperatingClockState = {
  snapshot: OperatingClockSnapshot | null;
  /** 收到 snapshot 時的本機時刻 */
  receivedAt: number;
  error: string | null;
};

const CLOCK_PATH = '/syncdrive-api/dispatch/operating-clock';
const REFRESH_MS = 5_000;

type Entry = {
  state: OperatingClockState;
  listeners: Set<(state: OperatingClockState) => void>;
  timer: ReturnType<typeof setInterval> | null;
  unsubscribe: (() => void) | null;
  inflight: boolean;
};

const entries = new Map<string, Entry>();

function clockUrl(base: string): string {
  return `${base.replace(/\/$/, '')}${CLOCK_PATH}`;
}

async function refresh(base: string, entry: Entry): Promise<void> {
  if (entry.inflight) return;
  entry.inflight = true;
  try {
    const response = await fetch(clockUrl(base));
    if (!response.ok) throw new Error(`營運時鐘查詢失敗（HTTP ${response.status}）`);
    const snapshot = (await response.json()) as OperatingClockSnapshot;
    entry.state = { snapshot, receivedAt: Date.now(), error: null };
  } catch (error) {
    entry.state = { ...entry.state, error: error instanceof Error ? error.message : String(error) };
  } finally {
    entry.inflight = false;
    entry.listeners.forEach((fn) => fn(entry.state));
  }
}

function acquire(base: string, listener: (state: OperatingClockState) => void): () => void {
  let entry = entries.get(base);
  if (!entry) {
    entry = { state: { snapshot: null, receivedAt: 0, error: null }, listeners: new Set(), timer: null, unsubscribe: null, inflight: false };
    entries.set(base, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  if (!current.timer) {
    void refresh(base, current);
    current.timer = setInterval(() => void refresh(base, current), REFRESH_MS);
    current.unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes('domain:operating_clock')) void refresh(base, current);
    });
  } else {
    listener(current.state);
  }
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      if (current.timer) clearInterval(current.timer);
      current.unsubscribe?.();
      current.timer = null;
      current.unsubscribe = null;
    }
  };
}

/** 營運時鐘正在推進嗎（重播進行中、沒有暫停／結束／中斷） */
export function clockAdvancing(snapshot: OperatingClockSnapshot | null): boolean {
  return !!snapshot && snapshot.mode === 'replay' && !snapshot.paused && !snapshot.ended && !snapshot.stale;
}

/** 此刻的營運時刻：沒有時鐘資料時退回實際時間 */
export function operatingNowFrom(state: OperatingClockState, realNow = Date.now()): number {
  const snapshot = state.snapshot;
  if (!snapshot) return realNow;
  if (snapshot.mode !== 'replay') return realNow;
  if (!clockAdvancing(snapshot)) return snapshot.operating_now;
  return snapshot.operating_now + Math.max(0, realNow - state.receivedAt) * snapshot.rate;
}

/** 這張儀表板（資料設定選的後端）的營運時鐘 */
export function useOperatingClock(): OperatingClockState & { operatingNow: () => number; rate: number; advancing: boolean } {
  const resolve = usePlaneSourceResolver();
  const base = getDataSourceById(resolve('default-internal'))?.backendUrl ?? '';
  const [state, setState] = useState<OperatingClockState>(() => entries.get(base)?.state ?? { snapshot: null, receivedAt: 0, error: null });
  useEffect(() => acquire(base, setState), [base]);
  return useMemo(() => ({
    ...state,
    operatingNow: () => operatingNowFrom(state),
    rate: state.snapshot?.mode === 'replay' ? state.snapshot.rate : 1,
    advancing: clockAdvancing(state.snapshot),
  }), [state]);
}
