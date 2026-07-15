import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  intervalDurationTableLabel,
  isValidIntervalRange,
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

  it('rejects end before or equal to start', () => {
    assert.equal(isValidIntervalRange('22:00', '21:00'), false);
    assert.equal(isValidIntervalRange('08:00', '08:00'), false);
  });
});
