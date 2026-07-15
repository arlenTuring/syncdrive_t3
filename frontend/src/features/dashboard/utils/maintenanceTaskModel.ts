/** 整備任務：一卡一種；示範模式車已在目標格，軌道仍顯示 S2W→格位兩站 */
export const MAINTENANCE_ORIGIN = 'S2W';

export function maintTypeLabelFromSlot(slotId: string): string {
  const slot = slotId.trim().toUpperCase();
  if (slot.startsWith('E')) return '充電';
  if (slot.startsWith('P')) return '臨停';
  if (slot.startsWith('W')) return '洗車';
  if (slot.startsWith('H')) return '調度';
  if (slot.startsWith('M')) return '保養';
  return '整備';
}

export function maintenanceDemoOrderId(vehicleCode: string, yardSlotId: string): string {
  const vehicle = vehicleCode.trim().toUpperCase();
  const slot = yardSlotId.trim().toUpperCase();
  return slot ? `DEMO-ORD-${vehicle}-${slot}` : `DEMO-ORD-${vehicle}`;
}

/** 兩站：S2W(0%) → 目標整備格(100%) */
export function maintenanceRouteStationsJson(slotId: string): string {
  const slot = slotId.trim();
  if (!slot) return '[]';
  return JSON.stringify([
    { name: MAINTENANCE_ORIGIN, remain_pct: 0 },
    { name: slot, remain_pct: 100 },
  ]);
}

/** 已在目標格：第 0 段剩餘 0%（車在終點站） */
export function maintenanceProgressFields(): {
  segment_index: number;
  segment_remain_pct: number;
  route_progress: number;
} {
  return { segment_index: 0, segment_remain_pct: 0, route_progress: 100 };
}

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

export function applyMaintenanceVehicleAndLabelStyle(
  row: Record<string, unknown>,
  yardSlot?: string,
): void {
  const label = String(
    row.maint_type_label ?? (yardSlot ? maintTypeLabelFromSlot(yardSlot) : ''),
  ).trim();
  row.icon_bg_color = MAINTENANCE_VEHICLE_ICON_BG_NORMAL;
  if (label) row.maint_type_color = maintTypeLabelColor(label);
}

function formatMaintEtaSeconds(sec: number): string {
  const total = Math.max(0, Number(sec) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatHmFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 整備班表卡：車已在目標格，補齊站點／時間等欄位 */
export function enrichMaintenanceShiftFields(
  row: Record<string, unknown>,
  mqttPayload?: Record<string, unknown> | null,
  legEtaSeconds?: number,
): Record<string, unknown> {
  const next = { ...row };
  next.line_kind = 'MAINTENANCE';

  const yardSlot = String(
    mqttPayload?.yard_slot_id ?? next.st_c ?? next.yard_slot_id ?? next.next_station ?? '',
  ).trim();

  if (yardSlot) {
    next.st_a = MAINTENANCE_ORIGIN;
    next.st_b = yardSlot;
    next.st_c = yardSlot;
    next.next_station = yardSlot;
    next.route_stations = maintenanceRouteStationsJson(yardSlot);
    if (mqttPayload?.maint_type_label) {
      next.maint_type_label = mqttPayload.maint_type_label;
    } else if (!next.maint_type_label) {
      next.maint_type_label = maintTypeLabelFromSlot(yardSlot);
    }
  }

  Object.assign(next, maintenanceProgressFields());

  const orderStatus = String(mqttPayload?.order_status ?? next.order_status ?? '').toUpperCase();
  next.station_label = '整備站點';
  if (!next.eta_label) {
    next.eta_label = '完成預估';
  }
  if (!next.eta_remain || next.eta_remain === '') {
    if (legEtaSeconds !== undefined) {
      next.eta_remain = formatMaintEtaSeconds(legEtaSeconds);
    } else {
      next.eta_remain = '00:30:00';
    }
  }

  const ts = Number(mqttPayload?.timestamp ?? mqttPayload?.sim_timestamp);
  const nowHm = Number.isFinite(ts) ? formatHmFromMs(ts) : formatHmFromMs(Date.now());
  if (!next.depart_time || next.depart_time === '') next.depart_time = nowHm;
  if (!next.end_time || next.end_time === '') {
    const baseMs = Number.isFinite(ts) ? ts : Date.now();
    next.end_time = formatHmFromMs(baseMs + 30 * 60 * 1000);
  }

  if (!next.status_label) {
    if (orderStatus === 'PENDING') next.status_label = '停留中';
    else next.status_label = '進行中';
  }

  applyMaintenanceCardNormalStyle(next);
  applyMaintenanceVehicleAndLabelStyle(next, yardSlot);

  return next;
}
