import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useShiftVehicleOperationMqtt } from '../context/ShiftFleetMqttContext';
import type { RouteProgressWidget, RouteStation } from '../types';
import {
  AlarmClock,
  CheckCircle2,
  Clock,
  Hourglass,
  MapPin,
  Navigation2,
} from 'lucide-react';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  MOCK_ROUTE_STATIONS,
  resolveWidgetEditPreview,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';
import { useVariables, type VariableMap } from '../VariableContext';
import { getByPath } from '../utils/jsonPath';
import { resolveRouteStations } from '../route-progress/resolveStations';
import { useAnimatedTrackPercent, mqttPayloadIsFresh } from '../route-progress/useAnimatedTrackPercent';
import { readOrderStatus } from '../route-progress/orderStatus';
import { resolveActionIconUrl } from '../route-progress/resolveActionIcon';
import { resolveVehicleIconBgColor } from '../vehicle-operation-actions';
import { RouteTrackView } from '../route-progress/RouteTrackView';
import { RouteVehicleMarker } from '../route-progress/RouteVehicleMarker';

/** 班次卡設計稿基準（正線／整備共用，與 demoPlane 子範本一致） */
const CARD_DESIGN_W = 176;
const CARD_DESIGN_H = 152;

function isWrappedMqttValue(d: Record<string, unknown> | null): boolean {
  return d !== null && 'value' in d && Object.keys(d).length <= 2;
}

function cardScale(widget: RouteProgressWidget): number {
  const sx = widget.width / CARD_DESIGN_W;
  const sy = widget.height / CARD_DESIGN_H;
  return Math.min(sx, sy, 1.35);
}

function DispatchTrack({
  widget,
  sortedStations,
  minVal,
  range,
  progressPercent,
  nextSt,
  scale,
  vehicleIconBg,
  actionIconUrl,
}: {
  widget: RouteProgressWidget;
  sortedStations: RouteStation[];
  minVal: number;
  range: number;
  progressPercent: number;
  nextSt: string;
  scale: number;
  vehicleIconBg: string;
  actionIconUrl?: string | null;
}) {
  const currentVal = minVal + (progressPercent / 100) * range;
  const lineH = Math.max(2, Math.round(2 * scale));
  const lineTop = Math.round(14 * scale);
  const trackH = Math.max(44, Math.round(52 * scale));
  const dot = Math.max(7, Math.round(8 * scale));
  const bus = Math.max(14, Math.round(16 * scale));
  const labelFs = Math.max(9, Math.round(10 * scale));

  return (
    <div className="relative w-full flex-1" style={{ minHeight: trackH, marginTop: Math.round(4 * scale) }}>
      <div
        className="absolute left-0 right-0"
        style={{ top: lineTop, height: lineH }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: widget.inactiveColor }}
        />
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${progressPercent}%`, backgroundColor: widget.activeColor }}
        />
      </div>

      {sortedStations.map((station) => {
        const stationPercent = ((station.value - minVal) / range) * 100;
        const isPassed = currentVal >= station.value;
        const isTarget =
          station.name === nextSt
          || (station.stationId != null && station.stationId === nextSt);
        return (
          <div
            key={station.id}
            className="absolute flex flex-col items-center"
            style={{
              left: `${stationPercent}%`,
              top: Math.round(10 * scale),
              transform: 'translateX(-50%)',
            }}
          >
            {isTarget && (
              <div
                className="absolute rounded-full"
                style={{
                  width: dot + 10,
                  height: dot + 10,
                  top: -2,
                  boxShadow: '0 0 12px rgba(255,255,255,0.45)',
                  background: 'rgba(255,255,255,0.08)',
                }}
              />
            )}
            <div
              style={{
                width: dot,
                height: dot,
                borderRadius: '50%',
                backgroundColor: isTarget ? '#fafafa' : '#18181b',
                border: `2px solid ${isPassed || isTarget ? widget.activeColor : widget.inactiveColor}`,
                position: 'relative',
                zIndex: 2,
              }}
            />
            <div
              className="whitespace-nowrap font-bold"
              style={{
                marginTop: Math.round(6 * scale),
                fontSize: labelFs,
                color: isPassed || isTarget ? widget.activeColor : widget.inactiveColor,
                opacity: isPassed || isTarget ? 1 : 0.5,
              }}
            >
              {station.name}
            </div>
          </div>
        );
      })}

      <div
        className="absolute z-20"
        style={{
          left: `${progressPercent}%`,
          top: lineTop + lineH / 2,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <RouteVehicleMarker
          vehicleIcon={widget.vehicleIcon}
          iconColor={widget.iconColor}
          iconBgColor={vehicleIconBg}
          vehicleSize={bus}
          actionIconUrl={actionIconUrl}
          stationLabel={nextSt || undefined}
          labelColor={widget.activeColor}
          labelFontSize={labelFs}
          vehicleStyle={{ padding: Math.round(2 * scale), borderRadius: 4 }}
        />
      </div>
    </div>
  );
}

function DispatchCardView({
  widget,
  sortedStations,
  minVal,
  range,
  progressPercent,
  borderStyle,
  alertFromVar,
  variables,
  status,
  statusBg,
  statusTx,
  nextSt,
  etaRem,
  etaDelay,
  depart,
  endT,
  vehicleCode,
  tripCode,
  vehicleIconBg,
  actionIconUrl,
}: {
  widget: RouteProgressWidget;
  sortedStations: RouteStation[];
  minVal: number;
  range: number;
  progressPercent: number;
  borderStyle: string;
  alertFromVar: boolean;
  variables: VariableMap;
  status: string | undefined;
  statusBg: string | undefined;
  statusTx: string | undefined;
  nextSt: string;
  etaRem: string;
  etaDelay: string;
  depart: string;
  endT: string;
  vehicleCode: string;
  tripCode: string;
  vehicleIconBg: string;
  actionIconUrl?: string | null;
}) {
  const scale = cardScale(widget);
  const pad = Math.round(8 * scale);
  const titleFs = Math.max(11, Math.round(12 * scale));
  const subFs = Math.max(9, Math.round(10 * scale));
  const pillFs = Math.max(8, Math.round(9 * scale));
  const labelFs = Math.max(8, Math.round(9 * scale));
  const valueFs = Math.max(14, Math.round(16 * scale));
  const footerFs = Math.max(8, Math.round(9 * scale));
  const iconSm = Math.max(12, Math.round(14 * scale));
  const iconMd = Math.max(14, Math.round(16 * scale));
  const stationLabel = widget.cardStationLabel ?? '站點';
  const metricLabel = widget.cardMetricLabel ?? 'ETA';
  const departLabel = widget.cardDepartLabel ?? '開始';
  const endLabel = widget.cardEndLabel ?? '結束';

  const tripPrimary = tripCode || '—';
  const vehicleSub = vehicleCode && vehicleCode !== tripPrimary ? vehicleCode : '';

  const cardStyle: CSSProperties = {
    border: borderStyle,
    background: 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(9,14,26,0.98) 100%)',
    boxShadow: widget.alertBorder || alertFromVar ? '0 0 16px rgba(239,68,68,0.2)' : undefined,
    padding: pad,
    paddingBottom: 0,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded" style={cardStyle}>
      <div className="flex shrink-0 items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {variables.direction_label !== undefined && (
            <span
              className="shrink-0 rounded-full font-bold"
              style={{
                fontSize: pillFs,
                padding: `${Math.round(2 * scale)}px ${Math.round(8 * scale)}px`,
                backgroundColor: String(variables.direction_pill_bg ?? '#1e3a8a'),
                color: String(variables.direction_pill_color ?? '#bfdbfe'),
              }}
            >
              {String(variables.direction_label)}
            </span>
          )}
          <span
            className="truncate font-bold text-zinc-100"
            style={{ fontSize: titleFs }}
          >
            {tripPrimary}
          </span>
          {vehicleSub && (
            <span className="shrink-0 font-normal text-zinc-500" style={{ fontSize: subFs }}>
              {vehicleSub}
            </span>
          )}
        </div>
        {status && (
          <span
            className="flex shrink-0 items-center gap-1 rounded font-bold"
            style={{
              fontSize: pillFs,
              padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
              backgroundColor: statusBg ?? '#064e3b',
              color: statusTx ?? '#34d399',
            }}
          >
            <span
              className="rounded-full"
              style={{
                width: Math.max(5, Math.round(6 * scale)),
                height: Math.max(5, Math.round(6 * scale)),
                backgroundColor: statusTx ?? '#34d399',
              }}
            />
            {status}
          </span>
        )}
      </div>

      <div
        className="mt-1.5 flex shrink-0 justify-between gap-2"
        style={{ marginTop: Math.round(6 * scale) }}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          <Navigation2
            size={iconMd}
            color="#38bdf8"
            style={{ marginTop: Math.round(10 * scale), flexShrink: 0 }}
          />
          <div className="min-w-0">
            <div className="text-zinc-500" style={{ fontSize: labelFs }}>
              {stationLabel}
            </div>
            <div className="font-bold leading-tight text-zinc-50" style={{ fontSize: valueFs }}>
              {nextSt || '—'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1.5 text-right">
          <Clock
            size={iconMd}
            color="#38bdf8"
            style={{ marginTop: Math.round(10 * scale), flexShrink: 0 }}
          />
          <div>
            <div className="text-zinc-500" style={{ fontSize: labelFs }}>
              {metricLabel}
            </div>
            <div className="font-bold leading-tight" style={{ fontSize: valueFs, color: '#f8fafc' }}>
              {etaRem || '—'}
              {etaDelay && (
                <span
                  className="ml-1 font-bold text-orange-400"
                  style={{ fontSize: Math.max(9, Math.round(10 * scale)) }}
                >
                  {etaDelay}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <DispatchTrack
        widget={widget}
        sortedStations={sortedStations}
        minVal={minVal}
        range={range}
        progressPercent={progressPercent}
        nextSt={nextSt}
        scale={scale}
        vehicleIconBg={vehicleIconBg}
        actionIconUrl={actionIconUrl}
      />

      <div
        className="mt-auto flex shrink-0 items-center justify-between text-zinc-400"
        style={{
          marginTop: Math.round(4 * scale),
          padding: `${Math.round(6 * scale)}px ${pad}px`,
          marginLeft: -pad,
          marginRight: -pad,
          marginBottom: 0,
          backgroundColor: 'rgba(0,0,0,0.35)',
          fontSize: footerFs,
          borderBottomLeftRadius: 6,
          borderBottomRightRadius: 6,
        }}
      >
        <span className="flex items-center gap-1">
          <Clock size={iconSm} color="#94a3b8" />
          {departLabel} {depart || '—'}
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 size={iconSm} color="#94a3b8" />
          {endLabel} {endT || '—'}
        </span>
      </div>
    </div>
  );
}

function MaintenanceTrack({
  widget,
  sortedStations,
  minVal,
  range,
  progressPercent,
  nextSt,
  scale,
  vehicleIconBg,
  actionIconUrl,
}: {
  widget: RouteProgressWidget;
  sortedStations: RouteStation[];
  minVal: number;
  range: number;
  progressPercent: number;
  nextSt: string;
  scale: number;
  vehicleIconBg: string;
  actionIconUrl?: string | null;
}) {
  const currentVal = minVal + (progressPercent / 100) * range;
  const lineH = Math.max(2, Math.round(2 * scale));
  const lineTop = Math.round(14 * scale);
  const trackH = Math.max(44, Math.round(52 * scale));
  const dot = Math.max(7, Math.round(8 * scale));
  const bus = Math.max(14, Math.round(16 * scale));
  const labelFs = Math.max(9, Math.round(10 * scale));

  return (
    <div className="relative w-full flex-1" style={{ minHeight: trackH, marginTop: Math.round(4 * scale) }}>
      <div
        className="absolute left-0 right-0"
        style={{ top: lineTop, height: lineH }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: widget.inactiveColor }}
        />
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${progressPercent}%`, backgroundColor: widget.activeColor }}
        />
      </div>

      {sortedStations.map((station) => {
        const stationPercent = ((station.value - minVal) / range) * 100;
        const isPassed = currentVal >= station.value;
        const isTarget =
          station.name === nextSt
          || (station.stationId != null && station.stationId === nextSt);
        return (
          <div
            key={station.id}
            className="absolute flex flex-col items-center"
            style={{
              left: `${stationPercent}%`,
              top: Math.round(10 * scale),
              transform: 'translateX(-50%)',
            }}
          >
            {isTarget && (
              <div
                className="absolute rounded-full"
                style={{
                  width: dot + 10,
                  height: dot + 10,
                  top: -2,
                  boxShadow: '0 0 12px rgba(255,255,255,0.45)',
                  background: 'rgba(255,255,255,0.08)',
                }}
              />
            )}
            <div
              style={{
                width: dot,
                height: dot,
                borderRadius: '50%',
                backgroundColor: isTarget ? '#fafafa' : '#18181b',
                border: `2px solid ${isPassed || isTarget ? widget.activeColor : widget.inactiveColor}`,
                position: 'relative',
                zIndex: 2,
              }}
            />
            <div
              className="whitespace-nowrap font-bold"
              style={{
                marginTop: Math.round(6 * scale),
                fontSize: labelFs,
                color: isPassed || isTarget ? widget.activeColor : widget.inactiveColor,
                opacity: isPassed || isTarget ? 1 : 0.5,
              }}
            >
              {station.name}
            </div>
          </div>
        );
      })}

      <div
        className="absolute z-20"
        style={{
          left: `${progressPercent}%`,
          top: lineTop + lineH / 2,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <RouteVehicleMarker
          vehicleIcon={widget.vehicleIcon}
          iconColor={widget.iconColor}
          iconBgColor={vehicleIconBg}
          vehicleSize={bus}
          actionIconUrl={actionIconUrl}
          stationLabel={nextSt || undefined}
          labelColor={widget.activeColor}
          labelFontSize={labelFs}
          vehicleStyle={{ padding: Math.round(2 * scale), borderRadius: 4 }}
        />
      </div>
    </div>
  );
}

function MaintenanceCardView({
  widget,
  sortedStations,
  minVal,
  range,
  progressPercent,
  borderStyle,
  alertFromVar,
  status,
  statusBg,
  statusTx,
  nextSt,
  etaRem,
  etaLabel,
  depart,
  endT,
  vehicleCode,
  tripCode,
  maintTypeLabel,
  maintTypeBg,
  maintTypeColor,
  vehicleIconBg,
  actionIconUrl,
}: {
  widget: RouteProgressWidget;
  sortedStations: RouteStation[];
  minVal: number;
  range: number;
  progressPercent: number;
  borderStyle: string;
  alertFromVar: boolean;
  status: string | undefined;
  statusBg: string | undefined;
  statusTx: string | undefined;
  nextSt: string;
  etaRem: string;
  etaLabel: string;
  depart: string;
  endT: string;
  vehicleCode: string;
  tripCode: string;
  maintTypeLabel: string | undefined;
  maintTypeBg: string;
  maintTypeColor: string;
  vehicleIconBg: string;
  actionIconUrl?: string | null;
}) {
  const scale = cardScale(widget);
  const pad = Math.round(8 * scale);
  const titleFs = Math.max(11, Math.round(12 * scale));
  const subFs = Math.max(9, Math.round(10 * scale));
  const pillFs = Math.max(8, Math.round(9 * scale));
  const labelFs = Math.max(8, Math.round(9 * scale));
  const valueFs = Math.max(14, Math.round(16 * scale));
  const footerFs = Math.max(8, Math.round(9 * scale));
  const iconSm = Math.max(12, Math.round(14 * scale));
  const iconMd = Math.max(14, Math.round(16 * scale));

  const titlePrimary = vehicleCode || '—';
  const titleSub = tripCode && tripCode !== titlePrimary ? tripCode : '';
  const stationLabel = widget.cardStationLabel ?? '站點';
  const departLabel = widget.cardDepartLabel ?? '開始';
  const endLabel = widget.cardEndLabel ?? '結束';
  const metricAlertValues = widget.cardMetricAlertValues ?? [];
  const etaValueColor = metricAlertValues.includes(etaLabel) ? (statusTx ?? '#f87171') : '#f8fafc';

  const cardStyle: CSSProperties = {
    border: borderStyle,
    background: 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(9,14,26,0.98) 100%)',
    boxShadow: widget.alertBorder || alertFromVar ? '0 0 16px rgba(239,68,68,0.2)' : undefined,
    padding: pad,
    paddingBottom: 0,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded" style={cardStyle}>
      <div className="flex shrink-0 items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {maintTypeLabel !== undefined && (
            <span
              className="shrink-0 rounded font-bold"
              style={{
                fontSize: pillFs,
                padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
                border: `1px solid ${maintTypeColor}`,
                backgroundColor: maintTypeBg,
                color: maintTypeColor,
              }}
            >
              {maintTypeLabel}
            </span>
          )}
          <span className="truncate font-bold text-zinc-100" style={{ fontSize: titleFs }}>
            {titlePrimary}
          </span>
          {titleSub && (
            <span className="shrink-0 font-normal text-zinc-500" style={{ fontSize: subFs }}>
              {titleSub}
            </span>
          )}
        </div>
        {status && (
          <span
            className="flex shrink-0 items-center gap-1 rounded font-bold"
            style={{
              fontSize: pillFs,
              padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
              backgroundColor: statusBg ?? '#064e3b',
              color: statusTx ?? '#34d399',
            }}
          >
            <span
              className="rounded-full"
              style={{
                width: Math.max(5, Math.round(6 * scale)),
                height: Math.max(5, Math.round(6 * scale)),
                backgroundColor: statusTx ?? '#34d399',
              }}
            />
            {status}
          </span>
        )}
      </div>

      <div
        className="flex shrink-0 justify-between gap-2"
        style={{ marginTop: Math.round(6 * scale) }}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          <MapPin
            size={iconMd}
            color="#38bdf8"
            style={{ marginTop: Math.round(10 * scale), flexShrink: 0 }}
          />
          <div className="min-w-0">
            <div className="text-zinc-500" style={{ fontSize: labelFs }}>
              {stationLabel}
            </div>
            <div className="font-bold leading-tight text-zinc-50" style={{ fontSize: valueFs }}>
              {nextSt || '—'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1.5 text-right">
          <Hourglass
            size={iconMd}
            color="#38bdf8"
            style={{ marginTop: Math.round(10 * scale), flexShrink: 0 }}
          />
          <div>
            <div className="text-zinc-500" style={{ fontSize: labelFs }}>
              {etaLabel}
            </div>
            <div className="font-bold leading-tight" style={{ fontSize: valueFs, color: etaValueColor }}>
              {etaRem || '—'}
            </div>
          </div>
        </div>
      </div>

      <MaintenanceTrack
        widget={widget}
        sortedStations={sortedStations}
        minVal={minVal}
        range={range}
        progressPercent={progressPercent}
        nextSt={nextSt}
        scale={scale}
        vehicleIconBg={vehicleIconBg}
        actionIconUrl={actionIconUrl}
      />

      <div
        className="mt-auto flex shrink-0 items-center justify-between text-zinc-400"
        style={{
          marginTop: Math.round(4 * scale),
          padding: `${Math.round(6 * scale)}px ${pad}px`,
          marginLeft: -pad,
          marginRight: -pad,
          backgroundColor: 'rgba(0,0,0,0.35)',
          fontSize: footerFs,
          borderBottomLeftRadius: 6,
          borderBottomRightRadius: 6,
        }}
      >
        <span className="flex items-center gap-1">
          <AlarmClock size={iconSm} color="#94a3b8" />
          {departLabel} {depart || '—'}
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 size={iconSm} color="#94a3b8" />
          {endLabel} {endT || '—'}
        </span>
      </div>
    </div>
  );
}

export function RouteProgressWidgetView({ widget }: { widget: RouteProgressWidget }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const variables = useVariables();
  const isShiftCardTrack =
    widget.variant === 'track'
    && variables.shift_key !== undefined;

  const data = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: isShiftCardTrack ? '' : widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: isShiftCardTrack ? 0 : widget.refreshInterval,
  });

  const shiftMqttTopic =
    isShiftCardTrack && variables.vehicle_code
      ? `v1/vtms/${String(variables.vehicle_code)}/operation/update`
      : undefined;

  const fleetShiftPayload = useShiftVehicleOperationMqtt(
    isShiftCardTrack && variables.vehicle_code
      ? String(variables.vehicle_code)
      : undefined,
  );

  const mqttState = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId ?? (shiftMqttTopic && !isShiftCardTrack ? 'default-mqtt' : undefined),
    mqttTopic: isShiftCardTrack ? undefined : (widget.mqttTopic ?? shiftMqttTopic),
    mqttValuePath: widget.mqttValuePath,
  });

  const sqlRow = data.data[0] ?? null;
  const mqttRaw = mqttState.data as Record<string, unknown> | null;
  const mqttPayloadRaw = isShiftCardTrack
    ? fleetShiftPayload
    : mqttRaw && !isWrappedMqttValue(mqttRaw)
      ? mqttRaw
      : null;
  const mqttPayload =
    mqttPayloadRaw && mqttPayloadIsFresh(mqttPayloadRaw) ? mqttPayloadRaw : null;

  let rawValue: unknown = undefined;
  if (widget.mqttProgressPath && mqttPayload && !isShiftCardTrack) {
    rawValue = getByPath(mqttPayload, widget.mqttProgressPath);
  }
  if (rawValue === undefined || rawValue === null) {
    if (sqlRow && widget.valueField) {
      rawValue = sqlRow[widget.valueField];
    }
  }
  if ((rawValue === undefined || rawValue === null) && mqttRaw && isWrappedMqttValue(mqttRaw)) {
    rawValue = mqttRaw.value;
  }

  const sortedStations = useMemo(
    () => resolveRouteStations(widget, variables as Record<string, unknown>, sqlRow),
    [widget, variables, sqlRow],
  );

  const progressPercent = useAnimatedTrackPercent(
    sortedStations,
    widget,
    variables as Record<string, unknown>,
    sqlRow,
    rawValue,
    mqttPayload,
    { mqttOnly: isShiftCardTrack },
  );
  const isPending = readOrderStatus(variables as Record<string, unknown>, sqlRow, mqttPayload) === 'PENDING';

  const actionIconUrl = useMemo(
    () =>
      resolveActionIconUrl(
        widget.actionIconRules,
        variables as Record<string, unknown>,
        sqlRow,
        mqttPayload,
      ),
    [widget.actionIconRules, variables, sqlRow, mqttPayload],
  );

  const isDetailCard = widget.variant === 'detail-card';
  const isServiceCard = widget.variant === 'service-card';
  const alertFromVar =
    widget.alertBorderVarKey && variables[widget.alertBorderVarKey] !== undefined
      ? Boolean(variables[widget.alertBorderVarKey])
      : false;
  const borderFromVar =
    widget.cardBorderVarKey && variables[widget.cardBorderVarKey] !== undefined
      ? String(variables[widget.cardBorderVarKey])
      : undefined;
  const borderStyle = borderFromVar
    ? `1px solid ${borderFromVar}`
    : widget.alertBorder || alertFromVar
      ? '1px solid rgba(239,68,68,0.75)'
      : '1px solid rgba(34,197,94,0.35)';

  const status =
    widget.statusLabelVarKey && variables[widget.statusLabelVarKey] !== undefined
      ? String(variables[widget.statusLabelVarKey])
      : widget.statusLabel;
  const statusBg =
    widget.statusBgVarKey && variables[widget.statusBgVarKey] !== undefined
      ? String(variables[widget.statusBgVarKey])
      : widget.statusBgColor;
  const statusTx =
    widget.statusTextColorVarKey && variables[widget.statusTextColorVarKey] !== undefined
      ? String(variables[widget.statusTextColorVarKey])
      : widget.statusTextColor;
  const nextSt =
    widget.originVarKey && variables[widget.originVarKey] !== undefined
      ? String(variables[widget.originVarKey])
      : variables.next_station !== undefined
        ? String(variables.next_station)
        : widget.originLabel ?? '';
  const etaRem =
    widget.destVarKey && variables[widget.destVarKey] !== undefined
      ? String(variables[widget.destVarKey])
      : variables.eta_remain !== undefined
        ? String(variables.eta_remain)
        : widget.destLabel ?? '';
  const depart =
    widget.departTimeVarKey && variables[widget.departTimeVarKey] !== undefined
      ? String(variables[widget.departTimeVarKey])
      : '';
  const endT =
    widget.endTimeVarKey && variables[widget.endTimeVarKey] !== undefined
      ? String(variables[widget.endTimeVarKey])
      : '';
  const etaDelay =
    variables.eta_delay !== undefined && String(variables.eta_delay).trim()
      ? String(variables.eta_delay)
      : '';
  const vehicleCode =
    variables.vehicle_code !== undefined ? String(variables.vehicle_code) : '';
  const tripCode =
    variables.trip_code !== undefined ? String(variables.trip_code) : '';
  const maintTypeLabel =
    variables.maint_type_label !== undefined ? String(variables.maint_type_label) : undefined;
  const maintTypeBg =
    variables.maint_type_bg !== undefined ? String(variables.maint_type_bg) : '#422006';
  const maintTypeColor =
    variables.maint_type_color !== undefined ? String(variables.maint_type_color) : '#fdba74';
  const etaLabel =
    variables.eta_label !== undefined
      ? String(variables.eta_label)
      : (widget.cardMetricLabel ?? 'ETA');
  const vehicleIconBg = useMemo(
    () =>
      resolveVehicleIconBgColor(variables as Record<string, unknown>, sqlRow, {
        iconBgColor: widget.iconBgColor,
        vehicleIconBgVarKey: widget.vehicleIconBgVarKey,
        vehicleHealthVarKey: widget.vehicleHealthVarKey,
      }),
    [variables, sqlRow, widget.iconBgColor, widget.vehicleIconBgVarKey, widget.vehicleHealthVarKey],
  );

  const hasLiveData = !!sqlRow || mqttPayload !== null || sortedStations.length > 0
    || (rawValue !== undefined && rawValue !== null);
  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, hasLiveData);
  const renderStations = isEditPreview && sortedStations.length === 0
    ? MOCK_ROUTE_STATIONS
    : sortedStations;
  const renderMinVal = renderStations.length > 0 ? renderStations[0].value : 0;
  const renderMaxVal = renderStations.length > 0 ? renderStations[renderStations.length - 1].value : 100;
  const renderRange = renderMaxVal - renderMinVal || 1;
  const renderProgress = isEditPreview && sortedStations.length === 0 ? 42 : progressPercent;
  const previewText = (field: string, current: string | undefined): string => {
    if (isEditPreview && !(current ?? '').trim()) {
      return resolveWidgetEditPreview({
        valueField: field,
        type: 'route-progress',
      });
    }
    return current ?? '';
  };
  const renderStatus = previewText('status_label', status);
  const renderNextSt = previewText('next_station', nextSt);
  const renderEtaRem = previewText('eta_remain', etaRem);
  const renderDepart = previewText('depart_time', depart);
  const renderEndT = previewText('end_time', endT);
  const renderVehicleCode = previewText('vehicle_code', vehicleCode);
  const renderTripCode = previewText('trip_code', tripCode);
  const previewWrap = (node: ReactNode) => (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'route-progress' })}
    >
      {node}
    </WidgetEditPreviewOutline>
  );

  if (isDetailCard) {
    return previewWrap(
      <DispatchCardView
        widget={widget}
        sortedStations={renderStations}
        minVal={renderMinVal}
        range={renderRange}
        progressPercent={renderProgress}
        borderStyle={borderStyle}
        alertFromVar={alertFromVar}
        variables={variables}
        status={renderStatus}
        statusBg={statusBg}
        statusTx={statusTx}
        nextSt={renderNextSt}
        etaRem={renderEtaRem}
        etaDelay={etaDelay || (isEditPreview ? '+2' : '')}
        depart={renderDepart}
        endT={renderEndT}
        vehicleCode={renderVehicleCode}
        tripCode={renderTripCode}
        vehicleIconBg={vehicleIconBg}
        actionIconUrl={actionIconUrl}
      />,
    );
  }

  if (isServiceCard) {
    return previewWrap(
      <MaintenanceCardView
        widget={widget}
        sortedStations={renderStations}
        minVal={renderMinVal}
        range={renderRange}
        progressPercent={renderProgress}
        borderStyle={borderStyle}
        alertFromVar={alertFromVar}
        status={renderStatus}
        statusBg={statusBg}
        statusTx={statusTx}
        nextSt={renderNextSt}
        etaRem={renderEtaRem}
        etaLabel={etaLabel}
        depart={renderDepart}
        endT={renderEndT}
        vehicleCode={renderVehicleCode}
        tripCode={renderTripCode}
        maintTypeLabel={maintTypeLabel ?? (isEditPreview ? '定期保養' : undefined)}
        maintTypeBg={maintTypeBg}
        maintTypeColor={maintTypeColor}
        vehicleIconBg={vehicleIconBg}
        actionIconUrl={actionIconUrl}
      />,
    );
  }

  return previewWrap(
    <div className="relative flex h-full w-full flex-col justify-center">
      <RouteTrackView
        widget={widget}
        stations={renderStations}
        progressPercent={renderProgress}
        vehicleIconBg={vehicleIconBg}
        actionIconUrl={actionIconUrl}
        isPending={isPending}
      />
    </div>,
  );
}
