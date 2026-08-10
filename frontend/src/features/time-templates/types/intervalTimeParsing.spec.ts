import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  intervalDurationTableLabel,
  isValidIntervalRange,
  resolveIntervalMinuteRanges,
  parseIntervalEndMinutes,
  parseIntervalStartMinutes,
  SCHEDULE_DAY_MINUTES,
} from './editor';

describe('interval time parsing', () => {
  it('treats 00:00 as end-of-day for interval end', () => {
    assert.equal(parseIntervalEndMinutes('00:00'), SCHEDULE_DAY_MINUTES);
    assert.equal(parseIntervalEndMinutes('00:00:00'), SCHEDULE_DAY_MINUTES);
    assert.equal(parseIntervalEndMinutes('24:00'), SCHEDULE_DAY_MINUTES);
  });

  it('treats 00:00 as day start for interval start', () => {
    assert.equal(parseIntervalStartMinutes('00:00'), 0);
    assert.equal(parseIntervalStartMinutes('24:00'), null);
  });

  it('validates 22:00–00:00 as a 2-hour range', () => {
    assert.equal(isValidIntervalRange('22:00', '00:00'), true);
    assert.equal(intervalDurationTableLabel('22:00', '00:00'), '2小時');
  });

  it('資料層已經把跨午夜切成兩段', () => {
    assert.deepEqual(resolveIntervalMinuteRanges('23:00', '01:00'), [
      { start: 23 * 60, end: 24 * 60 },
      { start: 0, end: 60 },
    ]);
    // 22:00–21:00 就是「22:00 跑到隔天 21:00」，共 23 小時
    assert.equal(intervalDurationTableLabel('22:00', '21:00'), '23小時');
  });

  it('開始等於結束＝整整一天（零長度的時段沒有意義）', () => {
    assert.deepEqual(resolveIntervalMinuteRanges('08:00', '08:00'), [
      { start: 0, end: 24 * 60 },
    ]);
    assert.equal(intervalDurationTableLabel('08:00', '08:00'), '24小時');
  });

  it('跨午夜是合法的；解析不出來的時刻才是非法', () => {
    assert.equal(isValidIntervalRange('22:00', '21:00'), true);
    assert.equal(isValidIntervalRange('23:00', '01:00'), true);
    assert.equal(isValidIntervalRange('08:00', '08:00'), true);
    assert.equal(isValidIntervalRange('22:00', '00:00'), true);
    assert.equal(isValidIntervalRange('', '08:00'), false);
    assert.equal(isValidIntervalRange('25:00', '08:00'), false);
  });
});
