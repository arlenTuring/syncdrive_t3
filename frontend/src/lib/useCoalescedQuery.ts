import { useCallback, useEffect, useRef, useState } from 'react';

type QueryState<T> = {
  key: string;
  data: T | null;
  error: string;
  loading: boolean;
};

type Options<T> = {
  enabled: boolean;
  queryKey: string;
  load: (signal: AbortSignal) => Promise<T>;
  /**
   * backgroundRefresh（失效通知、定時保底）兩次之間至少隔多久（預設 500ms）。通知再密也是
   * 「最慢這麼久一定再查」，不是等通知停下來才查。換條件、使用者操作後的 refresh 不受限，立即查。
   */
  minIntervalMs?: number;
};

/** 連續失敗時的背景重查間隔上限（minIntervalMs × 2^失敗次數，封頂於此） */
const RETRY_MAX_MS = 30_000;

/**
 * 有資料的背景更新不清空畫面；同一查詢進行中收到多次失效通知，只補跑一次。
 * queryKey 必須只描述資料語意（條件、頁碼、使用者範圍），不可包含 reload 計數。
 */
export function useCoalescedQuery<T>({ enabled, queryKey, load, minIntervalMs = 500 }: Options<T>) {
  const [state, setState] = useState<QueryState<T>>({ key: '', data: null, error: '', loading: false });
  const [reloadTick, setReloadTick] = useState(0);
  const requestRef = useRef<{ key: string; generation: number; controller: AbortController } | null>(null);
  const queuedRef = useRef(false);
  /** 排隊中的補查是不是使用者操作要的（要的話回來立即查，不走節流） */
  const queuedImmediateRef = useRef(false);
  const generationRef = useRef(0);
  const startedKeyRef = useRef('');
  const lastStartRef = useRef(Number.NEGATIVE_INFINITY);
  const errorStreakRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 照最小間隔（失敗時退避）排下一次背景重查；已排的不再往後延 */
  const schedule = useCallback(() => {
    if (timerRef.current) return;
    const gap = errorStreakRef.current > 0
      ? Math.min(RETRY_MAX_MS, minIntervalMs * 2 ** errorStreakRef.current)
      : minIntervalMs;
    const wait = Math.max(0, lastStartRef.current + gap - Date.now());
    if (wait === 0) {
      setReloadTick((value) => value + 1);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setReloadTick((value) => value + 1);
    }, wait);
  }, [minIntervalMs]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** 使用者操作（建立、刪除、重試）後重查：立即；進行中就等它回來立即補一次 */
  const refresh = useCallback(() => {
    if (!enabled) return;
    if (requestRef.current?.key === queryKey) {
      queuedRef.current = true;
      queuedImmediateRef.current = true;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setReloadTick((value) => value + 1);
  }, [enabled, queryKey]);

  /** 失效通知、定時保底：進行中只記一次補查；否則照最小間隔（失敗時退避）排程 */
  const backgroundRefresh = useCallback(() => {
    if (!enabled) return;
    if (requestRef.current?.key === queryKey) {
      queuedRef.current = true;
      return;
    }
    schedule();
  }, [enabled, queryKey, schedule]);

  useEffect(() => {
    if (!enabled) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      queuedRef.current = false;
      startedKeyRef.current = '';
      return undefined;
    }

    // 新條件立即取代舊條件；舊回應即使不理會 abort，也不能寫回。
    const sameQuery = startedKeyRef.current === queryKey;
    if (!sameQuery) {
      queuedRef.current = false;
      queuedImmediateRef.current = false;
      errorStreakRef.current = 0;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastStartRef.current = Date.now();
    startedKeyRef.current = queryKey;
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const generation = ++generationRef.current;
    requestRef.current = { key: queryKey, generation, controller };
    setState((current) => ({
      key: queryKey,
      data: sameQuery && current.key === queryKey ? current.data : null,
      error: '',
      loading: true,
    }));

    void load(controller.signal).then(
      (data) => {
        if (controller.signal.aborted || requestRef.current?.generation !== generation) return;
        errorStreakRef.current = 0;
        setState({ key: queryKey, data, error: '', loading: false });
      },
      (reason: unknown) => {
        if (controller.signal.aborted || requestRef.current?.generation !== generation) return;
        errorStreakRef.current += 1;
        setState((current) => ({ ...current, key: queryKey, error: reason instanceof Error ? reason.message : String(reason), loading: false }));
      },
    ).finally(() => {
      if (requestRef.current?.generation !== generation) return;
      requestRef.current = null;
      if (queuedRef.current && startedKeyRef.current === queryKey) {
        const immediate = queuedImmediateRef.current;
        queuedRef.current = false;
        queuedImmediateRef.current = false;
        if (immediate) setReloadTick((value) => value + 1);
        else schedule();
      }
    });

    return () => {
      controller.abort();
      if (requestRef.current?.generation === generation) requestRef.current = null;
    };
  }, [enabled, load, queryKey, reloadTick, schedule]);

  const current = enabled && state.key === queryKey ? state : null;
  const setData = useCallback((update: T | ((current: T) => T)) => {
    setState((currentState) => {
      if (currentState.key !== queryKey || currentState.data === null) return currentState;
      const data = typeof update === 'function'
        ? (update as (current: T) => T)(currentState.data)
        : update;
      return { ...currentState, data };
    });
  }, [queryKey]);

  return {
    data: current?.data ?? null,
    initialLoading: enabled && (!current || current.data === null) && (!current || !current.error),
    refreshing: Boolean(current?.loading && current.data !== null),
    initialError: current && current.data === null ? current.error : '',
    backgroundError: current && current.data !== null ? current.error : '',
    refresh,
    backgroundRefresh,
    setData,
  };
}
