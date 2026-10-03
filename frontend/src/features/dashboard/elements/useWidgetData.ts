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

/**
 * 同一個 REST 網址在這段時間內只真的打一次，其餘元件共用結果。
 *
 * 一塊面板常常好幾個元件綁同一支 API（運能趨勢四個數值卡＋兩行說明綁同一個 summary）。
 * 訂單失效通知約每秒一次，各自重打會把後端壓垮：請求排隊超過逾時就被放棄，畫面
 * 反而一直是空的。共用進行中的請求、短時間內重用結果，一支 API 每秒最多一次。
 */
const REST_SHARE_MS = 2_000;
const restShared = new Map<string, { at: number; promise: Promise<unknown> }>();

function fetchJsonShared(url: string): Promise<unknown> {
  const now = Date.now();
  const hit = restShared.get(url);
  if (hit && now - hit.at < REST_SHARE_MS) return hit.promise;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const promise = fetch(url, { signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<unknown>;
    })
    .catch((error: unknown) => {
      restShared.delete(url);
      throw error;
    })
    .finally(() => clearTimeout(timeoutId));
  restShared.set(url, { at: now, promise });
  return promise;
}

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
  const [dataSourceRevision, setDataSourceRevision] = useState(0);
  useEffect(() => {
    const changed = () => setDataSourceRevision((value) => value + 1);
    window.addEventListener('syncdrive-datasources-changed', changed);
    return () => window.removeEventListener('syncdrive-datasources-changed', changed);
  }, []);
  /**
   * 上一次交給畫面的資料（序列化）。重查結果一模一樣就不 setState：失效通知一來，
   * 綁同一張表的元件全部重查，但絕大多數時候資料根本沒變，照樣 setState 會讓整排
   * 元件重畫——儀表板每秒卡一下的主因之一。
   */
  const lastShownJson = useRef<string | null>(null);
  const showRows = (rows: Record<string, unknown>[]) => {
    lastGoodData.current = rows;
    let json: string | null;
    try {
      json = JSON.stringify(rows);
    } catch {
      json = null;
    }
    if (json !== null && json === lastShownJson.current) {
      // 資料沒變：只在還掛著「載入中／錯誤」時收掉，其餘不動
      setState((prev) => (prev.loading || prev.error ? { data: prev.data, loading: false, error: null } : prev));
      return;
    }
    lastShownJson.current = json;
    setState({ data: rows, loading: false, error: null });
  };
  /**
   * 查詢失敗：顯示錯誤，跟「查無資料」分開。資料只沿用「上次成功、而且之後沒有收到
   * 失效通知」的那份（暫時連不上時畫面不閃）；收到失效通知後就沒有可沿用的資料。
   */
  const showError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    lastShownJson.current = null;
    setState({ data: lastGoodData.current, loading: false, error: msg || '查詢失敗' });
  };
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
    /**
     * 請求順序。回來的結果只在「比畫面上那份新」且「不是失效前送出的」時才採用：
     * 清空訂單後的通知會讓 validFrom 往前跳，清空前送出、晚回來的查詢就被丟掉，
     * 不會把已刪除的卡片補回來。
     */
    let requestSeq = 0;
    let appliedSeq = 0;
    let validFrom = 0;
    const isStale = (seq: number) => aborted || seq < validFrom || seq < appliedSeq;

    const fetchData = async (force = false) => {
      const seq = ++requestSeq;
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
          if (isStale(seq)) return;
          appliedSeq = seq;
          showRows(rows);
        } catch (e: unknown) {
          if (isStale(seq)) return;
          appliedSeq = seq;
          showError(e);
        }
        return;
      }

      if (dataUrl?.trim()) {
        try {
          const finalUrl = interpolateVariables(dataUrl, vars);
          const d = await fetchJsonShared(finalUrl) as Record<string, unknown> | Record<string, unknown>[];
          if (isStale(seq)) return;
          appliedSeq = seq;
          const rows = Array.isArray(d) ? d : ((d.data as Record<string, unknown>[] | undefined) ?? [d]);
          showRows(rows);
        } catch (e: unknown) {
          if (isStale(seq)) return;
          appliedSeq = seq;
          showError(e);
        }
        return;
      }

      if (!aborted) {
        lastGoodData.current = [];
        setState({ data: [], loading: false, error: null });
      }
    };

    // 資料來源或查詢換了：舊的比對基準作廢
    lastShownJson.current = null;
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
    // 輪詢／只查一次的元件也要聽：資料清空後不能等下一輪輪詢，也不能讓失效前的查詢晚回來蓋掉
    if (invalidateTags.length > 0) {
      unsubscribeInvalidate = subscribeDatasourceInvalidation((payload) => {
        if (!tagsOverlap(invalidateTags, payload.tags)) return;
        // 資料已經變了：之前送出的查詢一律作廢，失敗時也不能再拿失效前的資料頂著
        validFrom = requestSeq + 1;
        lastGoodData.current = [];
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
  }, [dataSourceId, sqlQuery, dataUrl, refreshInterval, refreshMode, varsKey, invalidateTags, dataSourceRevision]);

  return state;
}
