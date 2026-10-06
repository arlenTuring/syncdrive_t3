import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clockAdvancing, operatingNowFrom, type OperatingClockSnapshot } from './operatingClock';

const base: OperatingClockSnapshot = {
  mode: 'replay', run_id: 'r', operating_day: '2026-10-06', operating_now: 1_000_000, real_now: 0,
  rate: 180, paused: false, ended: false, stale: false, lag_ms: 0,
};

describe('營運時鐘（畫面）', () => {
  it('重播中：兩次查詢之間照倍速往前推', () => {
    assert.equal(operatingNowFrom({ snapshot: base, receivedAt: 5_000, error: null }, 6_000), 1_000_000 + 180_000);
  });
  it('暫停、結束、執行端中斷：不推', () => {
    for (const patch of [{ paused: true }, { ended: true }, { stale: true }]) {
      const snapshot = { ...base, ...patch };
      assert.equal(clockAdvancing(snapshot), false);
      assert.equal(operatingNowFrom({ snapshot, receivedAt: 5_000, error: null }, 60_000), 1_000_000);
    }
  });
  it('正式營運或還沒查到：就是實際時間', () => {
    assert.equal(operatingNowFrom({ snapshot: { ...base, mode: 'realtime' }, receivedAt: 0, error: null }, 42), 42);
    assert.equal(operatingNowFrom({ snapshot: null, receivedAt: 0, error: null }, 42), 42);
  });
});
