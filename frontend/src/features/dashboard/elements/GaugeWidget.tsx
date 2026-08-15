import type { ReactNode } from 'react';
import type { GaugeWidget as GaugeWidgetType } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables } from '../VariableContext';
import {
  computeVehicleStatusGaugeLayout,
  resolveGaugeContentPaddingCss,
} from './gaugeVehicleStatusLayout';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveNumericEditPreview,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

interface Props {
  widget: GaugeWidgetType;
}

/** 設計稿：分段色弧 + 弧上徑向細指針 + 數值在弧內 bowl */
const SPEED_ARC_SEGMENTS: { end: number; color: string; opacity?: number }[] = [
  { end: 0.72, color: '#00D492' },
  { end: 0.86, color: '#FF8904', opacity: 0.4 },
  { end: 1, color: '#FB2C36', opacity: 0.4 },
];

const LOAD_ARC_SEGMENTS: { end: number; color: string; opacity?: number }[] = [
  { end: 0.14, color: '#FB2C36', opacity: 0.4 },
  { end: 0.24, color: '#FF8904', opacity: 0.4 },
  { end: 1, color: '#00D492' },
];

function arcSegmentPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x0 = cx + rx * Math.cos(toRad(startDeg));
  const y0 = cy + ry * Math.sin(toRad(startDeg));
  const x1 = cx + rx * Math.cos(toRad(endDeg));
  const y1 = cy + ry * Math.sin(toRad(endDeg));
  const sweep = 1;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${rx} ${ry} 0 ${large} ${sweep} ${x1} ${y1}`;
}

function VehicleStatusGaugeView({
  widget,
  value,
  offline,
}: {
  widget: GaugeWidgetType;
  value: number;
  offline?: boolean;
}) {
  const pct = offline
    ? 0
    : Math.min(1, Math.max(0, (value - widget.min) / (widget.max - widget.min || 1)));
  /** 上半圓：180°（左）→ 270°（頂）→ 360°（右） */
  const angleDeg = 180 + pct * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const panelW = Math.max(1, widget.width ?? 76);
  const panelH = Math.max(1, widget.height ?? 46);
  const layout = computeVehicleStatusGaugeLayout(
    panelW,
    panelH,
    widget.gaugeValueFontSize ?? 16,
    widget.gaugeUnitFontSize ?? 12,
    widget.gaugeArcStrokeWidth,
    widget.gaugeContentPadding,
    widget.gaugeTextGap ?? 0,
  );
  const { cx, cy, rx, ry, arcStroke, valueFs, unitFs, valueY, unitY, tickIn, tickOut, w, h } = layout;
  const arcVariant = widget.arcVariant ?? 'speed';
  const segments = arcVariant === 'load' ? LOAD_ARC_SEGMENTS : SPEED_ARC_SEGMENTS;
  const panelBg =
    widget.panelBackgroundColor
    ?? (widget.gaugeVariant === 'semi-arc' ? '#1a2332' : 'transparent');
  const panelRadius = widget.panelBorderRadius ?? (widget.gaugeVariant === 'semi-arc' ? 6 : 0);
  const valueStr = offline
    ? '--'
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(1);
  const valueColor = offline ? '#f4f4f5' : '#00BC7D';

  /** 橢圓弧上的徑向指針 */
  const px = cx + rx * Math.cos(angleRad);
  const py = cy + ry * Math.sin(angleRad);
  let nx = Math.cos(angleRad) / rx;
  let ny = Math.sin(angleRad) / ry;
  const nLen = Math.hypot(nx, ny) || 1;
  nx /= nLen;
  ny /= nLen;
  const pointerX1 = px - nx * tickIn;
  const pointerY1 = py - ny * tickIn;
  const pointerX2 = px + nx * tickOut;
  const pointerY2 = py + ny * tickOut;

  const fullArc = arcSegmentPath(cx, cy, rx, ry, 180, 360);
  let segStart = 180;
  const segmentPaths = segments.map((seg) => {
    const endDeg = 180 + seg.end * 180;
    const d = arcSegmentPath(cx, cy, rx, ry, segStart, endDeg);
    segStart = endDeg;
    return { d, color: seg.color, opacity: seg.opacity };
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: panelBg,
        borderRadius: panelRadius,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block' }}
      >
        <path d={fullArc} fill="none" stroke="#27272a" strokeWidth={arcStroke} strokeLinecap="butt" />
        {segmentPaths.map((seg, i) => (
          <path
            key={`${widget.id}-seg-${i}`}
            d={seg.d}
            fill="none"
            stroke={seg.color}
            strokeOpacity={seg.opacity ?? 1}
            strokeWidth={arcStroke}
            strokeLinecap="butt"
          />
        ))}
        <line
          x1={pointerX1}
          y1={pointerY1}
          x2={pointerX2}
          y2={pointerY2}
          stroke="#f4f4f5"
          strokeWidth={Math.max(1.2, arcStroke * 0.28)}
          strokeLinecap="round"
        />
        <text x={cx} y={valueY} textAnchor="middle" dominantBaseline="middle" fill={valueColor} fontSize={valueFs} fontWeight="500">
          {valueStr}
        </text>
        <text x={cx} y={unitY} textAnchor="middle" dominantBaseline="middle" fill="#D1D5DC" fontSize={unitFs} fontWeight="400">
          {widget.unit}
        </text>
      </svg>
    </div>
  );
}

function pickColorFromStops(
  colorStops: GaugeWidgetType['colorStops'],
  percent: number,
): string {
  const stops = [...colorStops].sort((a, b) => a.at - b.at);
  if (stops.length === 0) return '#3B82F6';
  if (percent <= stops[0].at) return stops[0].color;
  if (percent >= stops[stops.length - 1].at) return stops[stops.length - 1].color;
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (percent >= s1.at && percent <= s2.at) {
      const ratio = (percent - s1.at) / (s2.at - s1.at);
      return ratio > 0.5 ? s2.color : s1.color;
    }
  }
  return stops[0].color;
}

/** 全圓達成進度環（班表部署「數據統計」） */
function RingGaugeView({
  widget,
  value,
  offline,
  color,
}: {
  widget: GaugeWidgetType;
  value: number;
  offline?: boolean;
  color: string;
}) {
  const pct = offline
    ? 0
    : Math.min(1, Math.max(0, (value - widget.min) / (widget.max - widget.min || 1)));
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = widget.gaugeArcStrokeWidth != null && widget.gaugeArcStrokeWidth > 0
    ? widget.gaugeArcStrokeWidth
    : 10;
  const radius = (size - strokeWidth) / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const title = widget.title?.trim() ?? '';
  const valueFs = widget.gaugeValueFontSize ?? 28;
  const unitFs = widget.gaugeUnitFontSize ?? 12;
  const titleFs = Math.max(10, Math.round(unitFs));
  const valueStr = offline
    ? '--'
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(1);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: widget.panelBackgroundColor ?? 'transparent',
        borderRadius: widget.panelBorderRadius ?? 0,
        boxSizing: 'border-box',
      }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          gap: 2,
          paddingBottom: widget.gaugeTextGap ?? 0,
        }}
      >
        {title ? (
          <div style={{ fontSize: titleFs, fontWeight: 500, color: 'rgba(255,255,255,0.45)', lineHeight: 1.2 }}>
            {title}
          </div>
        ) : null}
        <div style={{ fontSize: valueFs, fontWeight: 700, color: '#F8FAFC', lineHeight: 1 }}>
          {valueStr}
        </div>
        {widget.unit ? (
          <div style={{ fontSize: unitFs, fontWeight: 500, color: 'rgba(255,255,255,0.45)', lineHeight: 1.2 }}>
            {widget.unit}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function GaugeWidget({ widget }: Props) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const variables = useVariables();

  const sqlData = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    refreshInterval: widget.refreshInterval,
  });

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: widget.mqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  let rawValue = 0;
  let hasValue = false;
  if (mqttData.data !== null) {
    rawValue = Number(mqttData.data.value ?? mqttData.data);
    hasValue = !Number.isNaN(rawValue);
  } else if (sqlData.data.length > 0 && widget.valueField) {
    const cell = sqlData.data[0][widget.valueField];
    if (cell !== null && cell !== undefined && cell !== '') {
      rawValue = Number(cell);
      hasValue = !Number.isNaN(rawValue);
    }
  } else if (widget.valueField) {
    const direct = variables[widget.valueField];
    if (direct !== undefined && direct !== null && direct !== '') {
      rawValue = Number(direct);
      hasValue = !Number.isNaN(rawValue);
    } else {
      const interpolated = interpolateVariables(`{${widget.valueField}}`, variables);
      if (interpolated !== `{${widget.valueField}}`) {
        rawValue = Number(interpolated);
        hasValue = !Number.isNaN(rawValue);
      }
    }
  }

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasValue);
  if (isEditPreview) {
    rawValue = resolveNumericEditPreview({
      valueField: widget.valueField,
      min: widget.min,
      max: widget.max,
    });
    hasValue = true;
  }

  const value = Math.max(widget.min, Math.min(widget.max, rawValue));
  const showOffline = !hasValue;

  const wrap = (node: ReactNode) => (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'gauge' })}
    >
      {node}
    </WidgetEditPreviewOutline>
  );

  if (widget.gaugeVariant === 'semi-arc') {
    return wrap(<VehicleStatusGaugeView widget={widget} value={value} offline={showOffline} />);
  }

  if (widget.gaugeVariant === 'ring') {
    const ringPct = (value - widget.min) / (widget.max - widget.min || 1);
    const ringColor = pickColorFromStops(widget.colorStops, ringPct);
    return wrap(<RingGaugeView widget={widget} value={value} offline={showOffline} color={ringColor} />);
  }

  const percent = (value - widget.min) / (widget.max - widget.min);
  const radius = 80;
  const strokeWidth = widget.gaugeArcStrokeWidth != null && widget.gaugeArcStrokeWidth > 0
    ? widget.gaugeArcStrokeWidth
    : 12;
  const center = 100;
  const circumference = Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percent);

  const currentColor = pickColorFromStops(widget.colorStops, percent);
  const showTitle = Boolean(widget.title?.trim());
  const contentPad = resolveGaugeContentPaddingCss(widget.gaugeContentPadding);
  const hasCustomPad = Boolean(widget.gaugeContentPadding);
  const outerPad = hasCustomPad
    ? contentPad
    : (showTitle ? '6px' : '2px');

  return wrap(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: outerPad,
        background: 'transparent',
        borderRadius: 4,
        boxSizing: 'border-box',
      }}
    >
      {showTitle && (
        <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 2, flexShrink: 0 }}>
          {widget.title}
        </div>
      )}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0, maxHeight: '100%' }}>
        <svg viewBox="0 0 200 110" preserveAspectRatio="xMidYMax meet" style={{ width: '100%', height: '100%', display: 'block' }}>
          <path
            d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <path
            d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
            fill="none"
            stroke={currentColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.5s ease-out' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            bottom: `calc(4% + ${widget.gaugeTextGap ?? 0}px)`,
            left: 0,
            right: 0,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: widget.gaugeValueFontSize ?? 24, fontWeight: 700, color: currentColor, lineHeight: 1.1 }}>
            {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)}
          </div>
          <div style={{ fontSize: widget.gaugeUnitFontSize ?? 12, color: 'rgba(255,255,255,0.45)' }}>{widget.unit}</div>
        </div>
      </div>
    </div>,
  );
}
