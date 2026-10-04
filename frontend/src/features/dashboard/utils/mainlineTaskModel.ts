/*
 * 正線班次卡欄位。
 *
 * <h3>這裡不再自己生資料</h3>
 * 原本 SQL 沒給的欄位會用寫死的值補：站名一律 N2W下行／T3下行／S2W下行、方向看班次代號
 * 第一個字母、發車時間從代號 D1133 拆出來、到站倒數也從代號算。畫面上看起來每張卡都
 * 有值，但那些值不是任何資料來源給的，使用者沒辦法查核，資料斷了也看不出來。
 *
 * 現在只做兩件事：
 * 1. 依車端 MQTT（operation/update）覆寫即時欄位（狀態、下一站、剩餘到站）；
 * 2. 依狀態套卡片樣式（顏色是樣式，不是資料）。
 * SQL 與 MQTT 都沒給的欄位就留空，卡片顯示「—」。每個欄位從哪裡來，列在
 * {@link MAINLINE_ROW_FIELD_ORIGINS}，屬性面板照它顯示。
 */

/** 正線班次列：前端依 MQTT 覆寫的欄位與其來源（屬性面板的資料來源說明照這份顯示） */
export const MAINLINE_ROW_FIELD_ORIGINS: Record<string, string> = {
  order_status: 'MQTT operation/update 的 order_status／vehicle_phase；沒有 MQTT 時用 SQL',
  status_label: '依 order_status 與 SQL delay_minutes 判定（待發／準時／延誤／故障）',
  next_station: 'MQTT current_leg.target_station_id，對照這一列 SQL route_stations 的站名；對不到就保留 SQL 值',
  eta_remain: '執行中：MQTT current_leg.eta_seconds；待發：SQL trip_start_minutes 距現在的時間',
  trip_code: 'MQTT trip_code；沒有 MQTT 時用 SQL',
  vehicle_code: 'MQTT vehicle_code；沒有 MQTT 時用 SQL',
};

/**
 * 這一列自己帶的站序裡，某個 station_id 叫什麼名字。
 *
 * route_stations 是 SQL 從訂單 payload 取出來的真站序（每一班不同，站數 2 到 5 都有）。
 */
function stationNameFromRouteStations(
  row: Record<string, unknown>,
  stationId: string,
): string | null {
  const raw = row.route_stations;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const items = JSON.parse(raw) as Array<{
      name?: string;
      station_id?: string;
      role?: string;
      dwell_seconds?: number;
    }>;
    if (!Array.isArray(items)) return null;
    const at = items.findIndex((item) => String(item?.station_id ?? '').trim() === stationId);
    if (at < 0) return null;
    /*
     * 車端報的目標站可能是轉線點（停留 0 秒，不是一站）。「下一站」要說的是下一個
     * 會停的站，所以從目標站往後找第一個停靠站；找不到就用目標站本身。
     */
    const stop = items.slice(at).find((item) => {
      const role = String(item?.role ?? '').trim().toLowerCase();
      if (!role) return true;
      if (role === 'origin' || role === 'terminal' || role === 'destination') return true;
      const dwell = Number(item?.dwell_seconds);
      return !Number.isFinite(dwell) || dwell > 0;
    });
    const name = String((stop ?? items[at])?.name ?? '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export function formatMainlineEtaMmSs(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 距 SQL 給的發車分鐘（當日 0 點起算的分鐘數）還有幾分鐘；SQL 沒給就是 null */
function minutesUntilDeparture(row: Record<string, unknown>, nowMs = Date.now()): number | null {
  const raw = row.trip_start_minutes;
  if (raw === null || raw === undefined || raw === '') return null;
  const start = Number(raw);
  if (!Number.isFinite(start)) return null;
  const now = new Date(nowMs);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, start - nowMin);
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

function applyPendingFields(row: Record<string, unknown>) {
  row.order_status = 'PENDING';
  Object.assign(row, MAINLINE_PENDING_STYLE);
  row.station_label = '下一站';
  row.eta_label = '剩餘到站';
  // 待發的下一站就是 SQL 從班表算出來的起站；SQL 沒給就留空。
  row.segment_index = 0;
  row.segment_remain_pct = 100;
  row.route_progress = 0;
  const mins = minutesUntilDeparture(row);
  if (mins !== null) row.eta_remain = formatMainlineEtaMmSs(mins * 60);
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
  if (leg?.target_station_id) {
    /*
     * 車端回報的是 station_id（t3_u 這種），要換成站名才能放上卡片：查這一列 SQL 自己的
     * 站序（route_stations）。查不到就<strong>不要動</strong>這一欄——station_id 是給機器看的
     * 識別碼，SQL 算出來的那個值至少是人看得懂的站名。
     */
    const alias = stationNameFromRouteStations(row, String(leg.target_station_id));
    if (alias) row.next_station = alias;
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
    // 方向、站序、發車與結束時間都以 SQL 為準；SQL 沒給就留空，不從班次代號推。
  }

  // 訂單狀態以 SQL（中心端 REST 寫入）為準；車端 MQTT 的 order_status 不採信，SQL 沒給才看
  const orderStatus = String(next.order_status ?? mqttPayload?.order_status ?? '').toUpperCase();
  const phase = String(mqttPayload?.vehicle_phase ?? '').toUpperCase();

  // 訂單真的故障結案（REST）：故障卡
  // 車端回報故障但訂單還沒結案：同樣是警示樣式，但標「故障・待結案」，訂單狀態不改（不假裝已結案）
  if (phase === 'FAULTED' || orderStatus === 'FAULTED') {
    if (orderStatus === 'FAULTED') next.order_status = 'FAULTED';
    Object.assign(next, MAINLINE_FAULTED_STYLE);
    if (orderStatus !== 'FAULTED') {
      next.status_label = '故障・待結案';
      next.fault_pending_close = true;
    }
    next.station_label = '下一站';
    next.eta_label = '剩餘到站';
    if (!next.icon_bg_color) next.icon_bg_color = '#ef4444';
    return next;
  }

  if (phase === 'AWAITING_DEPARTURE' || orderStatus === 'PENDING') {
    applyPendingFields(next);
    return next;
  }

  if (isMainlineProcessingPhase(phase, orderStatus)) {
    applyProcessingFields(next, mqttPayload, legEtaSeconds);
    return next;
  }

  // 狀態不明（SQL 與 MQTT 都沒給）：不替它判「準時」，照 SQL 原樣顯示。
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

/**
 * 從 MQTT 組最小正線列（SQL 名冊尚未寫入時）。
 *
 * 只放 MQTT 真的有的欄位；站序、方向、發車時間 MQTT 沒有，就留空等 SQL。
 */
export function buildMainlineRowFromMqtt(payload: Record<string, unknown>): Record<string, unknown> {
  const tripCode = String(payload.trip_code ?? '').trim().toUpperCase();
  const vehicleCode = String(payload.vehicle_code ?? '');
  const orderId = String(payload.order_id ?? '');
  return enrichMainlineShiftFields({
    shift_key: orderId,
    order_id: orderId,
    vehicle_code: vehicleCode,
    trip_code: tripCode,
    trip_header: `${tripCode} ${vehicleCode}`.trim(),
  }, payload);
}
