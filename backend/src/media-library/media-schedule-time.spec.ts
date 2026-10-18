import { BadRequestException } from '@nestjs/common';
import { countTimedOccurrences, nextTimedOccurrence, normaliseWeekly, zonedParts, zonedToEpoch } from './media-schedule-time';
import { scheduleSummary } from './media-play-schedules.service';

const TPE = 'Asia/Taipei';
const at = (iso: string) => Date.parse(iso);

describe('media schedule time', () => {
  it('converts local schedule time with the schedule time zone, not the host one', () => {
    expect(zonedToEpoch('2027-05-01', '10:00', TPE)).toBe(at('2027-05-01T10:00:00+08:00'));
    expect(zonedToEpoch('2027-05-01', '10:00', 'UTC')).toBe(at('2027-05-01T10:00:00Z'));
    expect(zonedParts(at('2027-05-01T02:00:00Z'), TPE)).toMatchObject({ date: '2027-05-01', time: '10:00', weekday: 6 });
  });

  it('handles daylight saving: a skipped local time is pushed forward, a repeated one plays once', () => {
    // 2027-03-14 美東 02:00 跳到 03:00；02:30 不存在 → 03:30 EDT
    expect(zonedToEpoch('2027-03-14', '02:30', 'America/New_York')).toBe(at('2027-03-14T03:30:00-04:00'));
    // 2027-11-07 01:30 出現兩次 → 取第一次（EDT）
    expect(zonedToEpoch('2027-11-07', '01:30', 'America/New_York')).toBe(at('2027-11-07T01:30:00-04:00'));
    const weekly = { '7': ['01:30'] };
    const first = nextTimedOccurrence({ startDate: '2027-11-01', endDate: '2027-11-07', weekly, timeZone: 'America/New_York' }, at('2027-11-06T00:00:00Z'));
    expect(first).toBe(at('2027-11-07T01:30:00-04:00'));
    expect(nextTimedOccurrence({ startDate: '2027-11-01', endDate: '2027-11-07', weekly, timeZone: 'America/New_York' }, first!)).toBeNull();
  });

  it('walks selected weekdays and times in order, including the first and last date', () => {
    const plan = { startDate: '2027-05-03', endDate: '2027-05-10', weekly: { '1': ['08:00', '12:00'], '3': ['15:00'] }, timeZone: TPE };
    const seen: number[] = [];
    let cursor = at('2027-05-01T00:00:00+08:00');
    for (;;) {
      const next = nextTimedOccurrence(plan, cursor);
      if (next === null) break;
      seen.push(next);
      cursor = next;
    }
    expect(seen.map((epoch) => `${zonedParts(epoch, TPE).date} ${zonedParts(epoch, TPE).time}`)).toEqual([
      '2027-05-03 08:00', '2027-05-03 12:00', '2027-05-05 15:00', '2027-05-10 08:00', '2027-05-10 12:00',
    ]);
    expect(countTimedOccurrences(plan, at('2027-05-03T00:00:00+08:00'), at('2027-05-05T23:00:00+08:00'))).toBe(3);
  });

  it('keeps going without an end date, without expanding the future', () => {
    const next = nextTimedOccurrence({ startDate: '2027-01-01', endDate: null, weekly: { '5': ['09:00'] }, timeZone: TPE }, at('2031-06-01T00:00:00+08:00'));
    expect(zonedParts(next!, TPE)).toMatchObject({ date: '2031-06-06', time: '09:00', weekday: 5 });
  });

  it('rejects duplicate or malformed times and sorts the rest', () => {
    expect(normaliseWeekly({ '3': ['20:00', '15:00', '18:00'] })).toEqual({ '3': ['15:00', '18:00', '20:00'] });
    expect(() => normaliseWeekly({ '3': ['20:00', '20:00'] })).toThrow('週三的 20:00 重複');
    expect(() => normaliseWeekly({ '1': [] })).toThrow(BadRequestException);
    expect(() => normaliseWeekly({ '1': ['8:00'] })).toThrow('時間格式');
    expect(() => normaliseWeekly({})).toThrow('至少選擇一個星期');
  });

  it('summarises without calling an open-ended timed schedule a loop', () => {
    expect(scheduleSummary({ mode: 'timed', runLocal: null, startDate: '2027-05-01', endDate: null, weekly: { '1': ['08:00', '12:00'] } })).toBe('2027-05-01 至 無結束日期　週一 08:00、12:00');
    expect(scheduleSummary({ mode: 'reserved', runLocal: '2027-05-01T10:00', startDate: null, endDate: null, weekly: null })).toBe('2027-05-01 10:00');
  });
});
