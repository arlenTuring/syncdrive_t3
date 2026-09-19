import { useEffect, useMemo, useRef, useState } from 'react';
import { clearDatasourceQueryCacheForQuery, executeDatasourceQuery } from '../store/useDataSourceStore';
import { useVariables, interpolateVariables } from '../VariableContext';
import { expandBuiltinSqlMacros } from '../constants/demoSql';
import { subscribeDatasourceInvalidation } from '../utils/datasourceInvalidationBus';
import { inferInvalidateTagsFromSql, tagsOverlap } from '../utils/inferInvalidateTagsFromSql';
import { resolveFreshness } from '../utils/resolveFreshness';
import type { WidgetDataBinding } from '../types';

export interface WidgetFetchState {
  data: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}

const FETCH_TIMEOUT_MS = 10_000;
const EVENT_FALLBACK_INTERVAL_SEC = 30;

export type WidgetDataOptions = WidgetDataBinding & {
  refreshInterval?: number;
};

/**
 * 統一 Widget 資料 Hook
 * - stream：MQTT（refreshMode=stream 時不查 SQL）
 * - event：後端寫庫 → Socket 失效標籤 → 立即重查，並以低頻輪詢防止漏事件
 * - once：僅 mount 查一次
 * - poll：legacy 定時輪詢
 */
export function useWidgetData(opts: WidgetDataOptions): WidgetFetchState {
  const { dataSourceId, sqlQuery, dataUrl } = opts;
  const [state, setState] = useState<WidgetFetchState>({ data: [], loading: false, error: null });
  const lastGoodData = useRef<Record<string, unknown>[]>([]);
  const vars = useVariables();
  const varsKey = useMemo(() => {
    const keys = Object.keys(vars).sort();
    return keys.map((k) => `${k}:${String(vars[k])}`).join('|');
  }, [vars]);

  // 由 freshnessPolicy（使用者面向）+ 資料來源型別推導底層更新機制
  const effective = useMemo(
    () => resolveFreshness(opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.freshnessPolicy, opts.refreshMode, opts.refreshInterval, opts.invalidateTags, sqlQuery, opts.mqttDataSourceId, opts.mqttTopic],
  );
  const refreshMode = effective.refreshMode;
  const refreshInterval = effective.refreshInterval;
  const invalidateTags = useMemo(
    () => opts.invalidateTags ?? inferInvalidateTagsFromSql(sqlQuery),
    [opts.invalidateTags, sqlQuery],
  );

  useEffect(() => {
    // stream：資料來自 MQTT，SQL hook 不查詢
    if (refreshMode === 'stream') {
      lastGoodData.current = [];
      setState({ data: [], loading: false, error: null });
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let aborted = false;

    const fetchData = async (force = false) => {
      if (dataSourceId && sqlQuery?.trim()) {
        const finalSql = interpolateVariables(expandBuiltinSqlMacros(sqlQuery), vars);
        if (/\{[a-zA-Z_]\w*\}/.test(finalSql)) {
          if (import.meta.env.DEV) {
            console.warn('[useWidgetData] 略過含未替換變數的 SQL:', finalSql.slice(0, 120));
          }
          if (!aborted) {
            setState({ data: lastGoodData.current, loading: false, error: null });
          }
          return;
        }
        try {
          if (force) clearDatasourceQueryCacheForQuery(dataSourceId, finalSql);
          const rows = await executeDatasourceQuery(dataSourceId, finalSql, FETCH_TIMEOUT_MS);
          if (aborted) return;
          lastGoodData.current = rows;
          setState({ data: rows, loading: false, error: null });
        } catch (e: unknown) {
          if (aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          setState({
            data: lastGoodData.current,
            loading: false,
            error: msg,
          });
        }
        return;
      }

      if (dataUrl?.trim()) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const finalUrl = interpolateVariables(dataUrl, vars);
          const r = await fetch(finalUrl, { signal: controller.signal });
          const d = await r.json();
          if (aborted) return;
          const rows = Array.isArray(d) ? d : (d.data ?? [d]);
          lastGoodData.current = rows;
          setState({ data: rows, loading: false, error: null });
        } catch (e: unknown) {
          if (aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          setState({ data: lastGoodData.current, loading: false, error: msg });
        } finally {
          clearTimeout(timeoutId);
        }
        return;
      }

      if (!aborted) {
        lastGoodData.current = [];
        setState({ data: [], loading: false, error: null });
      }
    };

    setState((s) => ({ ...s, loading: true, error: null }));
    void fetchData();

    const timerIntervalSec = refreshMode === 'poll'
      ? refreshInterval
      : refreshMode === 'event'
        ? (refreshInterval && refreshInterval > 0 ? refreshInterval : EVENT_FALLBACK_INTERVAL_SEC)
        : undefined;
    if (timerIntervalSec && timerIntervalSec > 0) {
      timer = setInterval(() => void fetchData(true), timerIntervalSec * 1000);
    }

    let unsubscribeInvalidate: (() => void) | undefined;
    if (refreshMode === 'event' && invalidateTags.length > 0) {
      unsubscribeInvalidate = subscribeDatasourceInvalidation((payload) => {
        if (!tagsOverlap(invalidateTags, payload.tags)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void fetchData(true);
        }, 200);
      });
    }

    // 瀏覽器在背景會節流 timer；切回畫面時立即補查，不必重新進入頁面。
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void fetchData(true);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      aborted = true;
      if (timer) clearInterval(timer);
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribeInvalidate?.();
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [dataSourceId, sqlQuery, dataUrl, refreshInterval, refreshMode, varsKey, invalidateTags]);

  return state;
}
