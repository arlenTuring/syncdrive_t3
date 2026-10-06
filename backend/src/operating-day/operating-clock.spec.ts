import {
  applyClockUpdate,
  CLOCK_STALE_AFTER_MS,
  describeClock,
  operatingTimeAt,
  REALTIME_CLOCK,
} from './operating-clock';

const OP0 = new Date(2026, 9, 6, 6, 0, 0).getTime();
const R0 = 1_800_000_000_000;

describe('營運時鐘', () => {
  it('正式營運：營運時間就是實際時間', () => {
    expect(operatingTimeAt(REALTIME_CLOCK, R0)).toBe(R0);
  });

  it('180 倍：實際 1 秒＝營運 3 分鐘；暫停後不推進；繼續後接著推進', () => {
    let state = applyClockUpdate(REALTIME_CLOCK, { mode: 'replay', runId: 'r1', operatingNow: OP0, rate: 180 }, R0);
    expect(operatingTimeAt(state, R0 + 1_000, R0 + 1_000)).toBe(OP0 + 180_000);
    state = applyClockUpdate(state, { mode: 'replay', runId: 'r1', operatingNow: OP0 + 180_000, rate: 180, paused: true }, R0 + 1_000);
    expect(operatingTimeAt(state, R0 + 5_000, R0 + 5_000)).toBe(OP0 + 180_000);
    state = applyClockUpdate(state, { mode: 'replay', runId: 'r1', operatingNow: OP0 + 180_000, rate: 180 }, R0 + 6_000);
    expect(operatingTimeAt(state, R0 + 7_000, R0 + 7_000)).toBe(OP0 + 360_000);
    // 過去的實際時刻照當時那一段換算
    expect(operatingTimeAt(state, R0 + 500, R0 + 7_000)).toBe(OP0 + 90_000);
  });

  it('只是心跳不切新段；跟推算差超過容許量（一秒營運或 250 毫秒實際 × 倍速）才切', () => {
    let state = applyClockUpdate(REALTIME_CLOCK, { mode: 'replay', runId: 'r1', operatingNow: OP0, rate: 60 }, R0);
    state = applyClockUpdate(state, { mode: 'replay', runId: 'r1', operatingNow: OP0 + 60_000, rate: 60 }, R0 + 1_000);
    expect(state.segments).toHaveLength(1);
    state = applyClockUpdate(state, { mode: 'replay', runId: 'r1', operatingNow: OP0 + 100_000, rate: 60 }, R0 + 1_000);
    expect(state.segments).toHaveLength(2);
  });

  it('執行端沒消息：標示中斷，營運時間不再往前跑', () => {
    const state = applyClockUpdate(REALTIME_CLOCK, { mode: 'replay', runId: 'r1', operatingNow: OP0, rate: 10 }, R0);
    const later = R0 + CLOCK_STALE_AFTER_MS + 60_000;
    expect(describeClock(state, later).stale).toBe(true);
    expect(operatingTimeAt(state, later, later)).toBe(OP0 + CLOCK_STALE_AFTER_MS * 10);
  });

  it('結束：停在結束那一刻；回到 realtime 就是實際時間', () => {
    let state = applyClockUpdate(REALTIME_CLOCK, { mode: 'replay', runId: 'r1', operatingNow: OP0, rate: 10 }, R0);
    state = applyClockUpdate(state, { mode: 'replay', runId: 'r1', operatingNow: OP0 + 10_000, rate: 10, ended: true }, R0 + 1_000);
    expect(operatingTimeAt(state, R0 + 60_000, R0 + 60_000)).toBe(OP0 + 10_000);
    expect(describeClock(state, R0 + 60_000)).toMatchObject({ stale: false, paused: true, ended: true });
    state = applyClockUpdate(state, { mode: 'realtime' }, R0 + 70_000);
    expect(operatingTimeAt(state, R0 + 70_000)).toBe(R0 + 70_000);
  });

  it('倍速超過上限或缺營運時刻就拒絕', () => {
    expect(() => applyClockUpdate(REALTIME_CLOCK, { mode: 'replay', runId: 'r', operatingNow: OP0, rate: 181 }, R0)).toThrow();
    expect(() => applyClockUpdate(REALTIME_CLOCK, { mode: 'replay', runId: 'r', rate: 10 }, R0)).toThrow();
  });
});
