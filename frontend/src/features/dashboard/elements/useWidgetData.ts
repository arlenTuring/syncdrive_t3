import { useEffect, useMemo, useRef, useState } from 'react';
import { clearDatasourceQueryCacheForQuery, executeDatasourceQuery, getDataSourceById } from '../store/useDataSourceStore';
import { usePlaneSourceResolver } from '../context/PlaneDataSourceContext';
import { useVariables, interpolateVariables } from '../VariableContext';
import { expandBuiltinSqlMacros } from '../constants/demoSql';
import { isSoftInvalidation, subscribeDatasourceInvalidation } from '../utils/datasourceInvalidationBus';
import { inferInvalidateTagsFromSql, tagsOverlap } from '../utils/inferInvalidateTagsFromSql';
import { resolveFreshness } from '../utils/resolveFreshness';
import { useOperatingClockPace } from '../utils/operatingClock';
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
type RestFlight = { at: number; promise: Promise<unknown>; settled: boolean; next: Promise<unknown> | null };
const restShared = new Map<string, RestFlight>();

/**
 * notBefore：呼叫端最後一次收到失效通知的時間。比它早送出的請求不能拿來冒充更新後的資料；
 * 還在跑的話排一支補查在它後面（多個元件共用），已經回來的就重打。
 */
export function fetchJsonShared(url: string, notBefore = 0): Promise<unknown> {
  const now = Date.now();
  const hit = restShared.get(url);
  if (hit && now - hit.at < REST_SHARE_MS && hit.at >= notBefore) return hit.promise;
  if (hit && !hit.settled) {
    hit.next ??= hit.promise
      .then(() => undefined, () => undefined)
      .then(() => fetchJsonShared(url, notBefore));
    return hit.next;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const flight: RestFlight = { at: now, promise: Promise.resolve(null), settled: false, next: null };
  flight.promise = fetch(url, { signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<unknown>;
    })
    .catch((error: unknown) => {
      if (restShared.get(url) === flight) restShared.delete(url);
      throw error;
    })
    .finally(() => {
      clearTimeout(timeoutId);
      flight.settled = true;
      // 共用期過了就收掉，網址再多也不會一直累積
      setTimeout(() => {
        if (restShared.get(url) === flight) restShared.delete(url);
      }, REST_SHARE_MS);
    });
  restShared.set(url, flight);
  return flight.promise;
}

/** 診斷／測試用：REST 共用表目前的項數 */
export function restSharedSize(): number {
  return restShared.size;
}

/**
 * 背景重查的節流：兩支之間至少隔這麼久。通知再密也是「最慢這麼久一定再查」，
 * 不是等通知停下來才查（舊做法是每則通知都把重查往後延 200ms，通知不停就永遠不查）。
 */
export const WIDGET_REFRESH_MIN_GAP_MS = 500;
/** 連續失敗時的補查間隔上限（指數退避），避免失效通知把失敗的查詢變成密集重試 */
const WIDGET_RETRY_MAX_MS = 30_000;

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
/**
 * 站內 REST 網址（/syncdrive-api/...）跟著這張儀表板選的 SQL 連線（default-internal 的對應）
 * 打到同一台後端；完整網址（http…）照原樣。
 */
export function resolvePlaneRestUrl(url: string, internalBackendUrl: string | undefined): string {
  if (!url.startsWith('/') || !internalBackendUrl) return url;
  return `${internalBackendUrl.replace(/\/$/, '')}${url}`;
}

export function useWidgetData(opts: WidgetDataOptions): WidgetFetchState {
  const { sqlQuery, dataUrl } = opts;
  // 這張儀表板「資料設定」選的連線（見 PlaneDataSourceContext）；快取也以解析後的 ID 為 key
  const resolveSource = usePlaneSourceResolver();
  const dataSourceId = opts.dataSourceId ? resolveSource(opts.dataSourceId) : opts.dataSourceId;
  const restSourceId = resolveSource('default-internal');
  /*
   * 跟營運時間比的查詢（operating_now_ms()、班次中心、ETA）：加速重播時營運時間走得快，
   * 30 秒的補查等於營運一個半小時。改成「營運 30 秒左右」補查一次，最快 1 秒。
   */
  const operatingClock = useOperatingClockPace();
  const usesOperatingTime = /operating_(now_ms|day_start_ms|day)\s*\(/i.test(sqlQuery ?? '')
    || /operation-metrics|\/eta\b|vehicle-eta/i.test(dataUrl ?? '');
  const operatingRefreshSec = usesOperatingTime && operatingClock.advancing
    ? Math.max(1, Math.round(30 / Math.max(1, operatingClock.rate)))
    : undefined;
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
   * 查詢失敗：顯示錯誤，跟「查無資料」分開。資料只沿用「上次成功、而且之後沒有遇到
   * 硬邊界（清空／重置）」的那份（暫時連不上時畫面不閃）；遇到硬邊界後就沒有可沿用的資料。
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

  const lastSourceKey = useRef(`${dataSourceId ?? ''}|${restSourceId}`);
  useEffect(() => {
    // 換了連線（切到別的儀表板設定、或改了資料設定）：上一個連線查到的資料不能再顯示，
    // 不然新連線查詢失敗時會繼續秀舊連線的值，看起來像新連線的資料
    const sourceKey = `${dataSourceId ?? ''}|${restSourceId}`;
    if (lastSourceKey.current !== sourceKey) {
      lastSourceKey.current = sourceKey;
      lastGoodData.current = [];
      lastShownJson.current = null;
      setState({ data: [], loading: true, error: null });
    }
    // stream：資料來自 MQTT，SQL hook 不查詢
    if (refreshMode === 'stream') {
      lastGoodData.current = [];
      setState({ data: [], loading: false, error: null });
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    let followUpTimer: ReturnType<typeof setTimeout> | undefined;
    let aborted = false;
    /**
     * 請求順序。回來的結果只在「比畫面上那份新」且「不是硬邊界前送出的」時才採用：
     * 清空訂單、測試重置等硬邊界會讓 validFrom 往前跳，邊界前送出、晚回來的查詢就被丟掉，
     * 不會把已刪除的卡片補回來。一般資料更新（車輛位置、訂單進度）不跳：在途結果照樣顯示，
     * 再由補查換成最新的。
     */
    let requestSeq = 0;
    let appliedSeq = 0;
    let validFrom = 0;
    const isStale = (seq: number) => aborted || seq < validFrom || seq < appliedSeq;
    /**
     * 有界調度：同時最多一支在途；在途時收到的通知／定時只記 dirty，回來後補一支。
     * 兩支之間至少隔 WIDGET_REFRESH_MIN_GAP_MS，失敗時退避。
     */
    let inFlight = false;
    let dirty = false;
    let forcePending = false;
    let lastStartAt = Number.NEGATIVE_INFINITY;
    let errorStreak = 0;
    let invalidatedAt = 0;

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
          errorStreak = 0;
          if (isStale(seq)) return;
          appliedSeq = seq;
          showRows(rows);
        } catch (e: unknown) {
          errorStreak += 1;
          if (isStale(seq)) return;
          appliedSeq = seq;
          showError(e);
        }
        return;
      }

      if (dataUrl?.trim()) {
        try {
          const finalUrl = resolvePlaneRestUrl(
            interpolateVariables(dataUrl, vars),
            getDataSourceById(restSourceId)?.backendUrl,
          );
          const d = await fetchJsonShared(finalUrl, invalidatedAt) as Record<string, unknown> | Record<string, unknown>[];
          errorStreak = 0;
          if (isStale(seq)) return;
          appliedSeq = seq;
          const rows = Array.isArray(d) ? d : ((d.data as Record<string, unknown>[] | undefined) ?? [d]);
          showRows(rows);
        } catch (e: unknown) {
          errorStreak += 1;
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

    const start = () => {
      followUpTimer = undefined;
      if (aborted) return;
      const force = forcePending;
      forcePending = false;
      dirty = false;
      inFlight = true;
      lastStartAt = Date.now();
      void fetchData(force).finally(() => {
        inFlight = false;
        if (dirty) requestRefresh(false);
      });
    };

    /** 排一次重查：在途就記 dirty；否則照最小間隔（失敗時退避）排程，已排的不再往後延 */
    function requestRefresh(force: boolean) {
      if (aborted) return;
      if (force) forcePending = true;
      if (inFlight) {
        dirty = true;
        return;
      }
      if (followUpTimer) return;
      const gap = errorStreak > 0
        ? Math.min(WIDGET_RETRY_MAX_MS, WIDGET_REFRESH_MIN_GAP_MS * 2 ** errorStreak)
        : WIDGET_REFRESH_MIN_GAP_MS;
      const wait = Math.max(0, lastStartAt + gap - Date.now());
      if (wait === 0) start();
      else followUpTimer = setTimeout(start, wait);
    }

    // 資料來源或查詢換了：舊的比對基準作廢
    lastShownJson.current = null;
    setState((s) => ({ ...s, loading: true, error: null }));
    start();

    let timerIntervalSec = refreshMode === 'poll'
      ? refreshInterval
      : refreshMode === 'event'
        ? (refreshInterval && refreshInterval > 0 ? refreshInterval : EVENT_FALLBACK_INTERVAL_SEC)
        : undefined;
    if (operatingRefreshSec) {
      timerIntervalSec = Math.min(timerIntervalSec ?? operatingRefreshSec, operatingRefreshSec);
    }
    if (timerIntervalSec && timerIntervalSec > 0) {
      timer = setInterval(() => requestRefresh(true), timerIntervalSec * 1000);
    }

    let unsubscribeInvalidate: (() => void) | undefined;
    // 輪詢／只查一次的元件也要聽：資料清空後不能等下一輪輪詢，也不能讓失效前的查詢晚回來蓋掉
    if (invalidateTags.length > 0) {
      unsubscribeInvalidate = subscribeDatasourceInvalidation((payload) => {
        if (!tagsOverlap(invalidateTags, payload.tags)) return;
        invalidatedAt = Date.now();
        if (!isSoftInvalidation(payload)) {
          // 硬邊界（清空／重置／換 run）：之前送出的查詢一律作廢，失敗時也不能再拿邊界前的資料頂著
          validFrom = requestSeq + 1;
          lastGoodData.current = [];
        }
        requestRefresh(true);
      });
    }

    // 瀏覽器在背景會節流 timer；切回畫面時立即補查，不必重新進入頁面。
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') requestRefresh(true);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      aborted = true;
      if (timer) clearInterval(timer);
      if (followUpTimer) clearTimeout(followUpTimer);
      unsubscribeInvalidate?.();
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [dataSourceId, restSourceId, sqlQuery, dataUrl, refreshInterval, refreshMode, varsKey, invalidateTags, dataSourceRevision, operatingRefreshSec]);

  return state;
}
