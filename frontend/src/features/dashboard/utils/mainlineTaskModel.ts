import { shiftTripScheduleFromCode, tripStartMinutesFromCode } from '../constants/vtmsVehiclePool';

/** 正線三站軌道：上行 station_6→station_4→station_1、下行 station_2→station_3→station_5 */
export function mainlineStationTriplet(tripCode: string): [string, string, string] {
  const isUp = tripCode.trim().toUpperCase().startsWith('U');
  return isUp ? ['station_6', 'station_4', 'station_1'] : ['station_2', 'station_3', 'station_5'];
}

/** 班次卡軌道標籤（人類可讀別名） */
export function mainlineStationDisplayTriplet(tripCode: string): [string, string, string] {
  const isUp = tripCode.trim().toUpperCase().startsWith('U');
  return isUp ? ['S2W上行', 'T3上行', 'N2W上行'] : ['N2W下行', 'T3下行', 'S2W下行'];
}

/** MQTT / SQL 的 station_id → 班次卡顯示用站名 */
export function resolveMainlineStationDisplayName(
  stationId: string,
  tripCode: string,
): string {
  const id = String(stationId ?? '').trim();
  if (!id) return '';
  const ids = mainlineStationTriplet(tripCode);
  const names = mainlineStationDisplayTriplet(tripCode);
  const idx = ids.indexOf(id);
  return idx >= 0 ? names[idx] : id;
}

export function mainlineRouteStationsJson(tripCode: string): string {
  const ids = mainlineStationTriplet(tripCode);
  const names = mainlineStationDisplayTriplet(tripCode);
  return JSON.stringify(ids.map((station_id, i) => ({ name: names[i], station_id })));
}

export function formatMainlineEtaMmSs(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function minutesUntilDeparture(tripCode: string, nowMs = Date.now()): number | null {
  const start = tripStartMinutesFromCode(tripCode);
  if (start === null) return null;
  const now = new Date(nowMs);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, start - nowMin);
}

function fillTripScheduleFields(row: Record<string, unknown>) {
  if (row.depart_time != null && row.depart_time !== '' && row.end_time != null && row.end_time !== '') {
    return;
  }
  const schedule = shiftTripScheduleFromCode(String(row.trip_code ?? ''));
  if (!schedule) return;
  if (row.depart_time == null || row.depart_time === '') row.depart_time = schedule.depart_time;
  if (row.end_time == null || row.end_time === '') row.end_time = schedule.end_time;
}

/** 待發：灰框灰字；進行中：綠；故障：紅；延誤：橘 */
export const MAINLINE_PENDING_STYLE = {
  status_label: '待發',
  status_bg: '#27272a',
  status_color: '#a1a1aa',
  card_border_color: 'rgba(113,113,122,0.45)',
  is_alert: false,
} as const;

export const MAINLINE_PROCESSING_ON_TIME_STYLE = {
  status_label: '準時',
  status_bg: 'rgba(0, 212, 146, 0.3)',
  status_color: '#00BC7D',
  card_border_color: '#009966',
  is_alert: false,
} as const;

export const MAINLINE_PROCESSING_DELAY_STYLE = {
  status_label: '延誤',
  status_bg: '#422006',
  status_color: '#fb923c',
  card_border_color: 'rgba(249,115,22,0.75)',
  is_alert: false,
} as const;

export const MAINLINE_FAULTED_STYLE = {
  status_label: '故障',
  status_bg: '#450a0a',
  status_color: '#f87171',
  card_border_color: 'rgba(239,68,68,0.75)',
  is_alert: true,
} as const;

function readLeg(payload: Record<string, unknown> | null | undefined) {
  const leg = payload?.current_leg;
  return leg && typeof leg === 'object' ? (leg as Record<string, unknown>) : null;
}

function isMainlineProcessingPhase(phase: string, orderStatus: string): boolean {
  return (
    orderStatus === 'PROCESSING'
    || phase === 'TRANSITING'
    || phase === 'DWELLING'
    || phase === 'DOCKING'
  );
}

function applyPendingFields(row: Record<string, unknown>, tripCode: string) {
  const [origin] = mainlineStationDisplayTriplet(tripCode);
  row.order_status = 'PENDING';
  Object.assign(row, MAINLINE_PENDING_STYLE);
  row.station_label = '下一站';
  row.eta_label = '剩餘到站';
  row.next_station = origin;
  row.segment_index = 0;
  row.segment_remain_pct = 100;
  row.route_progress = 0;
  const mins = minutesUntilDeparture(tripCode);
  row.eta_remain =
    mins !== null
      ? formatMainlineEtaMmSs(mins * 60)
      : String(row.eta_remain ?? '00:00');
  if (!row.operation_action) row.operation_action = 'music';
  if (!row.icon_bg_color) row.icon_bg_color = '#52525b';
}

function applyProcessingFields(
  row: Record<string, unknown>,
  mqttPayload: Record<string, unknown> | null | undefined,
  legEtaSeconds?: number,
) {
  const delayMin = Number(row.delay_minutes ?? 0);
  const delayed = delayMin > 0;
  row.order_status = 'PROCESSING';
  Object.assign(
    row,
    delayed ? MAINLINE_PROCESSING_DELAY_STYLE : MAINLINE_PROCESSING_ON_TIME_STYLE,
  );
  row.station_label = '下一站';
  row.eta_label = '剩餘到站';
  const leg = readLeg(mqttPayload);
  const tripCode = String(row.trip_code ?? mqttPayload?.trip_code ?? '').trim().toUpperCase();
  if (leg?.target_station_id && tripCode) {
    row.next_station = resolveMainlineStationDisplayName(
      String(leg.target_station_id),
      tripCode,
    );
  }
  if (legEtaSeconds !== undefined) {
    row.eta_remain = formatMainlineEtaMmSs(legEtaSeconds);
  }
  if (!row.icon_bg_color) row.icon_bg_color = '#51A2FF';
}

/**
 * 正線班次卡欄位（與整備任務規則分離）：
 * - 待發：下一站=起點、剩餘到站=距發車倒數、軌道停在起點
 * - 進行中：下一站=current_leg、剩餘到站=leg ETA
 */
export function enrichMainlineShiftFields(
  row: Record<string, unknown>,
  mqttPayload?: Record<string, unknown> | null,
  legEtaSeconds?: number,
): Record<string, unknown> {
  const next = { ...row };
  next.line_kind = 'MAINLINE';

  const tripCode = String(next.trip_code ?? mqttPayload?.trip_code ?? '').trim().toUpperCase();
  if (tripCode) {
    next.trip_code = tripCode;
    const isUp = tripCode.startsWith('U');
    next.direction_label = isUp ? '上行' : '下行';
    next.direction_pill_bg = isUp ? '#51A2FF' : '#8E51FF';
    next.direction_pill_color = '#FFFFFF';
    const [stA, stB, stC] = mainlineStationDisplayTriplet(tripCode);
    next.st_a = stA;
    next.st_b = stB;
    next.st_c = stC;
    if (!next.route_stations || next.route_stations === '[]') {
      next.route_stations = mainlineRouteStationsJson(tripCode);
    }
  }

  fillTripScheduleFields(next);

  const orderStatus = String(mqttPayload?.order_status ?? next.order_status ?? '').toUpperCase();
  const phase = String(mqttPayload?.vehicle_phase ?? '').toUpperCase();

  if (phase === 'FAULTED' || orderStatus === 'FAULTED') {
    next.order_status = 'FAULTED';
    Object.assign(next, MAINLINE_FAULTED_STYLE);
    next.station_label = '下一站';
    next.eta_label = '剩餘到站';
    if (!next.icon_bg_color) next.icon_bg_color = '#ef4444';
    return next;
  }

  if (phase === 'AWAITING_DEPARTURE' || orderStatus === 'PENDING') {
    applyPendingFields(next, tripCode);
    return next;
  }

  if (isMainlineProcessingPhase(phase, orderStatus)) {
    applyProcessingFields(next, mqttPayload, legEtaSeconds);
    return next;
  }

  applyProcessingFields(next, mqttPayload, legEtaSeconds);
  return next;
}

export function resolveMainlineStatusStyleFromLabel(
  label: string,
): { status_bg: string; status_color: string } | null {
  const normalized = label.trim();
  if (normalized === '待發') {
    return {
      status_bg: MAINLINE_PENDING_STYLE.status_bg,
      status_color: MAINLINE_PENDING_STYLE.status_color,
    };
  }
  if (normalized === '準時') {
    return {
      status_bg: MAINLINE_PROCESSING_ON_TIME_STYLE.status_bg,
      status_color: MAINLINE_PROCESSING_ON_TIME_STYLE.status_color,
    };
  }
  if (normalized === '延誤') {
    return {
      status_bg: MAINLINE_PROCESSING_DELAY_STYLE.status_bg,
      status_color: MAINLINE_PROCESSING_DELAY_STYLE.status_color,
    };
  }
  if (normalized === '故障') {
    return {
      status_bg: MAINLINE_FAULTED_STYLE.status_bg,
      status_color: MAINLINE_FAULTED_STYLE.status_color,
    };
  }
  return null;
}

/** 從 MQTT 組最小正線列（SQL 名冊尚未寫入時） */
export function buildMainlineRowFromMqtt(payload: Record<string, unknown>): Record<string, unknown> {
  const tripCode = String(payload.trip_code ?? '').trim().toUpperCase();
  const vehicleCode = String(payload.vehicle_code ?? '');
  const orderId = String(payload.order_id ?? '');
  const [stA, stB, stC] = mainlineStationDisplayTriplet(tripCode);
  return enrichMainlineShiftFields({
    shift_key: orderId,
    order_id: orderId,
    vehicle_code: vehicleCode,
    trip_code: tripCode,
    trip_header: `${tripCode} ${vehicleCode}`,
    st_a: stA,
    st_b: stB,
    st_c: stC,
    route_stations: mainlineRouteStationsJson(tripCode),
    delay_minutes: 0,
    eta_delay: '',
  }, payload);
}
