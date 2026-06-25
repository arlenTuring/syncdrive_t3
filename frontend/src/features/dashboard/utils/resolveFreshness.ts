import type { FreshnessPolicy, WidgetDataBinding } from '../types';
import { inferInvalidateTagsFromSql } from './inferInvalidateTagsFromSql';

export type EffectiveRefreshMode = 'stream' | 'once' | 'event' | 'poll';

export interface EffectiveRefresh {
  refreshMode: EffectiveRefreshMode;
  refreshInterval?: number;
  /** 推導出此結果的依據（供進階面板/除錯用人話顯示） */
  reason: string;
}

const DEFAULT_INTERVAL_SEC = 15;

/**
 * 將「使用者面向的 freshnessPolicy」+ 資料來源型別，解析為底層更新機制。
 * 這是平台「幫使用者決定更新機制」的單一真值點：
 *   - 元件只需宣告語意（freshnessPolicy），不需懂 refreshMode / invalidate tag。
 *   - auto 由資料來源推斷：MQTT→即時、可推斷標籤的 SQL→有變更就更新、其餘→僅載入一次。
 * 同時向後相容：未設 freshnessPolicy 時，沿用既有 refreshMode / refreshInterval。
 */
export function resolveFreshness(binding: WidgetDataBinding): EffectiveRefresh {
  const policy = binding.freshnessPolicy;
  const isMqtt = Boolean(binding.mqttDataSourceId || binding.mqttTopic);
  const tags = binding.invalidateTags ?? inferInvalidateTagsFromSql(binding.sqlQuery);
  const hasTags = tags.length > 0;

  // 1) 使用者明確選了非 auto 的策略 → 直接映射
  if (policy && policy !== 'auto') {
    switch (policy) {
      case 'live':
        return { refreshMode: 'stream', reason: '即時串流（MQTT）' };
      case 'on_change':
        return { refreshMode: 'event', reason: '有變更就更新（寫庫後推送重查）' };
      case 'interval': {
        const sec = binding.refreshInterval && binding.refreshInterval > 0
          ? binding.refreshInterval
          : DEFAULT_INTERVAL_SEC;
        return { refreshMode: 'poll', refreshInterval: sec, reason: `定時輪詢（每 ${sec} 秒）` };
      }
      case 'once':
        return { refreshMode: 'once', reason: '僅載入一次' };
    }
  }

  // 2) 向後相容：未指定 freshnessPolicy，但有舊的 refreshMode 設定
  if (!policy && binding.refreshMode) {
    if (binding.refreshMode === 'poll') {
      return {
        refreshMode: 'poll',
        refreshInterval: binding.refreshInterval,
        reason: '定時輪詢（legacy 設定）',
      };
    }
    return { refreshMode: binding.refreshMode, reason: `沿用既有設定（${binding.refreshMode}）` };
  }

  // 3) auto（或完全未設定）：平台依資料來源型別推斷
  if (isMqtt) {
    return { refreshMode: 'stream', reason: '自動：MQTT 來源 → 即時串流' };
  }
  if (hasTags) {
    return { refreshMode: 'event', reason: '自動：可推斷資料表 → 有變更就更新' };
  }
  if (binding.refreshInterval && binding.refreshInterval > 0) {
    return {
      refreshMode: 'poll',
      refreshInterval: binding.refreshInterval,
      reason: `自動：沿用既有輪詢（每 ${binding.refreshInterval} 秒）`,
    };
  }
  return { refreshMode: 'once', reason: '自動：無推送來源 → 僅載入一次' };
}

/** 使用者面向選項的人話標籤（供下拉選單） */
export const FRESHNESS_POLICY_OPTIONS: ReadonlyArray<{
  value: FreshnessPolicy;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: '自動（建議）', hint: '由平台依資料來源決定更新方式' },
  { value: 'live', label: '即時', hint: '位置、速度、ETA、燈號等高頻資料（MQTT 串流）' },
  { value: 'on_change', label: '有變更就更新', hint: '訂單、事件、名冊、KPI：寫庫後約 1 秒內更新' },
  { value: 'interval', label: '定時更新', hint: '僅建議用於無法即時推送的資料；會重複查詢資料庫' },
  { value: 'once', label: '僅載入一次', hint: '靜態設定、路線結構等不會變動的資料' },
];
