import {
  buildShiftCenterSummary,
  formatHeadway,
  mergeDepartureLeads,
  nextSegment,
  pphpdAt,
  segmentAt,
  templateSegments,
} from './operation-metrics';

describe('operation-metrics', () => {
  it('同向連續的不同路線路段（NT→TS）只算一趟；同向又從同一起點出發才是下一趟', () => {
    const direction = (key: string) => (key === 'NT' || key === 'TS' ? 'A' : key === 'ST' || key === 'TN' ? 'B' : null);
    const leads = mergeDepartureLeads(
      [
        { routeKey: 'NT', atSecond: 0 },
        { routeKey: 'TS', atSecond: 200 },
        { routeKey: 'ST', atSecond: 400 },
        { routeKey: 'TN', atSecond: 600 },
        { routeKey: 'NT', atSecond: 800 },
      ],
      direction,
    );
    expect(leads).toEqual([
      { directionKey: 'A', atSecond: 0 },
      { directionKey: 'B', atSecond: 400 },
      { directionKey: 'A', atSecond: 800 },
    ]);
  });

  it('過去 60 分鐘平均班距換 pphpd：載客 70、班距 180 秒 → 1400', () => {
    const leads = Array.from({ length: 30 }, (_, i) => ({ directionKey: 'A', atSecond: i * 180 }));
    expect(Math.round(pphpdAt(leads, 3600, 70))).toBe(1400);
    // 視窗內沒有任何班距 → 0
    expect(pphpdAt(leads, 20_000, 70)).toBe(0);
  });

  it('時間模板時段：跨午夜時段、此刻時段、下一個運量不同的時段', () => {
    const segments = templateSegments({
      attributes: [
        { id: 'a', name: '離峰', capacityPphpd: 700 },
        { id: 'b', name: '尖峰', capacityPphpd: 1400 },
      ],
      intervals: [
        { startTime: '07:00', endTime: '10:00', attributeId: 'b', name: '早尖峰' },
        { startTime: '10:00', endTime: '07:00', attributeId: 'a', name: '離峰' },
      ],
    });
    expect(segmentAt(segments, 8 * 60)?.pphpd).toBe(1400);
    expect(segmentAt(segments, 2 * 60)?.pphpd).toBe(700);
    expect(nextSegment(segments, 8 * 60)).toMatchObject({ startMinute: 600, pphpd: 700 });
    expect(nextSegment(segments, 12 * 60)).toMatchObject({ startMinute: 7 * 60 + 1440, pphpd: 1400 });
  });

  it('時段班距：取時間模板時段屬性的 headwaySeconds，沒設就是 null 並顯示「—」', () => {
    const segments = templateSegments({
      attributes: [
        { id: 'a', name: '離峰', capacityPphpd: 700, headwaySeconds: 360 },
        { id: 'b', name: '尖峰', capacityPphpd: 1400 },
      ],
      intervals: [
        { startTime: '07:00', endTime: '10:00', attributeId: 'b', name: '早尖峰' },
        { startTime: '10:00', endTime: '07:00', attributeId: 'a', name: '離峰' },
      ],
    });
    expect(segmentAt(segments, 12 * 60)?.headwaySeconds).toBe(360);
    expect(formatHeadway(segmentAt(segments, 12 * 60)?.headwaySeconds ?? null)).toBe('06:00');
    expect(segmentAt(segments, 8 * 60)?.headwaySeconds).toBeNull();
    expect(formatHeadway(null)).toBe('—');
  });

  it('班次中心：完成＝END；延誤＝晚結束、故障、進行中已超過計畫結束', () => {
    const now = 1_000_000_000;
    const summary = buildShiftCenterSummary({
      shiftName: '班表',
      plannedTrips: 10,
      orders: [
        { status: 'END', plannedEnd: now - 600_000, delayMinutes: 0 },
        { status: 'END', plannedEnd: now - 600_000, delayMinutes: 2 },
        { status: 'FAULTED', plannedEnd: now, delayMinutes: 0 },
        { status: 'PROCESSING', plannedEnd: now - 120_000, delayMinutes: 0 },
        { status: 'PROCESSING', plannedEnd: now + 120_000, delayMinutes: 0 },
      ],
      now,
    });
    expect(summary).toMatchObject({
      total_shifts: 10,
      completed_shifts: 2,
      delayed_shifts: 3,
      achievement_pct: 20,
      remaining_shifts: 8,
      remaining_line: '剩餘8班次',
    });
  });
});
