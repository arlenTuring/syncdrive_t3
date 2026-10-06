import {
  buildAdoption,
  describeSwitch,
  noPlanSummary,
  summarizeDailyPlan,
  type DailyPlanAdoption,
  type DailyPlanOrderRow,
} from './daily-plan';

const DAY = '2026-10-06';
const T0 = new Date(2026, 9, 6, 6, 0, 0).getTime();
const MIN = 60_000;

function plannedItem(tripCode: string, kind: string, startMin: number, durMin = 20) {
  return { tripCode, kind, departAt: T0 + startMin * MIN, arriveAt: T0 + (startMin + durMin) * MIN };
}

function adopt(planned: ReturnType<typeof plannedItem>[], previous: DailyPlanAdoption | null = null, digest = 'v1', shiftId = 'S1') {
  return buildAdoption({
    operatingDay: DAY,
    shift: { id: shiftId, name: `班表${shiftId}`, version: null, updatedAt: 1 },
    planDigest: digest,
    loadDigest: null,
    planned,
    scheduleTrips: planned.map((item) => ({ trip_code: item.tripCode, task_type: item.kind === 'passenger' ? 'passenger' : 'idle' })),
    skipped: 0,
    via: 'simulator',
    by: null,
    now: 1_000,
    previous,
  });
}

function order(tripCode: string, status: string, extra: Partial<DailyPlanOrderRow> = {}): DailyPlanOrderRow {
  return { orderId: `${tripCode}-${Math.random()}`, tripCode, status, planDigest: 'v1', closedReason: null, completedAt: null, ...extra };
}

describe('每日計畫', () => {
  const planned = [
    plannedItem('NT01', 'passenger', 0),
    plannedItem('TS01', 'passenger', 30),
    plannedItem('ST01', 'passenger', 60),
    // 次日凌晨 00:30 的班次仍屬原營運日
    plannedItem('NT99', 'passenger', 18 * 60 + 30),
    plannedItem('MVOUT-1', 'movement', -10),
    plannedItem('MT-1', 'maintenance', 200),
  ];

  it('總班次只算載客班次；整備、空車出入廠不算', () => {
    const adoption = adopt(planned);
    expect(adoption.passenger_trips.map((trip) => trip.code)).toEqual(['NT01', 'TS01', 'ST01', 'NT99']);
    expect(adoption.counts).toMatchObject({ passenger: 4, movement: 1, maintenance: 1 });
    expect(adoption.passenger_trips.at(-1)!.start).toBeGreaterThan(T0 + 18 * 60 * MIN);
  });

  it('同一個計畫班次重發、重試只算一次完成；完成數不超過分母', () => {
    const adoption = adopt(planned);
    const summary = summarizeDailyPlan(adoption, [
      order('NT01', 'FAULTED'),
      order('NT01', 'END', { completedAt: T0 + 19 * MIN }),
      order('NT01', 'END', { completedAt: T0 + 20 * MIN }),
    ], T0 + 25 * MIN);
    expect(summary).toMatchObject({ total_shifts: 4, completed_shifts: 1, remaining_shifts: 3, achievement_pct: 25 });
  });

  it('不同版本的訂單不計入，另外計數', () => {
    const adoption = adopt(planned);
    const summary = summarizeDailyPlan(adoption, [
      order('NT01', 'END', { planDigest: 'v0', completedAt: T0 + 20 * MIN }),
    ], T0 + 25 * MIN);
    expect(summary.completed_shifts).toBe(0);
    expect(summary.other_version_orders).toBe(1);
  });

  it('延誤：完成晚於界線、或執行中已超過界線；故障結案不算延誤，列為未達成', () => {
    const adoption = adopt(planned);
    const now = T0 + 90 * MIN;
    const summary = summarizeDailyPlan(adoption, [
      order('NT01', 'END', { completedAt: T0 + 22 * MIN }), // 晚 2 分：延誤，但完成
      order('TS01', 'PROCESSING'), // 計畫 50 分結束，現在 90 分：延誤
      order('ST01', 'FAULTED'), // 故障：不算延誤
    ], now);
    expect(summary).toMatchObject({ completed_shifts: 1, delayed_shifts: 2 });
    expect(summary.unachieved).toMatchObject({ faulted: 1, in_progress: 1, not_due: 1 });
  });

  it('剛好在允許界線內完成不算延誤', () => {
    const adoption = adopt(planned);
    const summary = summarizeDailyPlan(adoption, [order('NT01', 'END', { completedAt: T0 + 20 * MIN + 59_000 })], T0 + 30 * MIN);
    expect(summary.delayed_shifts).toBe(0);
  });

  it('中心端取消與故障分開列原因；沒執行、已過發車時間的列為已過時未執行', () => {
    const adoption = adopt(planned);
    const summary = summarizeDailyPlan(adoption, [
      order('NT01', 'FAULTED', { closedReason: 'cancelled_by_center' }),
    ], T0 + 120 * MIN);
    expect(summary.unachieved).toMatchObject({ cancelled: 1, not_run_overdue: 2, not_due: 1 });
    expect(summary.unachieved_line).toBe('未達成：取消 1、已過時未執行 2');
  });

  it('只執行部分時段：分母仍是整份計畫，沒跑的不消失也不變成完成', () => {
    const adoption = adopt(planned);
    const summary = summarizeDailyPlan(adoption, [order('TS01', 'END', { completedAt: T0 + 50 * MIN })], T0 + 55 * MIN);
    expect(summary).toMatchObject({ total_shifts: 4, completed_shifts: 1, remaining_shifts: 3 });
  });

  it('有計畫但沒有執行資料：總數照計畫、完成為零', () => {
    const summary = summarizeDailyPlan(adopt(planned), [], T0);
    expect(summary).toMatchObject({ state: 'ok', total_shifts: 4, completed_shifts: 0, delayed_shifts: 0, achievement_line: '達成了 0%' });
  });

  it('沒有每日計畫：明講尚未部署，不給零', () => {
    const summary = noPlanSummary(DAY, T0);
    expect(summary).toMatchObject({ state: 'no_plan', total_shifts: null, completed_shifts: null, achievement_line: '尚未部署每日計畫' });
  });

  it('換版本：保留歷史並說明切換；同一版本重新採用不變', () => {
    const first = adopt(planned);
    const same = adopt(planned, first);
    expect(describeSwitch(first, same)).toMatchObject({ changed: false, kind: 'same' });
    expect(same.history).toHaveLength(0);
    const second = adopt(planned.slice(0, 2), first, 'v2');
    expect(describeSwitch(first, second)).toMatchObject({ changed: true, kind: 'revised' });
    expect(second.history[0]).toMatchObject({ plan_digest: 'v1', passenger: 4 });
    const other = adopt(planned, second, 'v9', 'S2');
    expect(describeSwitch(second, other).kind).toBe('replaced');
    expect(other.history.map((item) => item.plan_digest)).toEqual(['v2', 'v1']);
  });
});
