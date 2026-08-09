import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  earliestStartPastBlockerOnDayCycle,
  formatScheduleClockHms,
  formatScheduleClockRangeHms,
  splitIntoDayCycleSegments,
  wrapScheduleMinute,
} from './scheduleDayCycle.ts';

describe('scheduleDayCycle', () => {
  it('formats past-midnight as 00:xx not 24:xx', () => {
    assert.equal(formatScheduleClockHms(24 * 60), '00:00:00');
    assert.equal(formatScheduleClockHms(24 * 60 + 3 + 40 / 60), '00:03:40');
    assert.equal(formatScheduleClockHms(23 * 60 + 59 + 20 / 60), '23:59:20');
    assert.equal(
      formatScheduleClockRangeHms(23 * 60 + 59 + 20 / 60, 24 * 60 + 3),
      '23:59:20 - 00:03:00',
    );
  });

  it('wraps minute onto [0, 1440)', () => {
    assert.equal(wrapScheduleMinute(1440), 0);
    assert.equal(wrapScheduleMinute(1443.5), 3.5);
  });

  it('detects midnight passenger vs morning yard via day-cycle copies', () => {
    const clear = earliestStartPastBlockerOnDayCycle(
      24 * 60,
      24 * 60 + 3 + 40 / 60,
      0,
      6 * 60,
    );
    assert.ok(clear != null);
    assert.equal(clear, 24 * 60 + 6 * 60);
  });

  it('splits overnight bars into a day-tail piece and a day-head piece, keeps full clock label', () => {
    const start = 23 * 60 + 58 + 10 / 60;
    const end = 24 * 60 + 4 + 10 / 60;
    assert.equal(
      formatScheduleClockRangeHms(start, end),
      '23:58:10 - 00:04:10',
    );
    const segs = splitIntoDayCycleSegments(start, end);
    assert.equal(segs.length, 2, '跨夜要頭尾各一張，不是整張搬到日頭');
    // 日尾：23:58:10 → 24:00:00
    assert.ok(Math.abs(segs[0]!.startMinute - start) < 1e-6);
    assert.equal(segs[0]!.endMinute, 24 * 60);
    // 日頭：00:00:00 → 00:04:10
    assert.equal(segs[1]!.startMinute, 0);
    assert.ok(Math.abs(segs[1]!.endMinute - (4 + 10 / 60)) < 1e-6);
  });

  it('ends exactly at midnight: only the day-tail piece, no zero-width head piece', () => {
    const segs = splitIntoDayCycleSegments(23 * 60 + 50, 24 * 60);
    assert.equal(segs.length, 1);
    assert.equal(segs[0]!.startMinute, 23 * 60 + 50);
    assert.equal(segs[0]!.endMinute, 24 * 60);
  });

  it('maps post-midnight-only trips onto morning clock face', () => {
    const segs = splitIntoDayCycleSegments(
      24 * 60 + 3 + 10 / 60,
      24 * 60 + 6 + 40 / 60,
    );
    assert.equal(segs.length, 1);
    assert.ok(Math.abs(segs[0]!.startMinute - (3 + 10 / 60)) < 1e-6);
    assert.ok(Math.abs(segs[0]!.endMinute - (6 + 40 / 60)) < 1e-6);
  });

  it('keeps same-day bars in place', () => {
    const segs = splitIntoDayCycleSegments(23 * 60 + 55, 23 * 60 + 58);
    assert.equal(segs.length, 1);
    assert.equal(segs[0]!.startMinute, 23 * 60 + 55);
    assert.equal(segs[0]!.endMinute, 23 * 60 + 58);
  });
});
