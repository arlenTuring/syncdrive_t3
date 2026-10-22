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
};

/**
 * 有資料的背景更新不清空畫面；同一查詢進行中收到多次失效通知，只補跑一次。
 * queryKey 必須只描述資料語意（條件、頁碼、使用者範圍），不可包含 reload 計數。
 */
export function useCoalescedQuery<T>({ enabled, queryKey, load }: Options<T>) {
  const [state, setState] = useState<QueryState<T>>({ key: '', data: null, error: '', loading: false });
  const [reloadTick, setReloadTick] = useState(0);
  const requestRef = useRef<{ key: string; generation: number; controller: AbortController } | null>(null);
  const queuedRef = useRef(false);
  const generationRef = useRef(0);
  const startedKeyRef = useRef('');

  const refresh = useCallback(() => {
    if (!enabled) return;
    if (requestRef.current?.key === queryKey) {
      queuedRef.current = true;
      return;
    }
    setReloadTick((value) => value + 1);
  }, [enabled, queryKey]);

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
    if (!sameQuery) queuedRef.current = false;
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
        setState({ key: queryKey, data, error: '', loading: false });
      },
      (reason: unknown) => {
        if (controller.signal.aborted || requestRef.current?.generation !== generation) return;
        setState((current) => ({ ...current, key: queryKey, error: reason instanceof Error ? reason.message : String(reason), loading: false }));
      },
    ).finally(() => {
      if (requestRef.current?.generation !== generation) return;
      requestRef.current = null;
      if (queuedRef.current && startedKeyRef.current === queryKey) {
        queuedRef.current = false;
        setReloadTick((value) => value + 1);
      }
    });

    return () => {
      controller.abort();
      if (requestRef.current?.generation === generation) requestRef.current = null;
    };
  }, [enabled, load, queryKey, reloadTick]);

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
    setData,
  };
}
