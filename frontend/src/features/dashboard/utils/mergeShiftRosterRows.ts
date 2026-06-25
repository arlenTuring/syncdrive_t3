import { SHIFT_TRIP_CODE_PATTERN } from '../constants/vtmsVehiclePool';
import { mergeOperationMqttShiftRow } from './mergeOperationMqttShiftRow';

function tripSortKey(tripCode: string): number {
  const m = /^[DU](\d{2})(\d{2})$/i.exec(tripCode.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isActiveMainlineMqtt(payload: Record<string, unknown>): boolean {
  const trip = String(payload.trip_code ?? '').trim();
  if (!SHIFT_TRIP_CODE_PATTERN.test(trip)) return false;
  const status = String(payload.order_status ?? '').toUpperCase();
  if (status === 'END' || status === 'ENDED' || status === 'CANCELLED') return false;
  return true;
}

function isActiveMaintenanceMqtt(payload: Record<string, unknown>): boolean {
  const lineKind = String(payload.line_kind ?? '').toUpperCase();
  if (lineKind !== 'MAINTENANCE' && !payload.maint_type_label) return false;
  const status = String(payload.order_status ?? '').toUpperCase();
  if (status === 'END' || status === 'ENDED' || status === 'CANCELLED') return false;
  return !!(payload.yard_slot_id || payload.maint_type_label);
}

function mainlineRouteStationsJson(tripCode: string): string {
  const isUp = tripCode.trim().toUpperCase().startsWith('U');
  const names = isUp ? ['S2W', 'T3', 'N2W'] : ['N2W', 'T3', 'S2W'];
  return JSON.stringify(names.map((name) => ({ name })));
}

function buildMainlineRowFromMqtt(payload: Record<string, unknown>): Record<string, unknown> {
  const tripCode = String(payload.trip_code ?? '').trim().toUpperCase();
  const vehicleCode = String(payload.vehicle_code ?? '');
  const orderId = String(payload.order_id ?? '');
  const isUp = tripCode.startsWith('U');
  const stations = isUp ? ['S2W', 'T3', 'N2W'] : ['N2W', 'T3', 'S2W'];
  return {
    shift_key: orderId,
    order_id: orderId,
    vehicle_code: vehicleCode,
    trip_code: tripCode,
    trip_header: `${tripCode} ${vehicleCode}`,
    direction_label: isUp ? '上行' : '下行',
    direction_pill_bg: isUp ? '#51A2FF' : '#8E51FF',
    direction_pill_color: '#FFFFFF',
    st_a: stations[0],
    st_b: 'T3',
    st_c: stations[2],
    route_stations: mainlineRouteStationsJson(tripCode),
    line_kind: 'MAINLINE',
    delay_minutes: 0,
    eta_delay: '',
    is_alert: false,
  };
}

function buildMaintenanceRowFromMqtt(payload: Record<string, unknown>): Record<string, unknown> {
  const vehicleCode = String(payload.vehicle_code ?? '');
  const orderId = String(payload.order_id ?? `DEMO-ORD-${vehicleCode}`);
  return {
    shift_key: orderId,
    order_id: orderId,
    vehicle_code: vehicleCode,
    trip_code: payload.trip_code ?? '',
    trip_header: String(payload.badge_label ?? payload.maint_type_label ?? vehicleCode),
    line_kind: 'MAINTENANCE',
    maint_type_label: payload.maint_type_label,
    maint_type_bg: payload.maint_type_bg,
    maint_type_color: payload.maint_type_color,
    delay_minutes: 0,
    is_alert: false,
  };
}

function mergeRosterFromMqtt(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
  isActive: (p: Record<string, unknown>) => boolean,
  buildMinimal: (p: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown>[] {
  const sqlByKey = new Map<string, Record<string, unknown>>();
  for (const row of sqlRows) {
    const key = String(row.shift_key ?? row.order_id ?? '');
    if (key) sqlByKey.set(key, row);
  }

  const seenOrder = new Set<string>();
  const mqttRows: Record<string, unknown>[] = [];

  for (const payload of mqttByVehicle.values()) {
    if (!isActive(payload)) continue;
    const orderId = String(payload.order_id ?? '');
    if (!orderId || seenOrder.has(orderId)) continue;
    seenOrder.add(orderId);
    const base = sqlByKey.get(orderId) ?? buildMinimal(payload);
    mqttRows.push(mergeOperationMqttShiftRow(base, payload));
  }

  if (mqttRows.length > 0) {
    return mqttRows.sort(
      (a, b) => tripSortKey(String(a.trip_code ?? '')) - tripSortKey(String(b.trip_code ?? '')),
    );
  }
  return sqlRows;
}

/** 正線名冊：MQTT 有活躍班次時立即顯示，SQL 僅補 route_stations 等靜態欄位 */
export function mergeMainlineShiftRoster(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  return mergeRosterFromMqtt(
    sqlRows,
    mqttByVehicle,
    isActiveMainlineMqtt,
    buildMainlineRowFromMqtt,
  );
}

/** 整備名冊：MQTT 觸發槽位更新 */
export function mergeMaintenanceShiftRoster(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  return mergeRosterFromMqtt(
    sqlRows,
    mqttByVehicle,
    isActiveMaintenanceMqtt,
    buildMaintenanceRowFromMqtt,
  );
}
