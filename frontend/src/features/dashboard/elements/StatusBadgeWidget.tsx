import type { StatusBadgeWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables } from '../VariableContext';
import { resolveVehicleMonitorBadge } from '../utils/resolveVehicleMonitorBadge';
import { resolveMainlineStatusStyleFromLabel } from '../utils/mainlineTaskModel';
import { editPreviewTextStyle } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetEditPreview,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

function isVehicleMonitorBadgeWidget(widget: StatusBadgeWidget): boolean {
  const field = widget.valueField?.trim() ?? '';
  return field.includes('badge_label') || field.includes('trip_code');
}

function isShiftStatusLabelBadge(widget: StatusBadgeWidget): boolean {
  const field = widget.valueField?.trim() ?? '';
  return field.includes('status_label');
}

export function StatusBadgeWidgetView({ widget }: { widget: StatusBadgeWidget }) {
  const isEditMode = useIsEditMode();
  const variables = useVariables();
  const hasBinding = widgetHasDataBinding(widget);
  const vehicleBadge = isVehicleMonitorBadgeWidget(widget);

  const { data } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
  });

  const resolvedMqttTopic = widget.mqttTopic
    ? interpolateVariables(widget.mqttTopic, variables)
    : undefined;

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: resolvedMqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  const operationPayload =
    mqttData.data !== null && typeof mqttData.data === 'object' && !Array.isArray(mqttData.data)
      ? (mqttData.data as Record<string, unknown>)
      : null;

  let rawValue: string = '';
  let hasLiveData = false;
  let resolvedBadge: ReturnType<typeof resolveVehicleMonitorBadge> | null = null;

  if (vehicleBadge) {
    resolvedBadge = resolveVehicleMonitorBadge(variables, { operation: operationPayload });
    rawValue = resolvedBadge.label;
    // resolveVehicleMonitorBadge 已同時處理 MQTT 與 SQL fallback。若最新
    // operation/update 明確回報 IDLE，它會刻意回傳空徽章；這裡不可再把 SQL
    // 裡尚未結束的舊整備單補回來，否則就會出現「位置 D1、狀態充電」。
    hasLiveData = !!rawValue || !!operationPayload;
  } else if (mqttData.data !== null) {
    rawValue = String(mqttData.data.value ?? mqttData.data);
    hasLiveData = !!rawValue;
  } else if (data.length > 0 && widget.valueField) {
    const v = data[0][widget.valueField];
    rawValue = v !== undefined ? String(v) : '';
    hasLiveData = !!rawValue;
  }

  if (!rawValue && !vehicleBadge) {
    const varKey = widget.valueField ? widget.valueField.replace(/[{}]/g, '').trim() : '';
    if (varKey && variables[varKey] !== undefined && variables[varKey] !== null && String(variables[varKey]).trim() !== '') {
      rawValue = String(variables[varKey]);
      hasLiveData = true;
    } else {
      const interpolated = interpolateVariables(widget.valueField, variables);
      if (interpolated !== widget.valueField) {
        rawValue = interpolated;
        hasLiveData = true;
      }
    }
  }

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasLiveData);
  if (isEditPreview && !rawValue) {
    rawValue = resolveWidgetEditPreview({
      valueField: widget.valueField,
      label: widget.defaultLabel,
      type: 'status-badge',
    });
  }

  const resolvedBadgeFinal = vehicleBadge
    ? (resolvedBadge ?? resolveVehicleMonitorBadge(variables, { operation: operationPayload }))
    : null;

  const rule = widget.rules.find(r => r.value === rawValue);
  let bgColor = (resolvedBadgeFinal?.bg || rule?.bgColor) || widget.defaultBgColor;
  let textColor = (resolvedBadgeFinal?.color || rule?.textColor) || widget.defaultTextColor;
  const rawLabel = vehicleBadge
    ? rawValue
    : (rule?.label ?? (rawValue || widget.defaultLabel));

  const label = interpolateVariables(rawLabel, variables);

  const shiftStatusStyle = isShiftStatusLabelBadge(widget) && label
    ? resolveMainlineStatusStyleFromLabel(label)
    : null;
  if (shiftStatusStyle) {
    bgColor = shiftStatusStyle.status_bg;
    textColor = shiftStatusStyle.status_color;
  } else {
    if (widget.variableBgKey && variables[widget.variableBgKey] !== undefined && !resolvedBadgeFinal?.bg) {
      bgColor = String(variables[widget.variableBgKey]);
    }
    if (widget.variableColorKey && variables[widget.variableColorKey] !== undefined && !resolvedBadgeFinal?.color) {
      textColor = String(variables[widget.variableColorKey]);
    }
  }
  if (vehicleBadge && !label) {
    return <div style={{ width: '100%', height: '100%' }} />;
  }

  const outline = widget.badgeStyle === 'outline'
    || (widget.outlineFromVarKey
      ? String(variables[widget.outlineFromVarKey] ?? '') === '1'
      : rawValue === '離線');

  const compact = widget.badgeVariant === 'compact';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '0 2px' : '0 10px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: compact ? 3 : 6,
          backgroundColor: outline ? 'transparent' : bgColor,
          color: textColor,
          borderRadius: widget.borderRadius,
          padding: compact
            ? ((widget.fontSize ?? 12) >= 14 ? '4px 8px' : '1px 6px')
            : '3px 10px',
          fontSize: widget.fontSize,
          fontFamily: compact ? 'system-ui, sans-serif' : 'monospace',
          fontWeight: 500,
          letterSpacing: compact ? '0.02em' : '0.05em',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
          lineHeight: 1.1,
          border: outline
            ? `1px solid ${widget.outlineBorderColor ?? 'rgba(228,228,231,0.75)'}`
            : undefined,
          ...(isEditPreview ? editPreviewTextStyle : {}),
        }}
      >
        {widget.showDot && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: textColor,
              flexShrink: 0,
              boxShadow: `0 0 6px ${textColor}`,
            }}
          />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </div>
    </div>
  );
}
