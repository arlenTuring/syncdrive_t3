/**
 * 模擬執行追蹤（純函式，不碰資料庫）。
 *
 * <h3>資料契約</h3>
 * 模擬器建單時寫在訂單 payload 的欄位（模擬器 src/planReplay.js buildPlanOrderBody），
 * 主系統查詢、模擬器畫面都用這一套名稱，不另設別名：
 *
 *   plan_run_id       本次執行 ID
 *   plan_shift_id     載入的班表 ID
 *   plan_load_digest  載入身分（/dispatch/plan/shift/:id 的 identity.load_digest）
 *   plan_run_total    本輪載入計畫的任務數（選定範圍內）；每張單都帶同一個值
 *
 * plan_load_digest 與 plan_run_total 是 2026-10-05 才開始寫的；之前的重播單沒有，
 * 這時計畫數未知，不宣稱整輪完成（outcome = plan_size_unknown）。
 *
 * <h3>車端證據</h3>
 * - 開始：payload.vehicle_progress_at.PROCESSING（車端 REST updateOrderProgress 成功時中心端記下）。
 *   「不是 PENDING」不算：取消或拒絕的單可能從 PENDING 直接結案、從沒開始過。
 * - 回報：vehicle_progress_at 任一項，或 last_operation_report_at（車端 MQTT 進度的車端時間）。
 * - completed_at 是中心端寫的，不當成車端證據。
 */

export const SIMULATION_RUN_PAYLOAD_KEYS = {
  runId: 'plan_run_id',
  shiftId: 'plan_shift_id',
  loadDigest: 'plan_load_digest',
  runTotal: 'plan_run_total',
} as const;

export type SimulationRunOrderRow = {
  orderId: string;
  tripCode: string;
  vehicleCode: string;
  status: string;
  payload: Record<string, unknown> | null;
};

/** 每張單只會落在一類 */
export type SimulationOrderCategory =
  | 'waiting_start'
  | 'running'
  | 'fault_pending'
  | 'cancel_pending'
  | 'completed'
  | 'aborted'
  | 'faulted';

export const SIMULATION_ORDER_CATEGORY_LABEL: Record<SimulationOrderCategory, string> = {
  waiting_start: '已建單，車端尚未開始',
  running: '執行中',
  fault_pending: '車輛故障，訂單結案待確認',
  cancel_pending: '中心端已取消，等車端結案',
  completed: '已完成',
  aborted: '已中止（中心端取消）',
  faulted: '故障結案',
};

const OPEN_CATEGORIES: ReadonlySet<SimulationOrderCategory> = new Set([
  'waiting_start',
  'running',
  'fault_pending',
  'cancel_pending',
]);

export type SimulationRunState =
  | 'no_orders'
  | 'waiting_vehicle_report'
  | 'in_progress'
  | 'closed';

export type SimulationRunOutcome =
  | 'all_completed'
  | 'closed_with_issues'
  | 'incomplete'
  | 'plan_size_unknown';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function classifySimulationOrder(row: SimulationRunOrderRow): SimulationOrderCategory {
  const payload = asRecord(row.payload);
  const cancelled = Boolean(payload.cancel_requested_at) || payload.closed_reason === 'cancelled_by_center';
  if (row.status === 'END') return 'completed';
  if (row.status === 'FAULTED') return cancelled ? 'aborted' : 'faulted';
  if (cancelled) return 'cancel_pending';
  // 跟班次運行紀錄同一個判斷（order-list.util hasPendingVehicleFault）
  const vehicleFault = Boolean(payload.vehicle_fault) || String(payload.vehicle_phase ?? '').toUpperCase() === 'FAULTED';
  if (vehicleFault) return 'fault_pending';
  return row.status === 'PROCESSING' ? 'running' : 'waiting_start';
}

export function summarizeSimulationRun(runId: string, rows: SimulationRunOrderRow[]) {
  const counts: Record<SimulationOrderCategory, number> = {
    waiting_start: 0,
    running: 0,
    fault_pending: 0,
    cancel_pending: 0,
    completed: 0,
    aborted: 0,
    faulted: 0,
  };
  const totals = new Set<number>();
  const shiftIds = new Set<string>();
  const loadDigests = new Set<string>();
  const openOrders: Array<Record<string, unknown>> = [];
  let vehicleStarted = 0;
  let withVehicleReport = 0;
  let completedWithoutVehicleEnd = 0;
  let lastVehicleRestAt: number | null = null;
  let lastVehicleMqttAt: number | null = null;

  for (const row of rows) {
    const payload = asRecord(row.payload);
    const category = classifySimulationOrder(row);
    counts[category] += 1;

    const total = finiteNumber(payload[SIMULATION_RUN_PAYLOAD_KEYS.runTotal]);
    if (total != null) totals.add(total);
    const shiftId = payload[SIMULATION_RUN_PAYLOAD_KEYS.shiftId];
    if (typeof shiftId === 'string' && shiftId) shiftIds.add(shiftId);
    const digest = payload[SIMULATION_RUN_PAYLOAD_KEYS.loadDigest];
    if (typeof digest === 'string' && digest) loadDigests.add(digest);

    const progress = asRecord(payload.vehicle_progress_at);
    const restTimes = ['PROCESSING', 'END', 'FAULTED']
      .map((status) => finiteNumber(progress[status]))
      .filter((t): t is number => t != null);
    const mqttAt = finiteNumber(payload.last_operation_report_at);
    if (finiteNumber(progress.PROCESSING) != null) vehicleStarted += 1;
    if (restTimes.length > 0 || mqttAt != null) withVehicleReport += 1;
    if (restTimes.length) lastVehicleRestAt = Math.max(lastVehicleRestAt ?? 0, ...restTimes);
    if (mqttAt != null) lastVehicleMqttAt = Math.max(lastVehicleMqttAt ?? 0, mqttAt);
    if (category === 'completed' && finiteNumber(progress.END) == null) completedWithoutVehicleEnd += 1;

    if (OPEN_CATEGORIES.has(category) && openOrders.length < 50) {
      openOrders.push({
        order_id: row.orderId,
        trip_code: row.tripCode,
        vehicle_code: row.vehicleCode,
        status: row.status,
        category,
        category_label: SIMULATION_ORDER_CATEGORY_LABEL[category],
      });
    }
  }

  const created = rows.length;
  const plannedTotal = totals.size === 1 ? [...totals][0] : null;
  const notCreated = plannedTotal != null ? Math.max(0, plannedTotal - created) : null;
  const open = counts.waiting_start + counts.running + counts.fault_pending + counts.cancel_pending;

  const issues: string[] = [];
  if (totals.size > 1) {
    issues.push(`訂單上的本輪計畫數不一致（${[...totals].join('、')}），無法判斷整輪是否完成`);
  } else if (created > 0 && plannedTotal == null) {
    issues.push('訂單沒有記錄本輪計畫數（plan_run_total，2026-10-05 之前的模擬器），無法判斷整輪是否完成');
  }
  if (plannedTotal != null && created > plannedTotal) {
    issues.push(`建立的訂單 ${created} 張多於本輪計畫 ${plannedTotal} 項`);
  }
  if (notCreated) {
    issues.push(`有 ${notCreated} 項計畫沒有建單（尚未發送，或模擬器建單失敗；伺服器端無法區分，明細看模擬器）`);
  }
  if (shiftIds.size > 1) issues.push(`同一個執行 ID 出現多份班表：${[...shiftIds].join('、')}`);
  if (loadDigests.size > 1) issues.push(`同一個執行 ID 出現多個載入身分：${[...loadDigests].join('、')}`);
  if (counts.fault_pending) issues.push(`${counts.fault_pending} 張車輛已回報故障，車端尚未以 REST 結案`);
  if (counts.cancel_pending) issues.push(`${counts.cancel_pending} 張中心端已取消，車端尚未結案`);
  if (counts.faulted) issues.push(`${counts.faulted} 張故障結案`);
  if (counts.aborted) issues.push(`${counts.aborted} 張中心端取消後中止`);
  if (completedWithoutVehicleEnd) {
    issues.push(`${completedWithoutVehicleEnd} 張已完成但沒有車端 END 回報紀錄`);
  }

  let state: SimulationRunState;
  if (created === 0) state = 'no_orders';
  else if (open > 0) state = withVehicleReport === 0 ? 'waiting_vehicle_report' : 'in_progress';
  else state = 'closed';

  let outcome: SimulationRunOutcome | null = null;
  if (state === 'closed') {
    if (plannedTotal == null) outcome = 'plan_size_unknown';
    else if (notCreated) outcome = 'incomplete';
    else if (counts.faulted || counts.aborted || completedWithoutVehicleEnd || created > plannedTotal) {
      outcome = 'closed_with_issues';
    } else outcome = 'all_completed';
  }

  return {
    run_id: runId,
    payload_keys: SIMULATION_RUN_PAYLOAD_KEYS,
    state,
    outcome,
    planned_total: plannedTotal,
    orders_created: created,
    not_created: notCreated,
    open_orders_count: open,
    counts,
    category_labels: SIMULATION_ORDER_CATEGORY_LABEL,
    vehicle: {
      started: vehicleStarted,
      with_report: withVehicleReport,
      last_rest_report_at: lastVehicleRestAt == null ? null : new Date(lastVehicleRestAt).toISOString(),
      last_mqtt_report_at: lastVehicleMqttAt == null ? null : new Date(lastVehicleMqttAt).toISOString(),
    },
    shift_ids: [...shiftIds],
    load_digests: [...loadDigests],
    issues,
    open_orders: openOrders,
  };
}
