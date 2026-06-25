function formatEtaSeconds(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function readLeg(payload: Record<string, unknown>) {
  const leg = payload.current_leg;
  return leg && typeof leg === 'object' ? (leg as Record<string, unknown>) : null;
}

/** 將 operation/update MQTT 覆寫到班次卡 SQL 名冊列（即時欄位優先） */
export function mergeOperationMqttShiftRow(
  sqlRow: Record<string, unknown> | null,
  mqttPayload: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = { ...(sqlRow ?? {}) };
  if (!mqttPayload) return base;

  const phase = String(mqttPayload.vehicle_phase ?? '').toUpperCase();
  const orderStatus = String(mqttPayload.order_status ?? '').toUpperCase();
  const lineKind = String(mqttPayload.line_kind ?? base.line_kind ?? '').toUpperCase();

  if (mqttPayload.trip_code) {
    base.trip_code = mqttPayload.trip_code;
    base.trip_header = mqttPayload.trip_code;
  }
  if (mqttPayload.order_id) {
    base.order_id = mqttPayload.order_id;
    base.shift_key = mqttPayload.order_id;
  }
  if (mqttPayload.operation_action) {
    base.operation_action = mqttPayload.operation_action;
  }

  const leg = readLeg(mqttPayload);
  if (leg?.target_station_id) {
    base.next_station = String(leg.target_station_id);
  }
  if (typeof leg?.eta_seconds === 'number') {
    base.eta_remain = formatEtaSeconds(leg.eta_seconds);
  }

  if (lineKind === 'MAINTENANCE' || mqttPayload.maint_type_label) {
    if (mqttPayload.maint_type_label) base.maint_type_label = mqttPayload.maint_type_label;
    if (mqttPayload.maint_type_bg) base.maint_type_bg = mqttPayload.maint_type_bg;
    if (mqttPayload.maint_type_color) base.maint_type_color = mqttPayload.maint_type_color;
    if (mqttPayload.badge_label) base.badge_label = mqttPayload.badge_label;
    return base;
  }

  if (phase === 'FAULTED' || orderStatus === 'FAULTED') {
    base.order_status = 'FAULTED';
    base.status_label = '故障';
    base.status_bg = 'rgba(255, 100, 103, 0.3)';
    base.status_color = '#FF6467';
    base.card_border_color = '#FF6467';
    base.is_alert = true;
    return base;
  }

  const runningPhase =
    phase === 'TRANSITING'
    || phase === 'DWELLING'
    || phase === 'DOCKING'
    || phase === 'CHARGING'
    || phase === 'YARD_DWELLING';

  if (orderStatus === 'PROCESSING' || runningPhase) {
    const delayMin = Number(base.delay_minutes ?? 0);
    const delayed = delayMin > 0;
    base.order_status = 'PROCESSING';
    base.status_label = delayed ? '延誤' : '準時';
    base.status_bg = delayed ? 'rgba(255, 105, 0, 0.3)' : 'rgba(0, 212, 146, 0.3)';
    base.status_color = delayed ? '#FF8904' : '#00D492';
    base.card_border_color = delayed ? '#FF8904' : '#00D492';
    base.is_alert = false;
    return base;
  }

  if (phase === 'AWAITING_DEPARTURE' || orderStatus === 'PENDING') {
    base.order_status = 'PENDING';
    base.status_label = '待發';
    base.status_bg = '#27272a';
    base.status_color = '#9CA3AF';
    base.card_border_color = '#52525b';
    base.is_alert = false;
    if (!base.operation_action) base.operation_action = 'music';
    return base;
  }

  const delayMin = Number(base.delay_minutes ?? 0);
  const delayed = delayMin > 0;
  base.order_status = 'PROCESSING';
  base.status_label = delayed ? '延誤' : '準時';
  base.status_bg = delayed ? 'rgba(255, 105, 0, 0.3)' : 'rgba(0, 212, 146, 0.3)';
  base.status_color = delayed ? '#FF8904' : '#00D492';
  base.card_border_color = delayed ? '#FF8904' : '#00D492';
  base.is_alert = false;

  return base;
}
