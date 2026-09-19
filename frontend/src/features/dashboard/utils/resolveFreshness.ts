import type { FreshnessPolicy, WidgetDataBinding } from '../types';
import { inferInvalidateTagsFromSql } from './inferInvalidateTagsFromSql';

export type EffectiveRefreshMode = 'stream' | 'once' | 'event' | 'poll';

export type FreshnessReasonKey =
  | 'live'
  | 'on_change'
  | 'interval'
  | 'once'
  | 'legacy_poll'
  | 'legacy_mode'
  | 'auto_mqtt'
  | 'auto_tags'
  | 'auto_poll'
  | 'auto_once';

export interface EffectiveRefresh {
  refreshMode: EffectiveRefreshMode;
  refreshInterval?: number;
  /** i18n key under dashboard.properties.freshnessReason.* */
  reasonKey: FreshnessReasonKey;
  reasonParams?: Record<string, string | number>;
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
        return { refreshMode: 'stream', reasonKey: 'live' };
      case 'on_change':
        return {
          refreshMode: 'event',
          refreshInterval: binding.refreshInterval,
          reasonKey: 'on_change',
        };
      case 'interval': {
        const sec = binding.refreshInterval && binding.refreshInterval > 0
          ? binding.refreshInterval
          : DEFAULT_INTERVAL_SEC;
        return { refreshMode: 'poll', refreshInterval: sec, reasonKey: 'interval', reasonParams: { sec } };
      }
      case 'once':
        return { refreshMode: 'once', reasonKey: 'once' };
    }
  }

  // 2) 向後相容：未指定 freshnessPolicy，但有舊的 refreshMode 設定
  if (!policy && binding.refreshMode) {
    if (binding.refreshMode === 'poll') {
      return {
        refreshMode: 'poll',
        refreshInterval: binding.refreshInterval,
        reasonKey: 'legacy_poll',
      };
    }
    return {
      refreshMode: binding.refreshMode,
      refreshInterval: binding.refreshMode === 'event' ? binding.refreshInterval : undefined,
      reasonKey: 'legacy_mode',
      reasonParams: { mode: binding.refreshMode },
    };
  }

  // 3) auto（或完全未設定）：平台依資料來源型別推斷
  if (isMqtt) {
    return { refreshMode: 'stream', reasonKey: 'auto_mqtt' };
  }
  if (hasTags) {
    return { refreshMode: 'event', reasonKey: 'auto_tags' };
  }
  if (binding.refreshInterval && binding.refreshInterval > 0) {
    return {
      refreshMode: 'poll',
      refreshInterval: binding.refreshInterval,
      reasonKey: 'auto_poll',
      reasonParams: { sec: binding.refreshInterval },
    };
  }
  return { refreshMode: 'once', reasonKey: 'auto_once' };
}

/** 使用者面向選項（標籤／說明改由 i18n：freshnessOpt / freshnessHint） */
export const FRESHNESS_POLICY_OPTIONS: ReadonlyArray<{
  value: FreshnessPolicy;
}> = [
  { value: 'auto' },
  { value: 'live' },
  { value: 'on_change' },
  { value: 'interval' },
  { value: 'once' },
];
