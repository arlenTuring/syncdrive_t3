import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CanvasElementProps, FreshnessPolicy, GenericGroupConfig, GroupTemplateDef } from '../types';
import { useWidgetData, type WidgetFetchState } from './useWidgetData';
import { buildCandidatesFromSource, selectTemplate } from '../utils/groupCandidates';
import { assignPrioritySlots, type PrioritySlotCell } from '../utils/groupPriorityPool';

/** 有效開始／結束時間到了要自動重新評估（規格 §6），不能只靠資料更新觸發。 */
const REVALIDATE_TICK_MS = 15_000;

function GenericSourceFetcher({
  sourceIndex,
  dataSourceId,
  sqlQuery,
  dataUrl,
  mqttDataSourceId,
  mqttTopic,
  mqttValuePath,
  freshnessPolicy,
  refreshInterval,
  refreshMode,
  invalidateTags,
  onResult,
}: {
  sourceIndex: string;
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string;
  freshnessPolicy?: FreshnessPolicy;
  refreshInterval?: number;
  refreshMode?: CanvasElementProps['refreshMode'];
  invalidateTags?: string[];
  onResult: (sourceId: string, state: WidgetFetchState) => void;
}) {
  // 每個來源各自一個元件實例呼叫一次 useWidgetData——來源數量是動態的（使用者設定），
  // React hook 規則不允許在同一個元件裡對可變長度陣列直接迴圈呼叫 hook，所以拆成
  // 「一個來源一個隱形子元件」，各自管自己的連線、載入、失敗與更新時間。
  const state = useWidgetData({
    dataSourceId,
    sqlQuery,
    dataUrl,
    mqttDataSourceId,
    mqttTopic,
    mqttValuePath,
    freshnessPolicy,
    refreshInterval,
    refreshMode,
    invalidateTags,
  });
  useEffect(() => {
    onResult(sourceIndex, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIndex, state]);
  return null;
}

export interface GenericGroupSlotsState {
  /** 掛載每個來源的隱形抓資料元件；渲染時直接輸出到樹裡即可（不佔版面） */
  fetchers: ReactNode;
  slots: PrioritySlotCell[];
  pendingCount: number;
  /** 任一來源仍在首次載入（尚未有任何資料） */
  isInitialLoading: boolean;
  /** 已選定的樣板（依 slot 索引對齊，null 代表用 element.children 備援） */
  templatesBySlot: (GroupTemplateDef | null)[];
}

/**
 * 泛用群組的候選→有效性→優先→可見項目管線（React 整合層）。純邏輯已經在
 * groupCandidates.ts／groupPriorityPool.ts 各自測過，這裡只負責：接資料來源、
 * 定時重新評估、維持格位池跨渲染的狀態。
 */
export function useGenericGroupSlots(
  config: GenericGroupConfig | undefined,
  capacity: number,
  opts?: {
    /**
     * 依 `source.postProcessId` 查表的後處理函式（來源列表 → 轉換後的列表），
     * 在建立候選項目之前套用。平台本身不提供任何處理器、不認得任何 id——
     * 有沒有處理器、處理器做什麼，完全由呼叫端（渲染這個群組的頁面）決定。
     */
    sourcePostProcessors?: Record<string, (rows: Record<string, unknown>[]) => Record<string, unknown>[]>;
  },
): GenericGroupSlotsState {
  const sources = useMemo(() => config?.sources ?? [], [config?.sources]);

  const [resultsMap, setResultsMap] = useState<Record<string, WidgetFetchState>>({});
  const onResult = useCallback((sourceId: string, state: WidgetFetchState) => {
    setResultsMap((prev) => (prev[sourceId] === state ? prev : { ...prev, [sourceId]: state }));
  }, []);

  const fetchers = useMemo(
    () =>
      sources.map((s) => (
        <GenericSourceFetcher
          key={s.id}
          sourceIndex={s.id}
          dataSourceId={s.dataSourceId}
          sqlQuery={s.sqlQuery}
          dataUrl={s.dataUrl}
          mqttDataSourceId={s.mqttDataSourceId}
          mqttTopic={s.mqttTopic}
          mqttValuePath={s.mqttValuePath}
          freshnessPolicy={s.freshnessPolicy}
          refreshInterval={s.refreshInterval}
          refreshMode={s.refreshMode}
          invalidateTags={s.invalidateTags}
          onResult={onResult}
        />
      )),
    [sources, onResult],
  );

  // 到達有效開始／結束時間要自動重新評估，不能只在資料變動時才重算——沒有任何新
  // 訊息時，跨過設定的時間點也要讓可見項目更新（規格 §6、驗收案例 5）。
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), REVALIDATE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const isInitialLoading = sources.some((s) => {
    const r = resultsMap[s.id];
    return !r || (r.loading && r.data.length === 0);
  });

  const poolRef = useRef<PrioritySlotCell[]>(Array.from({ length: capacity }, () => null));

  const { slots, pendingCount } = useMemo(() => {
    const candidates = sources.flatMap((source) => {
      const result = resultsMap[source.id];
      // 查詢失敗不等同成功回傳空集合：這個來源這次沒有可信資料，整批跳過，
      // 不動其他來源，也不會被優先池誤判成「候選消失」而抽掉已顯示的項目
      // ——useWidgetData 本身在失敗時已經回退保留上次成功的資料，這裡再擋一層：
      // 完全沒有 result（還沒掛載完成）才跳過；有 result 就照它目前的 data 走。
      if (!result) return [];
      const postProcess = source.postProcessId ? opts?.sourcePostProcessors?.[source.postProcessId] : undefined;
      const rows = postProcess ? postProcess(result.data) : result.data;
      return buildCandidatesFromSource({
        source,
        rows,
        groupItemIdField: config?.itemIdField,
        mergeIdField: config?.mergeIdField,
        validityRules: config?.validityRules,
        priorityRules: config?.priorityRules,
        groupDefaultPriority: config?.defaultPriority,
        sortRules: config?.sortRules,
      });
    });
    const result = assignPrioritySlots(poolRef.current, candidates, capacity, {
      preemptEqualPriority: config?.preemptEqualPriority,
    });
    poolRef.current = result.slots;
    return result;
    // tick 只用來強制重新跑一次（時間相關的 valid 判斷可能因為時間經過而改變，
    // 資料本身沒變也要重算），不放進任何欄位讀取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, resultsMap, capacity, config, tick, opts?.sourcePostProcessors]);

  const templatesBySlot = slots.map((cell) => (cell ? selectTemplate(cell.row, config?.templates) : null));

  return { fetchers, slots, pendingCount, isInitialLoading, templatesBySlot };
}
