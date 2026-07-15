import { SHIFT_TRIP_CODE_PATTERN } from '../constants/vtmsVehiclePool';
import { mergeOperationMqttShiftRow } from './mergeOperationMqttShiftRow';
import { buildMainlineRowFromMqtt } from './mainlineTaskModel';
import { enrichMaintenanceShiftFields, maintenanceDemoOrderId } from './maintenanceTaskModel';

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
  // 整備卡需有格位才列入（避免 operation retain 僅剩徽章、地圖無車的幽靈列）
  const yardSlot = String(payload.yard_slot_id ?? '').trim();
  if (!yardSlot) return false;
  return !!(payload.maint_type_label || lineKind === 'MAINTENANCE');
}

function buildMaintenanceRowFromMqtt(payload: Record<string, unknown>): Record<string, unknown> {
  const vehicleCode = String(payload.vehicle_code ?? '');
  const yardSlot = String(payload.yard_slot_id ?? '').trim();
  const orderId = String(
    payload.order_id ?? maintenanceDemoOrderId(vehicleCode, yardSlot),
  );
  return enrichMaintenanceShiftFields(
    {
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
    },
    payload,
  );
}

function mergeRosterFromMqtt(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
  isActive: (p: Record<string, unknown>) => boolean,
  buildMinimal: (p: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown>[] {
  const sqlByKey = new Map<string, Record<string, unknown>>();
  const sqlByVehicle = new Map<string, Record<string, unknown>>();
  for (const row of sqlRows) {
    const key = String(row.shift_key ?? row.order_id ?? '');
    if (key) sqlByKey.set(key, row);
    const vehicleCode = String(row.vehicle_code ?? '').trim().toUpperCase();
    if (vehicleCode) sqlByVehicle.set(vehicleCode, row);
  }

  const seenOrder = new Set<string>();
  const mqttRows: Record<string, unknown>[] = [];
  const mqttVehicleCodes = new Set<string>();
  const mqttByKey = new Map<string, Record<string, unknown>>();
  const mqttByVehicleRow = new Map<string, Record<string, unknown>>();

  for (const payload of mqttByVehicle.values()) {
    if (!isActive(payload)) continue;
    const orderId = String(payload.order_id ?? '');
    if (!orderId || seenOrder.has(orderId)) continue;
    seenOrder.add(orderId);
    const vehicleCode = String(payload.vehicle_code ?? '').trim().toUpperCase();
    if (vehicleCode) mqttVehicleCodes.add(vehicleCode);
    const base =
      sqlByKey.get(orderId)
      ?? (vehicleCode ? sqlByVehicle.get(vehicleCode) : undefined)
      ?? buildMinimal(payload);
    const merged = mergeOperationMqttShiftRow(base, payload);
    mqttRows.push(merged);
    mqttByKey.set(orderId, merged);
    if (vehicleCode) mqttByVehicleRow.set(vehicleCode, merged);
  }

  if (mqttRows.length === 0) return sqlRows;

  const merged: Record<string, unknown>[] = [];
  const usedKeys = new Set<string>();

  for (const sqlRow of sqlRows) {
    const key = String(sqlRow.shift_key ?? sqlRow.order_id ?? '');
    const vehicleCode = String(sqlRow.vehicle_code ?? '').trim().toUpperCase();
    if (vehicleCode && mqttVehicleCodes.has(vehicleCode)) {
      const live = mqttByKey.get(key) ?? mqttByVehicleRow.get(vehicleCode);
      if (live) {
        merged.push(live);
        usedKeys.add(String(live.shift_key ?? live.order_id ?? key));
      } else {
        merged.push(sqlRow);
        if (key) usedKeys.add(key);
      }
      continue;
    }
    merged.push(sqlRow);
    if (key) usedKeys.add(key);
  }

  for (const row of mqttRows) {
    const key = String(row.shift_key ?? row.order_id ?? '');
    if (key && usedKeys.has(key)) continue;
    merged.push(row);
  }

  return merged.sort(
    (a, b) => tripSortKey(String(a.trip_code ?? '')) - tripSortKey(String(b.trip_code ?? '')),
  );
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

/** 整備名冊：MQTT 觸發槽位更新（正線執勤車輛不列入整備卡） */
export function mergeMaintenanceShiftRoster(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  const yardMqtt = new Map<string, Record<string, unknown>>();
  for (const [vehicleCode, payload] of mqttByVehicle) {
    if (isActiveMainlineMqtt(payload)) continue;
    yardMqtt.set(vehicleCode, payload);
  }
  const merged = mergeRosterFromMqtt(
    sqlRows.filter((row) => {
      const vc = String(row.vehicle_code ?? '').trim().toUpperCase();
      const live = mqttByVehicle.get(vc);
      return !live || !isActiveMainlineMqtt(live);
    }),
    yardMqtt,
    isActiveMaintenanceMqtt,
    buildMaintenanceRowFromMqtt,
  );
  return merged.filter((row) => {
    const vc = String(row.vehicle_code ?? '').trim().toUpperCase();
    const live = mqttByVehicle.get(vc);
    return !live || !isActiveMainlineMqtt(live);
  });
}
