/**
 * 整備班表卡欄位。
 *
 * 原本 SQL 沒給的欄位會用寫死的值補：起站一律 S2W、站序固定兩站、進度一律 100%、
 * 完成預估一律 00:30:00、發車時間用「現在」、結束時間用「現在 + 30 分」、任務類型看格位
 * 代號第一個字母猜。那些值不是任何資料來源給的，使用者沒辦法查核。
 *
 * 現在只依車端 MQTT 覆寫它真的有回報的欄位，其餘照 SQL；兩邊都沒有就留空。
 */

/** 依格位代號開頭字母猜任務類型（僅供車輛監控徽章沿用；班表卡不再用它補值） */
export function maintTypeLabelFromSlot(slotId: string): string {
  const slot = slotId.trim().toUpperCase();
  if (slot.startsWith('E')) return '充電';
  if (slot.startsWith('P')) return '臨停';
  if (slot.startsWith('W')) return '洗車';
  if (slot.startsWith('H')) return '調度';
  if (slot.startsWith('M')) return '保養';
  return '整備';
}

/** 整備班表列：前端依 MQTT 覆寫的欄位與其來源（屬性面板的資料來源說明照這份顯示） */
export const MAINTENANCE_ROW_FIELD_ORIGINS: Record<string, string> = {
  next_station: 'MQTT operation/update 的 yard_slot_id；沒有 MQTT 時用 SQL',
  maint_type_label: 'MQTT maint_type_label；沒有 MQTT 時用 SQL',
  eta_remain: 'MQTT current_leg.eta_seconds；沒有 MQTT 時用 SQL',
  status_label: 'SQL；SQL 沒給時依 order_status 判定（PENDING 停留中、PROCESSING 進行中）',
};

/** 整備卡正常態（綠）；故障／逾時告警邏輯尚未上線前一律使用 */
export const MAINTENANCE_CARD_NORMAL_STYLE = {
  card_border_color: '#009966',
  status_bg: 'rgba(0, 212, 146, 0.3)',
  status_color: '#00BC7D',
  is_alert: false,
} as const;

/** 軌道車體圖示：正常藍；僅警告態改黃（告警邏輯上線後使用） */
export const MAINTENANCE_VEHICLE_ICON_BG_NORMAL = '#51A2FF';
export const MAINTENANCE_VEHICLE_ICON_BG_WARNING = '#FD9A00';

/** 任務類型 badge 文字色：僅依任務種類，與卡片正常／警告／故障無關 */
export function maintTypeLabelColor(label: string): string {
  const normalized = label.trim();
  if (normalized === '臨停') return '#FD9A00';
  if (normalized === '充電') return '#FD9A00';
  if (normalized === '洗車') return '#FD9A00';
  if (normalized === '調度') return '#FD9A00';
  if (normalized === '保養') return '#FD9A00';
  if (normalized === '整備') return '#FD9A00';
  return '#FD9A00';
}

export function applyMaintenanceCardNormalStyle(row: Record<string, unknown>): void {
  Object.assign(row, MAINTENANCE_CARD_NORMAL_STYLE);
}

export function applyMaintenanceVehicleAndLabelStyle(row: Record<string, unknown>): void {
  const label = String(row.maint_type_label ?? '').trim();
  row.icon_bg_color = MAINTENANCE_VEHICLE_ICON_BG_NORMAL;
  if (label) row.maint_type_color = maintTypeLabelColor(label);
}

function formatMaintEtaSeconds(sec: number): string {
  const total = Math.max(0, Number(sec) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/** 整備班表卡：依車端 MQTT 覆寫即時欄位，其餘照 SQL */
export function enrichMaintenanceShiftFields(
  row: Record<string, unknown>,
  mqttPayload?: Record<string, unknown> | null,
  legEtaSeconds?: number,
): Record<string, unknown> {
  const next = { ...row };
  next.line_kind = 'MAINTENANCE';

  const mqttSlot = String(mqttPayload?.yard_slot_id ?? '').trim();
  if (mqttSlot) next.next_station = mqttSlot;
  if (mqttPayload?.maint_type_label) next.maint_type_label = mqttPayload.maint_type_label;
  if (legEtaSeconds !== undefined) next.eta_remain = formatMaintEtaSeconds(legEtaSeconds);

  const orderStatus = String(mqttPayload?.order_status ?? next.order_status ?? '').toUpperCase();
  if (!next.status_label) {
    if (orderStatus === 'PENDING') next.status_label = '停留中';
    else if (orderStatus === 'PROCESSING') next.status_label = '進行中';
  }

  applyMaintenanceCardNormalStyle(next);
  applyMaintenanceVehicleAndLabelStyle(next);

  return next;
}
