import { SHIFT_TRIP_CODE_PATTERN } from '../constants/vtmsVehiclePool';
import { mergeOperationMqttShiftRow } from './mergeOperationMqttShiftRow';

/**
 * 這一列目前有套用有效的車端回報（只用來在畫面上標示、驗收；不會出現在樣板欄位裡）。
 * 回報過期後重算，列上就沒有這個標記。
 */
export const ROW_LIVE_REPORT = Symbol('rowLiveReport');

export function hasLiveReport(row: Record<string, unknown> | null | undefined): boolean {
  return Boolean(row && (row as Record<symbol, unknown>)[ROW_LIVE_REPORT]);
}

function isActiveMainlineMqtt(payload: Record<string, unknown>): boolean {
  const trip = String(payload.trip_code ?? '').trim();
  if (!SHIFT_TRIP_CODE_PATTERN.test(trip)) return false;
  const status = String(payload.order_status ?? '').toUpperCase();
  if (status === 'END' || status === 'ENDED' || status === 'CANCELLED') return false;
  return true;
}

/**
 * SQL 名冊列＋車端即時回報。
 *
 * <h3>SQL 決定卡片存不存在，MQTT 只更新同一張單的欄位</h3>
 * - 對應只看單號：回報的 order_id ＝ 名冊列的 shift_key（沒有就用 order_id）。
 * - 原本還有「同一台車有回報、單號對不上時，把那台車的名冊列換成回報那一張」——上一班
 *   的回報會被套到下一班的卡片上，SQL 已經刪掉的單也會被回報「借屍還魂」。已拿掉。
 * - 名冊沒有的單（只有 MQTT）不新增卡片。
 * - 回報是否還有效由車隊 hub 決定（過期、重置前、retain 舊快照都已經不在 hub 裡）。
 */
function mergeRosterFromMqtt(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
  isActive: (p: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const liveByOrder = new Map<string, Record<string, unknown>>();
  for (const payload of mqttByVehicle.values()) {
    if (!isActive(payload)) continue;
    const orderId = String(payload.order_id ?? '').trim();
    if (orderId && !liveByOrder.has(orderId)) liveByOrder.set(orderId, payload);
  }
  if (liveByOrder.size === 0) return sqlRows;

  // 順序也由 SQL 決定：回報出現或過期時，卡片不會因為重新排序而跳位
  return sqlRows.map((sqlRow) => {
    const key = String(sqlRow.shift_key ?? sqlRow.order_id ?? '').trim();
    const payload = key ? liveByOrder.get(key) : undefined;
    return payload
      ? Object.assign(mergeOperationMqttShiftRow(sqlRow, payload), { [ROW_LIVE_REPORT]: true })
      : sqlRow;
  });
}

/** 正線名冊：SQL 列決定有哪些卡；同一張單有有效回報時用回報更新欄位 */
export function mergeMainlineShiftRoster(
  sqlRows: Record<string, unknown>[],
  mqttByVehicle: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  return mergeRosterFromMqtt(sqlRows, mqttByVehicle, isActiveMainlineMqtt);
}

/** 整備名冊：原樣使用 SQL 列（整備單沒有逐站回報可合併） */
export function mergeMaintenanceShiftRoster(
  sqlRows: Record<string, unknown>[],
  _mqttByVehicle: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  // 卡片只來自整備訂單（operation_orders）；MQTT 不能新增、移除或改寫整備卡。
  return sqlRows;
}
