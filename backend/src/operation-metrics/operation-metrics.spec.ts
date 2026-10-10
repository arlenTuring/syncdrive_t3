import {
  buildCapacityTrend,
  type CapacityDay,
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


});

describe('buildCapacityTrend', () => {
  const DAY = 24 * 60 * 60_000;
  const day0 = Date.UTC(2026, 9, 10) - 8 * 3600_000; // 台北 2026-10-10 00:00
  const template = templateSegments({
    attributes: [
      { id: 'peak', name: '尖峰模式', capacityPphpd: 1400, color: '#FF8904' },
      { id: 'off', name: '離峰模式', capacityPphpd: 0, color: '#00D3F2' },
      { id: 'greet', name: '招呼模式', capacityPphpd: 365, color: '#00D492' },
    ],
    intervals: [
      { startTime: '00:00', endTime: '05:00', attributeId: 'greet' },
      { startTime: '05:00', endTime: '07:00', attributeId: 'off' },
      { startTime: '07:00', endTime: '10:00', attributeId: 'peak' },
      { startTime: '10:00', endTime: '23:00', attributeId: 'off' },
      { startTime: '23:00', endTime: '00:00', attributeId: 'greet' },
    ],
  });
  const days: CapacityDay[] = [
    { dayStart: day0 - DAY, segments: template, templateIssue: null },
    { dayStart: day0, segments: template, templateIssue: null },
    { dayStart: day0 + DAY, segments: template, templateIssue: null },
  ];
  const fmt = (ts: number) => new Date(ts + 8 * 3600_000).toISOString().slice(11, 16);
  const build = (now: number, actualAt: (ts: number) => number | null, issue: string | null = null, d: CapacityDay[] = days) =>
    buildCapacityTrend({ now, days: d, pastMinutes: 120, futureMinutes: 240, bucketMinutes: 10, actualAt, dataIssue: issue, formatTime: fmt });

  it('gray line follows the template across the whole window (incl. future and legal 0), as steps at segment boundaries', () => {
    const now = day0 + (6 * 60 + 20) * 60_000;
    const rows = build(now, () => null);
    expect(rows[0].ts).toBeLessThanOrEqual(now - 120 * 60_000);
    expect(rows.at(-1)!.ts).toBeGreaterThanOrEqual(now + 240 * 60_000);
    expect(rows.every((row) => row.forecast_util !== null)).toBe(true);
    expect(rows.some((row) => row.forecast_util === 0)).toBe(true);
    const boundary = rows.filter((row) => row.ts === day0 + 7 * 3600_000);
    expect(boundary.map((row) => [row.forecast_util, row.segment_id, row.segment_color])).toEqual([
      [0, 'off', '#00D3F2'],
      [1400, 'peak', '#FF8904'],
    ]);
    // 時間戳排序，不是 HH:mm 字串
    expect(rows.map((row) => row.ts)).toEqual([...rows.map((row) => row.ts)].sort((a, b) => a - b));
  });

  it('blue line stops at now, keeps 0, leaves gaps as null and marks the now row', () => {
    const now = day0 + 8 * 3600_000 + 5 * 60_000;
    const runStart = day0 + 7 * 3600_000;
    const rows = build(now, (ts) => (ts < runStart ? null : 0));
    expect(rows.filter((row) => row.ts > now).every((row) => row.actual_util === null)).toBe(true);
    expect(rows.filter((row) => row.ts < runStart).every((row) => row.actual_util === null)).toBe(true);
    const nowRow = rows.find((row) => row.is_now)!;
    expect(nowRow).toMatchObject({ ts: now, actual_util: 0, now_ms: now });
  });

  it('crosses midnight with dated timestamps and per-day templates', () => {
    const now = day0 + DAY + 30 * 60_000; // 隔天 00:30
    const rows = build(now, () => 100);
    const times = rows.map((row) => row.time);
    expect(times).toContain('23:00');
    expect(times).toContain('00:30');
    expect(rows.find((row) => row.time === '23:30')!.segment_id).toBe('greet');
    expect(rows.find((row) => row.time === '23:30')!.ts).toBeLessThan(now);
  });

  it('a missing template is reported, never drawn as a fake line', () => {
    const missing: CapacityDay[] = days.map((d) => ({ ...d, segments: null, templateIssue: '部署班表沒有綁定時間模板' }));
    const rows = build(day0 + 8 * 3600_000, () => 500, '部署班表沒有綁定時間模板', missing);
    expect(rows.every((row) => row.forecast_util === null)).toBe(true);
    expect(rows[0].data_issue).toBe('部署班表沒有綁定時間模板');
  });
});
