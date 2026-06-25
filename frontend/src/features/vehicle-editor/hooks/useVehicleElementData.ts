import { useMemo } from 'react';
import type { WidgetDataBinding } from '../../dashboard/types';
import { useWidgetData } from '../../dashboard/elements/useWidgetData';
import { useMqttData } from '../../dashboard/elements/useMqttData';
import { parseOpenPercentFromPayload } from '../../map-editor/utils/psdOpenPercent';

const EMPTY_BINDING: WidgetDataBinding = {
  dataSourceId: '',
  sqlQuery: '',
};

export function useVehicleElementData(
  binding: WidgetDataBinding,
  previewData?: Record<string, unknown>,
  opts?: { livePayloadOnly?: boolean },
): {
  row: Record<string, unknown> | null;
  mqttPayload: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
} {
  const hasPreview = Boolean(previewData && Object.keys(previewData).length > 0);
  const skipBinding = Boolean(opts?.livePayloadOnly && hasPreview);
  const effectiveBinding = skipBinding ? EMPTY_BINDING : binding;

  const sql = useWidgetData({
    dataSourceId: effectiveBinding.dataSourceId,
    sqlQuery: effectiveBinding.sqlQuery,
    dataUrl: effectiveBinding.dataUrl,
    refreshInterval: effectiveBinding.refreshInterval,
  });

  const mqtt = useMqttData({
    mqttDataSourceId: effectiveBinding.mqttDataSourceId,
    mqttTopic: effectiveBinding.mqttTopic,
    mqttValuePath: effectiveBinding.mqttValuePath,
  });

  const row = useMemo(() => {
    const preview =
      previewData && Object.keys(previewData).length > 0 ? previewData : null;
    if (skipBinding) return preview;

    let live: Record<string, unknown> | null = null;
    if (sql.data.length > 0) {
      live = sql.data[0] ?? null;
    } else if (mqtt.data && typeof mqtt.data === 'object') {
      const m = mqtt.data as Record<string, unknown>;
      live =
        m.value !== undefined && Object.keys(m).length === 1
          ? { value: m.value }
          : m;
    }
    if (!live && !preview) return null;
    if (!live) return preview;
    if (!preview) return live;
    /** 載具編輯器：previewData 優先，避免 MQTT 蓋過測試面板的關燈等設定 */
    return { ...live, ...preview };
  }, [skipBinding, sql.data, mqtt.data, previewData]);

  const mqttPayload = useMemo(() => {
    if (skipBinding) return previewData ?? null;
    if (mqtt.data && typeof mqtt.data === 'object') {
      return mqtt.data as Record<string, unknown>;
    }
    return row;
  }, [skipBinding, mqtt.data, previewData, row]);

  return {
    row,
    mqttPayload,
    loading: skipBinding ? false : sql.loading,
    error: skipBinding ? null : (sql.error ?? mqtt.error),
  };
}

export function readDoorOpenPercent(
  data: Record<string, unknown> | null,
  openPercentField: string,
  defaultOpenPercent: number,
): number {
  if (!data) return defaultOpenPercent;
  const fromParser = parseOpenPercentFromPayload(data, openPercentField);
  if (fromParser !== undefined) return fromParser;
  const raw = data[openPercentField];
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  if (Number.isFinite(n)) return Math.min(100, Math.max(0, n));
  return defaultOpenPercent;
}

export function readDoorAlarm(
  data: Record<string, unknown> | null,
  alarmField?: string,
): boolean {
  if (!data || !alarmField?.trim()) return false;
  const raw = data[alarmField];
  if (typeof raw === 'boolean') return raw;
  return String(raw).toLowerCase() === 'true' || String(raw).toUpperCase() === 'ALARM';
}
