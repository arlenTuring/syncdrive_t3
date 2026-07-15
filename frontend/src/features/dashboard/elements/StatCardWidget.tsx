import * as LucideIcons from 'lucide-react';
import type { StatCardWidget, StatCardLabelPosition } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables } from '../VariableContext';
import { type CSSProperties, type ReactNode } from 'react';
import { resolveWidgetChrome } from '../utils/widgetChrome';
import { resolveMqttFieldValue } from '../utils/mqttFieldResolve';
import { editPreviewTextStyle } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetEditPreview,
  resolveNumericEditPreview,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

const FONT_UI = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

function alignToFlex(align: StatCardWidget['contentAlign']): CSSProperties['justifyContent'] {
  if (align === 'left') return 'flex-start';
  if (align === 'right') return 'flex-end';
  return 'center';
}

/** 標籤與數值區的排列（不含整卡對齊） */
function labelValueLayout(position: StatCardLabelPosition): {
  flexDirection: CSSProperties['flexDirection'];
  labelFirst: boolean;
} {
  switch (position) {
    case 'bottom':
      return { flexDirection: 'column', labelFirst: false };
    case 'left':
      return { flexDirection: 'row', labelFirst: true };
    case 'right':
      return { flexDirection: 'row', labelFirst: false };
    case 'top':
    default:
      return { flexDirection: 'column', labelFirst: true };
  }
}

export function StatCardWidgetView({ widget }: { widget: StatCardWidget }) {
  const isEditMode = useIsEditMode();
  const variables = useVariables();
  const hasBinding = widgetHasDataBinding(widget);

  const { data } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
    refreshMode: widget.refreshMode,
    freshnessPolicy: widget.mqttTopic ? 'once' : widget.freshnessPolicy,
    invalidateTags: widget.invalidateTags,
  });

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: widget.mqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  let rawValue: unknown = null;
  let displayValue = '—';
  let hasLiveData = false;

  if (mqttData.data !== null) {
    const fieldVal = widget.valueField
      ? resolveMqttFieldValue(mqttData.data, widget.valueField)
      : null;
    rawValue = fieldVal !== null && fieldVal !== undefined
      ? fieldVal
      : (mqttData.data as { value?: unknown }).value ?? mqttData.data;
    displayValue = String(rawValue);
    hasLiveData = true;
  } else if (data.length > 0 && widget.valueField) {
    rawValue = data[0][widget.valueField];
    if (rawValue !== undefined && rawValue !== null) {
      displayValue = String(rawValue);
      hasLiveData = true;
    }
  } else {
    const interpolated = interpolateVariables(`{${widget.valueField}}`, variables);
    if (interpolated !== `{${widget.valueField}}`) {
      displayValue = interpolated;
      rawValue = interpolated;
      hasLiveData = true;
    }
  }

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasLiveData);
  if (isEditPreview) {
    displayValue = resolveWidgetEditPreview({
      valueField: widget.valueField,
      label: widget.label,
      type: 'stat-card',
    });
    rawValue = resolveNumericEditPreview({
      valueField: widget.valueField,
    });
  }

  const chrome = resolveWidgetChrome(widget);

  const row = data.length > 0 ? data[0] : null;
  let targetRaw: number | null = null;
  if (widget.compareTargetField) {
    if (mqttData.data !== null) {
      const tr = resolveMqttFieldValue(mqttData.data, widget.compareTargetField);
      if (tr !== undefined && tr !== null) targetRaw = Number(tr);
    } else if (row) {
      const tr = row[widget.compareTargetField];
      if (tr !== undefined && tr !== null) {
        targetRaw = Number(tr);
      }
    }
  }

  let valueColor = widget.valueColor;
  if (widget.compareTargetField && targetRaw !== null && rawValue !== null) {
    const live = Number(rawValue);
    if (!Number.isNaN(live) && !Number.isNaN(targetRaw) && targetRaw !== 0) {
      const tol = (widget.tolerancePct ?? 5) / 100;
      const inBand = Math.abs(live - targetRaw) / Math.abs(targetRaw) <= tol;
      valueColor = inBand
        ? (widget.inBandColor ?? '#38bdf8')
        : (widget.outOfBandColor ?? '#f87171');
    }
  } else if (widget.colorRulesEnabled && widget.colorRules && rawValue !== null) {
    for (const rule of widget.colorRules) {
      let match = false;
      const val: string | number = isNaN(Number(rawValue)) ? String(rawValue) : Number(rawValue);
      const thr: string | number = isNaN(Number(rule.threshold)) ? rule.threshold : Number(rule.threshold);
      switch (rule.condition) {
        case 'gt': match = val > thr; break;
        case 'lt': match = val < thr; break;
        case 'eq': match = val === thr; break;
        case 'gte': match = val >= thr; break;
        case 'lte': match = val <= thr; break;
        case 'contains': match = String(val).includes(String(thr)); break;
        case 'status_eq': match = String(val) === String(rule.threshold); break;
      }
      if (match) { valueColor = rule.textColor; break; }
    }
  }

  const label = interpolateVariables(widget.label, variables);
  const IconComponent = widget.icon ? (LucideIcons as any)[widget.icon] : null;
  const labelPosition = widget.labelPosition ?? 'top';
  const labelUppercase = widget.labelUppercase !== false;
  const gap = widget.layoutGap ?? 4;
  const unitFs = widget.unitFontSize ?? Math.max(widget.labelFontSize, 10);
  const { flexDirection, labelFirst } = labelValueLayout(labelPosition);
  const isRow = labelPosition === 'left' || labelPosition === 'right';

  const labelNode: ReactNode = label ? (
    <div
      style={{
        fontSize: widget.labelFontSize,
        color: widget.labelColor,
        fontFamily: FONT_UI,
        fontWeight: widget.labelFontWeight ?? 500,
        letterSpacing: labelUppercase ? '0.04em' : 'normal',
        textTransform: labelUppercase ? 'uppercase' : 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {IconComponent && (
        <IconComponent size={widget.labelFontSize + 2} color={widget.iconColor || widget.labelColor} />
      )}
      {label}
    </div>
  ) : null;

  let hintText: string | null = null;
  if (widget.hintField && row) {
    const h = row[widget.hintField];
    if (h !== undefined && h !== null && String(h) !== '') hintText = String(h);
  }
  const HintIcon = widget.hintIcon && !widget.hintIconImage ? (LucideIcons as any)[widget.hintIcon] : null;
  const hintIconSize = widget.hintIconSize ?? widget.labelFontSize + 2;
  const hintIconNode = widget.hintIconImage ? (
    <img
      src={widget.hintIconImage}
      alt=""
      style={{ width: hintIconSize, height: hintIconSize, objectFit: 'contain', flexShrink: 0 }}
    />
  ) : HintIcon ? (
    <HintIcon size={hintIconSize} />
  ) : null;

  const hintInline = widget.hintPosition === 'value-right' && hintText ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 'auto',
        fontSize: widget.labelFontSize,
        color: widget.hintColor ?? '#94a3b8',
        fontFamily: FONT_UI,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {hintIconNode}
      <span>{hintText}</span>
    </div>
  ) : null;

  const valueNode = (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexShrink: 0, width: hintInline ? '100%' : undefined, minHeight: 24 }}>
      <span
        style={{
          fontSize: widget.valueFontSize,
          color: valueColor,
          fontFamily: FONT_UI,
          fontWeight: widget.valueFontWeight ?? 700,
          lineHeight: widget.valueFontSize >= 18 ? 1.33 : 1,
          transition: 'color 0.3s ease',
          ...(isEditPreview ? editPreviewTextStyle : {}),
        }}
      >
        {displayValue}
      </span>
      {widget.unit && (
        <span
          style={{
            fontSize: unitFs,
            color: widget.unitColor,
            fontFamily: FONT_UI,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {widget.unit}
        </span>
      )}
      {hintInline}
    </div>
  );

  const innerBlocks = labelFirst ? [labelNode, valueNode] : [valueNode, labelNode];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: chrome.backgroundColor,
        borderRadius: chrome.borderRadius,
        border: chrome.border,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: widget.contentVAlign === 'start' ? 'flex-start' : 'center',
        padding: isRow ? '6px 10px' : '8px 12px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection,
          alignItems: isRow ? 'baseline' : 'center',
          justifyContent: alignToFlex(widget.contentAlign ?? 'center'),
          gap,
          flexShrink: 0,
          maxWidth: '100%',
        }}
      >
        {innerBlocks.filter(Boolean)}
      </div>
      {hintText && widget.hintPosition !== 'value-right' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: alignToFlex(widget.contentAlign ?? 'center'),
            gap: 4,
            marginTop: 4,
            fontSize: widget.labelFontSize,
            color: widget.hintColor ?? '#94a3b8',
            fontFamily: FONT_UI,
          }}
        >
          {hintIconNode}
          <span>{hintText}</span>
        </div>
      )}
    </div>
  );
}
