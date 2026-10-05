import { enrichMaintenanceShiftFields } from './maintenanceTaskModel';
import { enrichMainlineShiftFields } from './mainlineTaskModel';

function readLeg(payload: Record<string, unknown>) {
  const leg = payload.current_leg;
  return leg && typeof leg === 'object' ? (leg as Record<string, unknown>) : null;
}

function isMainlineContext(base: Record<string, unknown>, mqttPayload: Record<string, unknown> | null): boolean {
  // 業務分類看 SQL 的 business_kind，其次 line_kind；不看班次代號長什麼樣
  const baseKind = String(base.business_kind ?? base.line_kind ?? '').toUpperCase();
  // 過渡（出入廠、待命、暫停）跟正線用同一種卡（顯示「過渡」）；待命單雖然帶格位與整備徽章，也不是整備卡
  if (baseKind === 'MAINLINE' || baseKind === 'TRANSITION') return true;
  if (baseKind === 'MAINTENANCE') return false;

  const mqttKind = String(mqttPayload?.line_kind ?? '').toUpperCase();
  if (mqttKind === 'MAINLINE' || mqttKind === 'TRANSITION') return true;
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
  // 訂單狀態只用 SQL（REST 寫入）的值，車端 MQTT 的 order_status 不覆蓋
  if (isMainlineContext(base, mqttPayload)) {
    return enrichMainlineShiftFields(base, mqttPayload, legEta);
  }

  if (mqttPayload.maint_type_label) base.maint_type_label = mqttPayload.maint_type_label;
  if (mqttPayload.maint_type_bg) base.maint_type_bg = mqttPayload.maint_type_bg;
  if (mqttPayload.maint_type_color) base.maint_type_color = mqttPayload.maint_type_color;
  if (mqttPayload.badge_label) base.badge_label = mqttPayload.badge_label;
  return enrichMaintenanceShiftFields(base, mqttPayload, legEta);
}
