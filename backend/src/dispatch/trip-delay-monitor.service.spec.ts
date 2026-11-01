import { TripDelayMonitorService, tripDelayDedupKey, tripDelayEvent } from './trip-delay-monitor.service';

const NOW = 1_800_000_000_000;
const row = { id: 'o1', trip_code: 'TN0325', vehicle_code: 'PMS04', planned_end: String(NOW - 150_000), delay_minutes: 2 };

describe('TripDelayMonitorService', () => {
  const build = (selected: unknown[], insertResult: unknown[] = [{ id: '1' }], open: unknown[] = [], tolerance = 60) => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('INSERT')) return insertResult;
      if (sql.includes('UPDATE')) return [{ order_id: 'o1' }];
      return sql.includes('security_event_logs') ? selected : open;
    });
    const emitEventCenter = jest.fn();
    const emitOrderLifecycle = jest.fn();
    const clock = { now: () => NOW, operatingDay: () => '2026-11-01' };
    const settings = { get: async () => ({ globalParams: { tripDelayToleranceSeconds: tolerance } }) };
    const service = new TripDelayMonitorService({ query } as never, clock as never, { emitEventCenter, emitOrderLifecycle } as never, settings as never);
    return { service, query, emitEventCenter, emitOrderLifecycle };
  };

  it('事件內容：整分鐘延誤、同一張單同一個去重鍵', () => {
    const e = tripDelayEvent(row, 123);
    expect(e.display_message).toBe('班次 TN0325 延誤：超過計畫結束 2 分鐘仍未完成');
    expect(e.dedup_key).toBe(tripDelayDedupKey('o1'));
    expect(JSON.parse(e.params)).toMatchObject({ order_id: 'o1', late_minutes: 2 });
  });

  it('先把判定寫進訂單再通知畫面：分鐘變多才寫；事件只看載客、已判定延誤的訂單', async () => {
    const { service, query, emitOrderLifecycle } = build([], [], [
      { id: 'o1', planned_end: String(NOW - 150_000), delay_minutes: 1 },
      { id: 'o2', planned_end: String(NOW - 90_000), delay_minutes: 1 },
    ]);
    await service.scan();
    const [openSql, openParams] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(openSql).toContain("('PENDING', 'PROCESSING')");
    expect(openParams).toEqual(['2026-11-01', NOW]);
    const updates = query.mock.calls.filter((c) => (c[0] as string).includes('UPDATE'));
    expect(updates.map((c) => (c as unknown[])[1])).toEqual([[2, 'o1']]);
    expect(emitOrderLifecycle).toHaveBeenCalledTimes(1);
    const eventSql = query.mock.calls.at(-1)![0] as string;
    expect(eventSql).toContain("'passenger'");
    expect(eventSql).toContain('o.delay_minutes > 0');
  });

  it('照系統基礎設定的秒數判定：調成 300 秒，晚 150 秒還不算延誤', async () => {
    const { service, query, emitOrderLifecycle } = build([], [], [{ id: 'o1', planned_end: String(NOW - 150_000), delay_minutes: 0 }], 300);
    await service.scan();
    expect(query.mock.calls.some((c) => (c[0] as string).includes('UPDATE'))).toBe(false);
    expect(emitOrderLifecycle).not.toHaveBeenCalled();
  });

  it('寫入後通知事件中心；已存在（衝突）不算新增、不通知', async () => {
    const fresh = build([row]);
    expect(await fresh.service.scan()).toBe(1);
    expect(fresh.emitEventCenter).toHaveBeenCalledTimes(1);
    const insert = fresh.query.mock.calls.find((c) => (c[0] as string).includes('INSERT'))![0] as string;
    expect(insert).toContain("'SYSTEM'");
    expect(insert).toContain("'TRIP_DELAYED'");
    const dup = build([row], []);
    expect(await dup.service.scan()).toBe(0);
    expect(dup.emitEventCenter).not.toHaveBeenCalled();
  });
});
