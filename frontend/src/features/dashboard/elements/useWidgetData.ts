import { useEffect, useMemo, useRef, useState } from 'react';
import { executeDatasourceQuery } from '../store/useDataSourceStore';
import { useVariables, interpolateVariables } from '../VariableContext';

export interface WidgetFetchState {
  data: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * 統一的 Widget 資料取得 Hook
 * 優先順序：dataSourceId + sqlQuery > dataUrl（僅使用真實回傳，無內建假資料）
 */
export function useWidgetData(opts: {
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  refreshInterval?: number; // 秒
}): WidgetFetchState {
  const { dataSourceId, sqlQuery, dataUrl, refreshInterval } = opts;
  const [state, setState] = useState<WidgetFetchState>({ data: [], loading: false, error: null });
  const lastGoodData = useRef<Record<string, unknown>[]>([]);
  const vars = useVariables();
  const varsKey = useMemo(() => {
    const keys = Object.keys(vars).sort();
    return keys.map(k => `${k}:${String(vars[k])}`).join('|');
  }, [vars]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let aborted = false;

    const fetchData = async () => {
      if (dataSourceId && sqlQuery?.trim()) {
        const finalSql = interpolateVariables(sqlQuery, vars);
        try {
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

    setState(s => ({ ...s, loading: true, error: null }));
    void fetchData();

    if (refreshInterval && refreshInterval > 0) {
      timer = setInterval(() => void fetchData(), refreshInterval * 1000);
    }

    return () => {
      aborted = true;
      if (timer) clearInterval(timer);
    };
  }, [dataSourceId, sqlQuery, dataUrl, refreshInterval, varsKey]);

  return state;
}
