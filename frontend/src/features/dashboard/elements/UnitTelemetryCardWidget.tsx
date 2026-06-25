import type { UnitTelemetryCardWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables } from '../VariableContext';
import { getByPath } from '../utils/jsonPath';
import { Bus, MapPin, AlertCircle, AlertTriangle } from 'lucide-react';
import { HEALTH_STATUS_BORDER } from '../constants/healthStatusTheme';
import {
  resolveVehicleMonitorBadge,
} from '../utils/resolveVehicleMonitorBadge';
import {
  useIsEditMode,
  resolveWidgetEditPreview,
  resolveWidgetPreviewLabel,
  resolveNumericEditPreview,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';

const VEHICLE_STATUS_BORDER = '#00c897';
const VEHICLE_STATUS_BG = '#0f1419';
const GAUGE_PANEL_BG = '#1a2332';

function isWrapped(d: Record<string, unknown> | null): boolean {
  return d !== null && 'value' in d && Object.keys(d).length <= 2;
}

/** 設計稿半圓儀表：綠→黃→紅弧、白指針、中央數值 */
function VehicleStatusGauge({
  value,
  min,
  max,
  unit,
  gradId,
  arcVariant = 'speed',
  showDash = false,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  gradId: string;
  arcVariant?: 'speed' | 'load';
  showDash?: boolean;
}) {
  const pct = showDash ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  const angle = 180 + pct * 180;
  const r = 30;
  const cx = 38;
  const cy = 34;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const valueColor = showDash ? '#f4f4f5' : '#4ade80';
  const valueLabel = showDash ? '--' : value.toFixed(1);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: GAUGE_PANEL_BG,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 2px',
      }}
    >
      <svg width="76" height="48" viewBox="0 0 76 48" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            {arcVariant === 'load' ? (
              <>
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="12%" stopColor="#f97316" />
                <stop offset="22%" stopColor="#22c55e" />
                <stop offset="100%" stopColor="#22c55e" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="55%" stopColor="#84cc16" />
                <stop offset="85%" stopColor="#eab308" />
                <stop offset="100%" stopColor="#ef4444" />
              </>
            )}
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke="#27272a" strokeWidth="5" strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${pct * Math.PI * r} ${Math.PI * r}`}
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx + Math.cos((angle * Math.PI) / 180) * (r - 6)}
          y2={cy + Math.sin((angle * Math.PI) / 180) * (r - 6)}
          stroke="#f4f4f5"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <text x={cx} y={cy + 12} fill={valueColor} fontSize="11" textAnchor="middle" fontWeight="700">
          {valueLabel}
        </text>
        <text x={cx} y={cy + 22} fill="#a1a1aa" fontSize="7" textAnchor="middle" fontWeight="500">
          {unit}
        </text>
      </svg>
    </div>
  );
}

function subsystemStyle(status: string | undefined): { bg?: string; fg: string } {
  const s = (status ?? 'OK').toUpperCase();
  if (s === 'ERROR') return { bg: '#b91c1c', fg: '#fff' };
  if (s === 'WARNING') return { bg: '#c2410c', fg: '#fff' };
  if (s === 'OFFLINE') return { bg: '#27272a', fg: '#a1a1aa' };
  return { fg: '#4ade80' };
}

function VehicleStatusCardView({
  widget,
  title,
  tripCode,
  tripBg,
  tripColor,
  speed,
  load,
  segment,
  healthPayload,
  overall,
  alertMessage,
  speedDash,
}: {
  widget: UnitTelemetryCardWidget;
  title: string;
  tripCode: string;
  tripBg: string;
  tripColor: string;
  speed: number;
  load: number;
  segment: string;
  healthPayload: Record<string, unknown> | null;
  overall: string;
  alertMessage: string;
  speedDash: boolean;
}) {
  const borderColor = HEALTH_STATUS_BORDER[overall as keyof typeof HEALTH_STATUS_BORDER] ?? VEHICLE_STATUS_BORDER;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif',
      }}
    >
      {/* 主卡（含底部留白給凸出標籤） */}
      <div
        style={{
          height: 'calc(100% - 12px)',
          display: 'flex',
          flexDirection: 'column',
          background: VEHICLE_STATUS_BG,
          border: `2px solid ${borderColor}`,
          borderRadius: 8,
          borderBottomLeftRadius: 4,
          borderBottomRightRadius: 4,
          overflow: 'hidden',
        }}
      >
        {/* 標題列 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 8px 4px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <Bus size={13} strokeWidth={2.2} color="#f4f4f5" style={{ flexShrink: 0 }} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#f4f4f5',
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
          </div>
          {tripCode ? (
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 700,
                color: tripColor,
                background: tripBg,
                borderRadius: 4,
                padding: '2px 7px',
                lineHeight: 1.2,
              }}
            >
              {tripCode}
            </span>
          ) : null}
        </div>

        {alertMessage ? (
          <div
            style={{
              margin: '0 6px 4px',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 4,
              background: overall === 'ERROR' ? 'rgba(185,28,28,0.55)' : 'rgba(194,65,12,0.55)',
              border: `1px solid ${overall === 'ERROR' ? 'rgba(248,113,113,0.5)' : 'rgba(251,146,60,0.45)'}`,
            }}
          >
            {overall === 'ERROR' ? (
              <AlertTriangle size={13} color="#fef2f2" />
            ) : (
              <AlertCircle size={13} color="#fff7ed" />
            )}
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fafafa' }}>{alertMessage}</span>
          </div>
        ) : null}

        {/* 雙儀表 */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '0 6px',
            flex: 1,
            minHeight: 52,
            alignItems: 'stretch',
          }}
        >
          <VehicleStatusGauge
            gradId={`vsp-${widget.id}`}
            value={speed}
            showDash={speedDash}
            min={widget.speedMin}
            max={widget.speedMax}
            unit={widget.speedUnit}
          />
          <VehicleStatusGauge
            gradId={`vld-${widget.id}`}
            arcVariant="load"
            value={load}
            min={widget.loadMin}
            max={widget.loadMax}
            unit={widget.loadUnit}
          />
        </div>

        {/* 子系統狀態列 */}
        <div
          style={{
            display: 'flex',
            gap: 3,
            padding: '4px 6px 6px',
            flexShrink: 0,
          }}
        >
          {widget.statusFlags.map((f) => {
            const sys = f.mqttSubsystemKey ?? f.key.toUpperCase();
            const st = getByPath(healthPayload, `subsystems.${sys}.status`) as string | undefined;
            const style = subsystemStyle(st);
            return (
              <span
                key={f.key}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 8,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  padding: '3px 2px',
                  borderRadius: 4,
                  color: style.fg,
                  background: style.bg ?? '#0a0a0a',
                  border: style.bg ? 'none' : '1px solid rgba(39,39,42,0.9)',
                }}
              >
                {f.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* 底部凸出軌道標籤（設計稿 D33 區塊） */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 0,
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '3px 10px 4px',
          background: VEHICLE_STATUS_BG,
          border: `2px solid ${borderColor}`,
          borderTop: 'none',
          borderBottomLeftRadius: 6,
          borderBottomRightRadius: 6,
          fontSize: 9,
          fontWeight: 600,
          color: '#e4e4e7',
          whiteSpace: 'nowrap',
          zIndex: 2,
        }}
      >
        <MapPin size={10} strokeWidth={2.2} color="#a1a1aa" />
        {segment}
      </div>
    </div>
  );
}

function CompactGauge({
  value,
  min,
  max,
  unit,
  accent,
  gradId,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  accent: string;
  gradId: string;
}) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  const angle = 180 + pct * 180;
  const r = 28;
  const cx = 36;
  const cy = 36;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg width="72" height="44" viewBox="0 0 72 44" className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="50%" stopColor="#eab308" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="rgba(39,39,42,0.95)" strokeWidth="6" strokeLinecap="round" />
      <path
        d={arc}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${pct * Math.PI * r} ${Math.PI * r}`}
      />
      <line
        x1={cx}
        y1={cy}
        x2={cx + Math.cos((angle * Math.PI) / 180) * (r - 8)}
        y2={cy + Math.sin((angle * Math.PI) / 180) * (r - 8)}
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <text x={cx} y={cy + 14} fill="#e4e4e7" fontSize="8" textAnchor="middle" fontWeight="600">
        {value.toFixed(1)}
        <tspan fill="#71717a" fontSize="6">
          {unit}
        </tspan>
      </text>
    </svg>
  );
}

function DefaultTelemetryCardView({
  widget,
  title,
  badge,
  tripBg,
  tripColor,
  speed,
  load,
  segment,
  healthPayload,
  borderColor,
  overall,
}: {
  widget: UnitTelemetryCardWidget;
  title: string;
  badge: string;
  tripBg: string;
  tripColor: string;
  speed: number;
  load: number;
  segment: string;
  healthPayload: Record<string, unknown> | null;
  borderColor: string;
  overall: string;
}) {
  return (
    <div
      className="flex h-full w-full flex-col rounded px-1 py-1"
      style={{
        background: 'rgba(15,23,42,0.55)',
        border: `2px solid ${borderColor}`,
        boxShadow: overall === 'ERROR' ? '0 0 14px rgba(239,68,68,0.25)' : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-1 px-0.5">
        <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-100">
          <span className="text-sky-400">▣</span>
          {title}
        </div>
        {badge && (
          <span
            className="rounded px-1 py-px text-[8px] font-bold"
            style={{ backgroundColor: tripBg, color: tripColor }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center gap-0.5">
        <CompactGauge
          gradId={`sp-${widget.id}`}
          value={speed}
          min={widget.speedMin}
          max={widget.speedMax}
          unit={widget.speedUnit}
          accent="#38bdf8"
        />
        <CompactGauge
          gradId={`ld-${widget.id}`}
          value={load}
          min={widget.loadMin}
          max={widget.loadMax}
          unit={widget.loadUnit}
          accent="#a78bfa"
        />
      </div>
      <div className="flex justify-center gap-1 border-t border-zinc-800/80 px-0.5 pt-1">
        {widget.statusFlags.map((f) => {
          const sys = f.mqttSubsystemKey ?? f.key.toUpperCase();
          const st = getByPath(healthPayload, `subsystems.${sys}.status`) as string | undefined;
          const style = subsystemStyle(st);
          return (
            <span
              key={f.key}
              className="rounded px-1 py-px text-[7px] font-semibold"
              style={{ color: style.fg, backgroundColor: style.bg ?? 'transparent' }}
            >
              {f.label}
            </span>
          );
        })}
      </div>
      <div className="mt-0.5 flex justify-center text-[8px] text-zinc-300">
        <span className="flex items-center gap-0.5 rounded bg-zinc-800/80 px-1.5 py-px">
          <MapPin size={9} className="shrink-0 text-zinc-400" />
          {String(segment)}
        </span>
      </div>
    </div>
  );
}

export function UnitTelemetryCardWidgetView({ widget }: { widget: UnitTelemetryCardWidget }) {
  const isEditMode = useIsEditMode();
  const variables = useVariables();
  const data = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
  });

  const topicT = interpolateVariables(widget.mqttTelemetryTopic ?? '', variables);
  const topicH = interpolateVariables(widget.mqttHealthTopic ?? '', variables);
  const topicO = interpolateVariables(widget.mqttOperationTopic ?? '', variables);

  const tel = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: topicT || undefined,
  });
  const health = useMqttData({
    mqttDataSourceId: widget.mqttHealthDataSourceId ?? widget.mqttDataSourceId,
    mqttTopic: topicH || undefined,
  });
  const oper = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: topicO || undefined,
  });

  const telPayload =
    tel.data && !isWrapped(tel.data as Record<string, unknown>)
      ? (tel.data as Record<string, unknown>)
      : null;
  const healthPayload =
    health.data && !isWrapped(health.data as Record<string, unknown>)
      ? (health.data as Record<string, unknown>)
      : null;
  const operPayload =
    oper.data && !isWrapped(oper.data as Record<string, unknown>)
      ? (oper.data as Record<string, unknown>)
      : null;

  const sqlRow = data.data[0] ?? null;

  let speed = 0;
  let load = 0;
  if (variables.demo_speed !== undefined && variables.demo_speed !== null) {
    speed = Number(variables.demo_speed);
  }
  if (variables.demo_load !== undefined && variables.demo_load !== null) {
    load = Number(variables.demo_load);
  }
  if (telPayload && widget.telemetrySpeedPath) {
    const v = getByPath(telPayload, widget.telemetrySpeedPath);
    if (v !== undefined && v !== null) speed = Number(v);
  }
  if (telPayload && widget.telemetryBatteryPath) {
    const v = getByPath(telPayload, widget.telemetryBatteryPath);
    if (v !== undefined && v !== null) load = Number(v);
  }

  const segField = widget.segmentLabelField ?? 'segment_label';
  const seg =
    (widget.segmentLabelPath && operPayload && getByPath(operPayload, widget.segmentLabelPath)) ||
    (variables[segField] !== undefined ? String(variables[segField]) : undefined) ||
    (sqlRow?.[segField] as string | undefined) ||
    '—';

  const title =
    variables.unit_display !== undefined
      ? String(variables.unit_display)
      : variables.vehicle_display !== undefined
        ? String(variables.vehicle_display)
        : interpolateVariables(widget.unitLabel, variables);

  const badge = resolveVehicleMonitorBadge(variables, { operation: operPayload });
  const tripCode = badge.label;
  const tripBg = badge.bg || String(variables[widget.badgeBgField ?? 'badge_bg'] ?? '#7e57c2');
  const tripColor = badge.color || String(variables[widget.badgeColorField ?? 'badge_color'] ?? '#f3e8ff');

  const healthField = widget.healthStatusField ?? 'overall_health';
  const alertField = widget.alertMessageField ?? 'alert_message';
  const overall = String(
    healthPayload
      ? (healthPayload[healthField] ?? getByPath(healthPayload, healthField) ?? 'OK')
      : (variables[healthField] ?? 'OK'),
  ).toUpperCase();
  const alertMessage = String(
    healthPayload
      ? (healthPayload[alertField] ?? '')
      : (variables[alertField] ?? ''),
  ).trim();
  const speedDash =
    variables.demo_speed === null
    || variables.demo_speed === undefined
    || String(variables.demo_speed) === '';
  const borderColor =
    overall === 'ERROR' ? '#ef4444' : overall === 'WARNING' ? '#fb923c' : 'rgba(45,212,191,0.55)';

  const isInstrumentRow = widget.cardVariant === 'instrument-row';
  const hasBinding = widgetHasDataBinding(widget)
    || !!(widget.mqttTelemetryTopic || widget.mqttHealthTopic || widget.mqttOperationTopic);
  const hasLiveData = !!(telPayload || healthPayload || operPayload || sqlRow);
  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasLiveData);
  const renderTitle = isEditPreview
    ? resolveWidgetEditPreview({
      label: widget.unitLabel,
      type: 'unit-telemetry-card',
    })
    : title;
  const renderSpeed = isEditPreview
    ? resolveNumericEditPreview({ valueField: 'speed', fallback: 32, max: 80 })
    : speed;
  const renderLoad = isEditPreview
    ? resolveNumericEditPreview({ valueField: 'battery_level', fallback: 78 })
    : load;
  const renderTripCode = isEditPreview && !tripCode.trim()
    ? resolveWidgetEditPreview({ valueField: 'trip_code', type: 'unit-telemetry-card' })
    : tripCode;
  const renderSeg = isEditPreview && String(seg) === '—'
    ? resolveWidgetEditPreview({ valueField: 'segment_label', type: 'unit-telemetry-card' })
    : String(seg);
  const renderSpeedDash = isEditPreview ? false : speedDash;
  const previewWrap = (node: React.ReactNode) => (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({
        label: widget.unitLabel,
        type: 'unit-telemetry-card',
      })}
    >
      {node}
    </WidgetEditPreviewOutline>
  );

  if (isInstrumentRow) {
    return previewWrap(
      <VehicleStatusCardView
        widget={widget}
        title={renderTitle}
        tripCode={renderTripCode}
        tripBg={tripBg}
        tripColor={tripColor}
        speed={renderSpeed}
        load={renderLoad}
        segment={renderSeg}
        healthPayload={healthPayload}
        overall={overall}
        alertMessage={alertMessage}
        speedDash={renderSpeedDash}
      />,
    );
  }

  return previewWrap(
    <DefaultTelemetryCardView
      widget={widget}
      title={renderTitle}
      badge={renderTripCode}
      tripBg={tripBg}
      tripColor={tripColor}
      speed={renderSpeed}
      load={renderLoad}
      segment={renderSeg}
      healthPayload={healthPayload}
      borderColor={borderColor}
      overall={overall}
    />,
  );
}
