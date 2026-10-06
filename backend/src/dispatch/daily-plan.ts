/**
 * 每日計畫
 * ========
 *
 * 班次中心統計的範圍是「營運日＋該日採用的班次計畫版本」。採用紀錄存在 system_settings
 * （operation.daily_plan.<YYYY-MM-DD>），內容是採用當下展開的計畫快照：
 *
 * <table>
 *   <tr><td>營運日</td><td>operating_day</td></tr>
 *   <tr><td>班表與載入版本</td><td>shift_id、plan_digest（展開後計畫的摘要，與模擬器載入身分同一套）</td></tr>
 *   <tr><td>計畫班次</td><td>班表上的班次代號（trip_code）；同一份班表內唯一，重發、重試都對回同一個</td></tr>
 *   <tr><td>訂單 → 計畫班次</td><td>訂單 payload：operating_day、plan_shift_id、plan_digest、plan_trip_code</td></tr>
 * </table>
 *
 * 正式派單（調度引擎）與模擬器下單都寫同一組 payload 欄位；統計只看這組關聯，不看資料來源
 * 或執行 ID（那兩個只用來追溯、防重複）。
 *
 * <h3>計算原則</h3>
 * <ul>
 *   <li>總班次：計畫中的載客服務班次（task_type passenger：上行、下行與明列為載客的調度班次）。
 *       整備、待命、暫停、純空車出入廠不算。</li>
 *   <li>完成：該計畫班次有一張訂單被車端以真實狀態 API 結束（END）。同一班次多張單只算一次。</li>
 *   <li>剩餘＝總班次－完成。故障、取消、沒執行的仍算未達成，另列原因。</li>
 *   <li>延誤：營運時間超過計畫結束＋允許延誤界線還沒完成（執行中或已派單待開始），或完成時已晚於
 *       界線。完成後仍保留曾延誤的事實。故障、取消結案不直接算延誤，列在未達成原因。</li>
 *   <li>不同版本的訂單不混進分母或完成數，另外計數讓畫面看得到。</li>
 * </ul>
 */

import { DELAY_TOLERANCE_MS } from '../operating-day/operating-day';

/** 計畫快照裡的一個載客班次（時間為營運日上的營運時刻，Epoch 毫秒） */
export type DailyPlanTrip = {
  /** 跨日期、跨版本仍穩定可核對的計畫班次識別 */
  id: string;
  code: string;
  classification: 'passenger';
  start: number | null;
  end: number | null;
};

export type DailyPlanAdoptionVia = 'deploy' | 'simulator' | 'auto_deployed' | 'manual';

export type DailyPlanAdoption = {
  operating_day: string;
  shift_id: string;
  shift_name: string;
  /** 班表內容的版本（班表上的 version 字串，可能沒有） */
  shift_version: string | null;
  /** 班表儲存時間（毫秒）：同一份班表改過就不同 */
  shift_updated_at: number | null;
  /** 展開後計畫的摘要；訂單的 plan_digest 必須相同才算這個版本 */
  plan_digest: string;
  /** 模擬器的完整載入身分（含地圖）；只用來追溯 */
  load_digest: string | null;
  passenger_trips: DailyPlanTrip[];
  counts: { passenger: number; movement: number; maintenance: number; skipped: number };
  adopted_at: number;
  adopted_via: DailyPlanAdoptionVia;
  adopted_by: string | null;
  /** 同一營運日先前採用過的版本（新的在前），只留摘要 */
  history: Array<{
    shift_id: string;
    shift_name: string;
    plan_digest: string;
    passenger: number;
    adopted_at: number;
    adopted_via: DailyPlanAdoptionVia;
    replaced_at: number;
  }>;
};

/** 半開區間 [start, end)：跨午夜與 05:00 邊界不重複計數。 */
export function tripsInWindow(adoption: DailyPlanAdoption, start: number, end: number): DailyPlanTrip[] {
  return adoption.passenger_trips.filter((trip) => trip.start != null && trip.start >= start && trip.start < end);
}

/** 訂單 payload 上的每日計畫關聯欄位（正式派單、模擬器共用） */
export const DAILY_PLAN_PAYLOAD_KEYS = {
  operatingDay: 'operating_day',
  shiftId: 'plan_shift_id',
  planDigest: 'plan_digest',
  tripCode: 'plan_trip_code',
} as const;

export function dailyPlanSettingKey(day: string): string {
  return `operation.daily_plan.${day}`;
}

/** 由調度展開的計畫建立採用紀錄。總班次取班表上的載客班次（含展開時被略過的），不是可派單的數量 */
export function buildAdoption(args: {
  operatingDay: string;
  shift: { id: string; name: string; version: string | null; updatedAt: number | null };
  planDigest: string;
  loadDigest: string | null;
  planned: Array<{ tripCode: string; kind: string; departAt: number; arriveAt: number }>;
  scheduleTrips: Array<{ trip_code: string; task_type: string; start?: number | null; end?: number | null }>;
  skipped: number;
  via: DailyPlanAdoptionVia;
  by: string | null;
  now: number;
  previous: DailyPlanAdoption | null;
}): DailyPlanAdoption {
  const timing = new Map(args.planned.map((item) => [item.tripCode, item] as const));
  const scheduleTiming = new Map(args.scheduleTrips.map((item) => [item.trip_code, item] as const));
  const passengerCodes = new Set<string>();
  for (const trip of args.scheduleTrips) {
    if (trip.task_type === 'passenger' && trip.trip_code) passengerCodes.add(trip.trip_code);
  }
  for (const item of args.planned) {
    if (item.kind === 'passenger') passengerCodes.add(item.tripCode);
  }
  const passengerTrips: DailyPlanTrip[] = [...passengerCodes]
    .map((code) => {
      const item = timing.get(code);
      const scheduled = scheduleTiming.get(code);
      return {
        id: `${args.operatingDay}:${args.shift.id}:${args.planDigest}:${code}`,
        code,
        classification: 'passenger' as const,
        start: item?.departAt ?? scheduled?.start ?? null,
        end: item?.arriveAt ?? scheduled?.end ?? null,
      };
    })
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.code.localeCompare(b.code));
  const count = (kind: string) => args.planned.filter((item) => item.kind === kind).length;
  const previous = args.previous;
  const sameVersion = previous
    && previous.shift_id === args.shift.id
    && previous.plan_digest === args.planDigest;
  const history = previous && !sameVersion
    ? [
        {
          shift_id: previous.shift_id,
          shift_name: previous.shift_name,
          plan_digest: previous.plan_digest,
          passenger: previous.passenger_trips.length,
          adopted_at: previous.adopted_at,
          adopted_via: previous.adopted_via,
          replaced_at: args.now,
        },
        ...previous.history,
      ].slice(0, 20)
    : previous?.history ?? [];
  return {
    operating_day: args.operatingDay,
    shift_id: args.shift.id,
    shift_name: args.shift.name,
    shift_version: args.shift.version,
    shift_updated_at: args.shift.updatedAt,
    plan_digest: args.planDigest,
    load_digest: args.loadDigest,
    passenger_trips: passengerTrips,
    counts: {
      passenger: passengerTrips.length,
      movement: count('movement'),
      maintenance: count('maintenance'),
      skipped: args.skipped,
    },
    // 同一版本重新採用（例如模擬器重播同一份）不改採用時間，歷史也不多一筆
    adopted_at: sameVersion ? previous!.adopted_at : args.now,
    adopted_via: sameVersion ? previous!.adopted_via : args.via,
    adopted_by: sameVersion ? previous!.adopted_by : args.by,
    history,
  };
}

/** 切換結果：前後版本與分母的差別，讓操作的人看得到換了什麼 */
export function describeSwitch(previous: DailyPlanAdoption | null, next: DailyPlanAdoption) {
  if (!previous) {
    return { changed: true, kind: 'new' as const, message: `${next.operating_day} 採用「${next.shift_name}」，載客班次 ${next.passenger_trips.length}` };
  }
  if (previous.shift_id === next.shift_id && previous.plan_digest === next.plan_digest) {
    return { changed: false, kind: 'same' as const, message: `${next.operating_day} 已採用「${next.shift_name}」同一版本，不變` };
  }
  return {
    changed: true,
    kind: previous.shift_id === next.shift_id ? ('revised' as const) : ('replaced' as const),
    message:
      `${next.operating_day} 每日計畫由「${previous.shift_name}」（${previous.passenger_trips.length} 班）`
      + `改為「${next.shift_name}」（${next.passenger_trips.length} 班）；`
      + '舊版本的訂單不計入新版本的完成數',
    previous: {
      shift_id: previous.shift_id,
      shift_name: previous.shift_name,
      plan_digest: previous.plan_digest,
      passenger: previous.passenger_trips.length,
    },
  };
}

export type DailyPlanOrderRow = {
  orderId: string;
  tripCode: string;
  status: string;
  planDigest: string | null;
  closedReason: string | null;
  /** 完成時的營運時刻；舊訂單沒有就退回實際完成時刻 */
  completedAt: number | null;
};

export type ShiftCenterSummary = {
  state: 'ok' | 'no_plan' | 'incomplete';
  message: string | null;
  operating_day: string;
  operating_now: number;
  total_shifts: number | null;
  completed_shifts: number | null;
  delayed_shifts: number | null;
  achievement_pct: number;
  achievement_line: string;
  remaining_shifts: number | null;
  remaining_line: string;
  unachieved: {
    faulted: number;
    cancelled: number;
    in_progress: number;
    pending: number;
    not_run_overdue: number;
    not_due: number;
  } | null;
  unachieved_line: string;
  /** 同一營運日、同一份班表但版本不同的訂單數（不計入） */
  other_version_orders: number;
  shift_name: string | null;
  plan: {
    shift_id: string;
    plan_digest: string;
    adopted_at: number;
    adopted_via: DailyPlanAdoptionVia;
  } | null;
  range?: { start: number; end: number; start_time: string; timezone: string };
  trips?: Array<DailyPlanTrip & { operating_day: string; completed: boolean; delayed: boolean }>;
  missing_days?: string[];
};

export function noPlanSummary(operatingDay: string, operatingNow: number): ShiftCenterSummary {
  return {
    state: 'no_plan',
    message: '尚未部署每日計畫',
    operating_day: operatingDay,
    operating_now: operatingNow,
    total_shifts: null,
    completed_shifts: null,
    delayed_shifts: null,
    achievement_pct: 0,
    achievement_line: '尚未部署每日計畫',
    remaining_shifts: null,
    remaining_line: '',
    unachieved: null,
    unachieved_line: '',
    other_version_orders: 0,
    shift_name: null,
    plan: null,
  };
}

/** 依計畫快照與當天訂單算班次中心 */
export function summarizeDailyPlan(
  adoption: DailyPlanAdoption,
  orders: DailyPlanOrderRow[],
  operatingNow: number,
): ShiftCenterSummary {
  const byTrip = new Map<string, DailyPlanOrderRow[]>();
  let otherVersion = 0;
  for (const order of orders) {
    if (order.planDigest !== adoption.plan_digest) {
      otherVersion += 1;
      continue;
    }
    const list = byTrip.get(order.tripCode) ?? [];
    list.push(order);
    byTrip.set(order.tripCode, list);
  }

  let completed = 0;
  let delayed = 0;
  const unachieved = { faulted: 0, cancelled: 0, in_progress: 0, pending: 0, not_run_overdue: 0, not_due: 0 };
  for (const trip of adoption.passenger_trips) {
    const list = byTrip.get(trip.code) ?? [];
    const lateLine = trip.end != null ? trip.end + DELAY_TOLERANCE_MS : null;
    const done = list.find((order) => order.status === 'END');
    if (done) {
      completed += 1;
      if (lateLine != null && done.completedAt != null && done.completedAt > lateLine) delayed += 1;
      continue;
    }
    const open = list.filter((order) => order.status === 'PENDING' || order.status === 'PROCESSING');
    if (open.length > 0) {
      if (open.some((order) => order.status === 'PROCESSING')) unachieved.in_progress += 1;
      else unachieved.pending += 1;
      if (lateLine != null && operatingNow > lateLine) delayed += 1;
      continue;
    }
    const closed = list.filter((order) => order.status === 'FAULTED');
    if (closed.length > 0) {
      // 最後一張的結案原因代表這一班為什麼沒完成
      const last = closed[closed.length - 1]!;
      if (last.closedReason === 'cancelled_by_center') unachieved.cancelled += 1;
      else unachieved.faulted += 1;
      continue;
    }
    if (trip.start != null && operatingNow > trip.start) unachieved.not_run_overdue += 1;
    else unachieved.not_due += 1;
  }

  const total = adoption.passenger_trips.length;
  const pct = total > 0 ? Math.floor((100 * completed) / total) : 0;
  const remaining = total - completed;
  const reasons = [
    unachieved.faulted ? `故障 ${unachieved.faulted}` : '',
    unachieved.cancelled ? `取消 ${unachieved.cancelled}` : '',
    unachieved.not_run_overdue ? `已過時未執行 ${unachieved.not_run_overdue}` : '',
  ].filter(Boolean);
  return {
    state: 'ok',
    message: null,
    operating_day: adoption.operating_day,
    operating_now: operatingNow,
    total_shifts: total,
    completed_shifts: completed,
    delayed_shifts: delayed,
    achievement_pct: pct,
    achievement_line: `達成了 ${pct}%`,
    remaining_shifts: remaining,
    remaining_line: remaining > 0 ? `剩餘${remaining}班次` : '',
    unachieved,
    unachieved_line: reasons.length ? `未達成：${reasons.join('、')}` : '',
    other_version_orders: otherVersion,
    shift_name: adoption.shift_name,
    plan: {
      shift_id: adoption.shift_id,
      plan_digest: adoption.plan_digest,
      adopted_at: adoption.adopted_at,
      adopted_via: adoption.adopted_via,
    },
  };
}
