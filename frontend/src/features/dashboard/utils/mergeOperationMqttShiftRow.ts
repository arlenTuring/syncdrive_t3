import { enrichMaintenanceShiftFields } from './maintenanceTaskModel';
import { enrichMainlineShiftFields } from './mainlineTaskModel';
import { SHIFT_TRIP_CODE_PATTERN } from '../constants/vtmsVehiclePool';

function readLeg(payload: Record<string, unknown>) {
  const leg = payload.current_leg;
  return leg && typeof leg === 'object' ? (leg as Record<string, unknown>) : null;
}

function isMainlineContext(base: Record<string, unknown>, mqttPayload: Record<string, unknown> | null): boolean {
  const baseKind = String(base.line_kind ?? '').toUpperCase();
  if (baseKind === 'MAINLINE') return true;
  if (baseKind === 'MAINTENANCE') return false;

  const trip = String(mqttPayload?.trip_code ?? base.trip_code ?? '').trim();
  if (SHIFT_TRIP_CODE_PATTERN.test(trip)) return true;

  const mqttKind = String(mqttPayload?.line_kind ?? '').toUpperCase();
  if (mqttKind === 'MAINLINE') return true;
  if (mqttKind === 'MAINTENANCE') return false;

  return !mqttPayload?.maint_type_label;
}

/** 將 operation/update MQTT 覆寫到班次卡 SQL 名冊列（正線／整備分流） */
export function mergeOperationMqttShiftRow(
  sqlRow: Record<string, unknown> | null,
  mqttPayload: Record<string, unknown> | null,
  etaSecondsOverride?: number,
): Record<string, unknown> {
  const base = { ...(sqlRow ?? {}) };
  if (!mqttPayload) {
    const lineKind = String(base.line_kind ?? '').toUpperCase();
    if (lineKind === 'MAINTENANCE') {
      return enrichMaintenanceShiftFields(base);
    }
    return enrichMainlineShiftFields(base);
  }

  if (mqttPayload.trip_code) {
    base.trip_code = mqttPayload.trip_code;
    base.trip_header = `${mqttPayload.trip_code} ${base.vehicle_code ?? mqttPayload.vehicle_code ?? ''}`.trim();
  }
  if (mqttPayload.order_id) {
    base.order_id = mqttPayload.order_id;
    base.shift_key = mqttPayload.order_id;
  }
  if (mqttPayload.vehicle_code) {
    base.vehicle_code = mqttPayload.vehicle_code;
  }
  if (mqttPayload.operation_action) {
    base.operation_action = mqttPayload.operation_action;
  }

  const leg = readLeg(mqttPayload);
  const legEta =
    typeof etaSecondsOverride === 'number' && Number.isFinite(etaSecondsOverride)
      ? etaSecondsOverride
      : typeof leg?.eta_seconds === 'number'
        ? leg.eta_seconds
        : undefined;

  // 正線 SQL 列優先：避免整備 MQTT retain 把「待發」標籤配上整備綠色
  if (isMainlineContext(base, mqttPayload)) {
    if (mqttPayload.order_status) base.order_status = mqttPayload.order_status;
    return enrichMainlineShiftFields(base, mqttPayload, legEta);
  }

  if (mqttPayload.maint_type_label) base.maint_type_label = mqttPayload.maint_type_label;
  if (mqttPayload.maint_type_bg) base.maint_type_bg = mqttPayload.maint_type_bg;
  if (mqttPayload.maint_type_color) base.maint_type_color = mqttPayload.maint_type_color;
  if (mqttPayload.badge_label) base.badge_label = mqttPayload.badge_label;
  if (mqttPayload.order_status) base.order_status = mqttPayload.order_status;
  return enrichMaintenanceShiftFields(base, mqttPayload, legEta);
}
