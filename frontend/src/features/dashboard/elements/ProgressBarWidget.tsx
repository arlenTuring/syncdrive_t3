import { useMemo } from 'react';
import type { ProgressBarWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables } from '../VariableContext';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveNumericEditPreview,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

export function ProgressBarWidgetView({ widget }: { widget: ProgressBarWidget }) {
  const isEditMode = useIsEditMode();
  const variables = useVariables();
  const hasBinding = widgetHasDataBinding(widget);

  const { data } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
    refreshMode: widget.refreshMode,
    invalidateTags: widget.invalidateTags,
    freshnessPolicy: widget.freshnessPolicy,
  });

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: widget.mqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  let rawValue: number = widget.min;
  let hasLiveData = false;
  if (mqttData.data !== null) {
    rawValue = Number(mqttData.data.value ?? mqttData.data) || widget.min;
    hasLiveData = true;
  } else if (data.length > 0 && widget.valueField) {
    rawValue = Number(data[0][widget.valueField]) || widget.min;
    hasLiveData = true;
  } else {
    const interpolated = interpolateVariables(`{${widget.valueField}}`, variables);
    if (interpolated !== `{${widget.valueField}}`) {
      rawValue = Number(interpolated) || widget.min;
      hasLiveData = true;
    }
  }

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasLiveData);
  if (isEditPreview) {
    rawValue = resolveNumericEditPreview({
      valueField: widget.valueField,
      min: widget.min,
      max: widget.max,
    });
  }

  const ratio = Math.max(0, Math.min(1, (rawValue - widget.min) / (widget.max - widget.min || 1)));

  // 根據 ratio 計算顏色（colorStops 插值）
  const fillColor = useMemo(() => {
    const stops = [...(widget.colorStops || [])].sort((a, b) => a.at - b.at);
    if (!stops.length) return '#3b82f6';
    if (ratio <= stops[0].at) return stops[0].color;
    if (ratio >= stops[stops.length - 1].at) return stops[stops.length - 1].color;
    for (let i = 0; i < stops.length - 1; i++) {
      if (ratio >= stops[i].at && ratio <= stops[i + 1].at) {
        return stops[i + 1].color; // 簡化：取上一個節點顏色
      }
    }
    return '#3b82f6';
  }, [ratio, widget.colorStops]);

  const label = interpolateVariables(widget.label, variables);
  const isH = widget.orientation !== 'vertical';
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const labelFs = widget.labelFontSize ?? 10;
  const valueFs = widget.valueFontSize ?? 10;

  return (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'progress-bar' })}
    >
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: isH ? 'column' : 'row',
      alignItems: isH ? 'stretch' : 'center',
      justifyContent: 'center',
      gap: 4, padding: '4px 6px', boxSizing: 'border-box',
    }}>
      {/* Label row */}
      {widget.showLabel && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: labelFs, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace',
        }}>
          <span>{label}</span>
          {widget.showValue && <span style={{ color: fillColor, fontWeight: 700 }}>{pct}</span>}
        </div>
      )}

      {/* Track */}
      <div style={{
        flex: isH ? undefined : 1,
        width: isH ? '100%' : 'auto',
        height: isH ? undefined : '100%',
        [isH ? 'height' : 'width']: isH ? '100%' : '100%',
        background: widget.trackColor || 'rgba(255,255,255,0.08)',
        borderRadius: widget.borderRadius,
        overflow: 'hidden',
        flexGrow: 1,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          ...(isH
            ? { left: 0, top: 0, bottom: 0, width: `${ratio * 100}%` }
            : { left: 0, right: 0, bottom: 0, height: `${ratio * 100}%` }),
          background: fillColor,
          borderRadius: widget.borderRadius,
          transition: 'width 0.85s cubic-bezier(0.22, 1, 0.36, 1), height 0.85s cubic-bezier(0.22, 1, 0.36, 1), background 0.4s ease',
        }} />
        {/* Inline value (no separate label) */}
        {widget.showValue && !widget.showLabel && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: valueFs, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace', fontWeight: 700,
          }}>
            {pct}
          </div>
        )}
      </div>
    </div>
    </WidgetEditPreviewOutline>
  );
}
