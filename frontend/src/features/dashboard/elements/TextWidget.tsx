import React from 'react';
import type { TextWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables } from '../VariableContext';
import { getSeverityStyle } from '../constants/severityTheme';
import {
  extractMqttWrappedValue,
  formatMqttDisplayScalar,
  resolveMqttFieldValue,
  unwrapMqttPayload,
} from '../utils/mqttFieldResolve';
import { resolveVehicleLocationLabel } from '../utils/resolveVehicleLocationLabel';
import { editPreviewTextStyle } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetEditPreview,
  shouldShowEditPreview,
  widgetHasDataBinding,
  normalizeValueFieldKey,
} from '../utils/widgetEditPreview';
import * as LucideIcons from 'lucide-react';
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
  textHorizontalToJustify,
  textVerticalToAlignItems,
} from '../../../lib/textAlignment';

export function TextWidgetView({ widget }: { widget: TextWidget }) {
  const isEditMode = useIsEditMode();
  const variables = useVariables();
  const hasBinding = widgetHasDataBinding(widget);
  const textAlign = resolveTextHorizontalAlign(widget.textAlign);
  const verticalAlign = resolveTextVerticalAlign(widget.verticalAlign);

  // 1. 資料讀取
  const sqlData = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
    refreshMode: widget.refreshMode,
    invalidateTags: widget.invalidateTags,
    freshnessPolicy: widget.freshnessPolicy,
  });

  const resolvedMqttTopic = widget.mqttTopic
    ? interpolateVariables(widget.mqttTopic, variables)
    : undefined;

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: resolvedMqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  /*
   * 位置列要多訂一條 telemetry/update。
   *
   * 這一列綁的是 operation/update，那裡面只有目標站與剩餘距離，沒有「現在在第幾段」。
   * 段號得由車端回報的座標分，而座標在 telemetry/update。少了這一條，跑在正線上的車
   * 位置只能顯示「—」。
   */
  const isVehicleLocationLabel =
    /^\{[^{}]+\}$/.test(widget.content.trim())
    && normalizeValueFieldKey(widget.content) === 'segment_label';
  const telemetryTopic =
    isVehicleLocationLabel && widget.mqttTopic
      ? interpolateVariables(
        widget.mqttTopic.replace(/\/operation\/update$/, '/telemetry/update'),
        variables,
      )
      : undefined;
  const telemetryMqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: telemetryTopic,
  });

  // content 本身先做變數插值（支援 {varName} 格式）
  let interpolatedContent = interpolateVariables(widget.content, variables);
  const isTemplatePlaceholder = /\{[^{}]+\}/.test(widget.content);

  // 複合模板（如「發車 {depart_time}」）：未注入的占位符改為 —，避免畫布露出 {…}
  if (!isEditMode && isTemplatePlaceholder && /\{[^{}]+\}/.test(interpolatedContent)) {
    interpolatedContent = interpolatedContent.replace(/\{([^{}]+)\}/g, (_, key: string) => {
      const k = key.trim();
      const val = variables[k];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val);
      }
      return '—';
    });
  }

  let displayValue: string = interpolatedContent;
  let rawValue: any = null;
  const colorField = widget.colorOnlyField ?? (widget.colorRulesEnabled ? widget.valueField : undefined);

  if (isVehicleLocationLabel) {
    const operation = mqttData.data !== null ? unwrapMqttPayload(mqttData.data) : null;
    const telemetry =
      telemetryMqttData.data !== null ? unwrapMqttPayload(telemetryMqttData.data) : null;
    const loc = resolveVehicleLocationLabel({ variables, operation, telemetry });
    const hasLocContext = mqttData.data !== null
      || telemetryMqttData.data !== null
      || variables.segment_label !== undefined
      || variables.yard_slot_id !== undefined
      || variables.line_kind !== undefined
      || variables.trip_code !== undefined;
    if (hasLocContext) {
      displayValue = loc;
      if (loc !== '—') rawValue = loc;
    }
  } else if (mqttData.data !== null && !widget.colorOnlyField) {
    const mqttScalar = formatMqttDisplayScalar(extractMqttWrappedValue(mqttData.data));
    if (mqttScalar !== undefined) {
      rawValue = extractMqttWrappedValue(mqttData.data);
      displayValue = mqttScalar;
    }
  } else if (widget.valueField && !widget.colorOnlyField && variables[widget.valueField] !== undefined) {
    rawValue = variables[widget.valueField];
    displayValue = String(rawValue);
  } else if (!widget.colorOnlyField && sqlData.data.length > 0) {
    rawValue = sqlData.data[0][widget.valueField || ''] ?? sqlData.data[0].content;
    if (rawValue !== undefined) {
      displayValue = String(rawValue);
    }
  }

  if (colorField && mqttData.data !== null) {
    const fromMqtt = resolveMqttFieldValue(mqttData.data, colorField);
    if (fromMqtt !== null && fromMqtt !== undefined) {
      rawValue = fromMqtt;
    }
  }
  if (colorField && (rawValue === null || rawValue === undefined) && variables[colorField] !== undefined) {
    rawValue = variables[colorField];
  } else if (colorField && (rawValue === null || rawValue === undefined) && sqlData.data.length > 0 && sqlData.data[0][colorField] !== undefined) {
    rawValue = sqlData.data[0][colorField];
  }

  const isPureVariableTemplate = /^\{[^{}]+\}$/.test(widget.content.trim());
  const contentVarKey = isPureVariableTemplate ? normalizeValueFieldKey(widget.content) : undefined;
  // 有 valueField 綁定時即使 content 為空也要顯示資料（如班次中心「剩餘 N 班次」）
  const isIconOnly = !widget.content.trim()
    && Boolean(widget.icon || widget.iconImage)
    && !widget.valueField?.trim();
  const interpolatedFromVars = interpolatedContent !== widget.content
    && !/\{[^{}]+\}/.test(interpolatedContent);

  const hasLiveData = mqttData.data !== null
    || sqlData.data.length > 0
    || (widget.valueField !== undefined && variables[widget.valueField] !== undefined)
    || (contentVarKey !== undefined && variables[contentVarKey] !== undefined)
    || interpolatedFromVars;

  const hasDisplayableLive = Boolean(hasLiveData)
    && displayValue !== ''
    && displayValue !== 'undefined';
  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasDisplayableLive);
  if (isEditPreview) {
    displayValue = resolveWidgetEditPreview({
      valueField: widget.valueField ?? normalizeValueFieldKey(widget.content),
      content: widget.content,
      type: 'text',
    });
  } else if (isEditMode && isPureVariableTemplate && !hasDisplayableLive) {
    displayValue = resolveWidgetEditPreview({
      valueField: normalizeValueFieldKey(widget.content),
      content: widget.content,
      type: 'text',
    });
  }

  const hideWhenEmpty = !isEditMode && Boolean(
    (widget.valueField && widget.dataSourceId && displayValue === '')
    || (isPureVariableTemplate && displayValue === ''),
  );

  // 2. 樣式處理
  const IconComponent = widget.icon ? (LucideIcons as any)[widget.icon] : null;

  if (hideWhenEmpty) {
    return <div style={{ width: '100%', height: '100%' }} />;
  }

  if (isIconOnly) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: textVerticalToAlignItems(verticalAlign),
          justifyContent: textHorizontalToJustify(textAlign),
          padding: widget.contentPadding ?? '0',
          boxSizing: 'border-box',
          color: widget.color,
        }}
      >
        {widget.iconImage ? (
          <img
            src={widget.iconImage}
            style={{ width: widget.fontSize + 4, height: widget.fontSize + 4, objectFit: 'contain' }}
            alt=""
          />
        ) : (
          IconComponent && <IconComponent size={widget.fontSize + 2} strokeWidth={2.5} />
        )}
      </div>
    );
  }

  let dynamicStyle: React.CSSProperties = {
    color: widget.color,
    backgroundColor: widget.backgroundColor || 'transparent',
    borderRadius: widget.borderRadius ?? 0,
    border: `${widget.borderWidth ?? 0}px solid ${widget.borderColor || 'transparent'}`,
  };

  if (widget.severityTextColor) {
    const severityKey = widget.colorOnlyField || 'severity';
    const fromSql = sqlData.data[0]?.[severityKey];
    const severity = fromSql ?? variables[severityKey] ?? variables.severity;
    dynamicStyle = {
      ...dynamicStyle,
      color: getSeverityStyle(severity).stripText,
    };
  }

  // 條件著色覆蓋
  if (widget.colorRulesEnabled && widget.colorRules && widget.colorRules.length > 0 && rawValue !== null) {
    for (const rule of widget.colorRules) {
      let match = false;
      const val = isNaN(Number(rawValue)) ? rawValue : Number(rawValue);
      const threshold = isNaN(Number(rule.threshold)) ? rule.threshold : Number(rule.threshold);

      switch (rule.condition) {
        case 'gt': match = val > threshold; break;
        case 'lt': match = val < threshold; break;
        case 'eq': match = val === threshold; break;
        case 'gte': match = val >= threshold; break;
        case 'lte': match = val <= threshold; break;
        case 'contains': match = String(val).includes(String(threshold)); break;
        case 'status_eq': match = String(val) === String(rule.threshold); break;
      }

      if (match) {
        dynamicStyle = {
          ...dynamicStyle,
          color: rule.textColor,
          backgroundColor: rule.bgColor,
          borderColor: rule.borderColor || dynamicStyle.borderColor,
        };
        break;
      }
    }
  }

  const isValueFieldDisplay = Boolean(widget.valueField?.trim()) && !widget.content.trim();
  const singleLine = widget.textWrap === 'nowrap'
    || (isTemplatePlaceholder && !isValueFieldDisplay);
  const padding =
    widget.contentPadding
    ?? (singleLine ? '2px 2px' : isValueFieldDisplay ? '0' : isTemplatePlaceholder ? '0 2px' : '4px 12px');
  const hasIcon = Boolean(widget.icon || widget.iconImage);
  const iconGapPx = widget.iconGap ?? (singleLine ? 4 : 8);
  // 置中／靠右時若讓文字 span 撐滿寬度，文字會在 span 內對齊而與圖示拉開（iconGap 無法控制）
  const groupIconWithText = hasIcon && (textAlign === 'center' || textAlign === 'right');

  const iconEl = widget.iconImage ? (
    <img
      src={widget.iconImage}
      style={{ width: widget.fontSize + 4, height: widget.fontSize + 4, objectFit: 'contain', flexShrink: 0 }}
      alt="icon"
    />
  ) : (
    IconComponent && <IconComponent size={widget.fontSize + 2} strokeWidth={2.5} style={{ flexShrink: 0 }} />
  );

  const textEl = (
    <span
      style={{
        flex: singleLine && !groupIconWithText ? '1 1 0' : undefined,
        minWidth: 0,
        maxWidth: '100%',
        overflow: singleLine ? 'hidden' : undefined,
        textOverflow: singleLine ? 'ellipsis' : undefined,
        textAlign: groupIconWithText ? 'left' : textAlign,
        ...(isEditPreview ? editPreviewTextStyle : {}),
      }}
    >
      {displayValue !== '' ? displayValue : (widget.dataSourceId || isPureVariableTemplate || isIconOnly ? '' : '（無資料）')}
    </span>
  );

  const inner = groupIconWithText ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: iconGapPx,
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {iconEl}
      {textEl}
    </div>
  ) : (
    <>
      {iconEl}
      {textEl}
    </>
  );

  const tooltip = widget.tooltip ? interpolateVariables(widget.tooltip, variables).trim() : undefined;
  return (
    <div
      title={tooltip || undefined}
      style={{
        width: '100%', height: '100%',
        fontSize: widget.fontSize,
        lineHeight: widget.lineHeight,
        fontFamily: widget.fontFamily,
        fontWeight: widget.fontWeight,
        textAlign,
        padding,
        wordBreak: singleLine ? 'keep-all' : 'break-word',
        overflow: 'hidden',
        textOverflow: singleLine ? 'ellipsis' : undefined,
        whiteSpace: singleLine ? 'nowrap' : 'pre-wrap',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: textVerticalToAlignItems(verticalAlign),
        justifyContent: textHorizontalToJustify(textAlign),
        gap: hasIcon && !groupIconWithText ? iconGapPx : 0,
        transition: 'all 0.2s ease',
        ...dynamicStyle,
      }}
    >
      {inner}
    </div>
  );
}
