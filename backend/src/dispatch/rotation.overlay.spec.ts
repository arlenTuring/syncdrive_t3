import type { PlannedDispatch } from './dispatch.plan';
import { applyRotationOverlay, fleetAfterRotations, type RotationOverlay } from './rotation.overlay';

const planned = (orderId: string, departAt: number) => ({ orderId, departAt }) as PlannedDispatch;
const overlay = (over: Partial<RotationOverlay> = {}): RotationOverlay => ({
  operatingDay: '2026-11-03',
  effectiveDay: '2026-11-04',
  outgoing: 'PMS01',
  incoming: 'PMS10',
  shunts: [planned('S1', 5)],
  cancelledOrderIds: ['B'],
  ...over,
});

describe('車輛輪替對計畫的影響', () => {
  const fleet = ['PMS01', 'PMS02', 'PMS10'];

  it('生效日之前車隊順序不變，換手當天也不變', () => {
    expect(fleetAfterRotations(fleet, [overlay()], '2026-11-03')).toEqual(fleet);
  });

  it('生效日起兩台車對調列，之後每天都維持', () => {
    expect(fleetAfterRotations(fleet, [overlay()], '2026-11-04')).toEqual(['PMS10', 'PMS02', 'PMS01']);
    expect(fleetAfterRotations(fleet, [overlay()], '2026-11-09')).toEqual(['PMS10', 'PMS02', 'PMS01']);
  });

  it('連續輪替依序累積', () => {
    const second = overlay({ operatingDay: '2026-11-04', effectiveDay: '2026-11-05', outgoing: 'PMS02', incoming: 'PMS01' });
    expect(fleetAfterRotations(fleet, [overlay(), second], '2026-11-05')).toEqual(['PMS10', 'PMS01', 'PMS02']);
  });

  it('車已不在車隊就跳過，不會一台車佔兩列', () => {
    const result = fleetAfterRotations(['PMS01', 'PMS02'], [overlay()], '2026-11-04');
    expect(result).toEqual(['PMS01', 'PMS02']);
    expect(new Set(result).size).toBe(result.length);
  });

  it('換手當天取消指定任務並加上調車，依時間排序', () => {
    const result = applyRotationOverlay([planned('A', 1), planned('B', 3), planned('C', 9)], [overlay()], '2026-11-03');
    expect(result.map((item) => item.orderId)).toEqual(['A', 'S1', 'C']);
  });

  it('生效日也會拿掉清單裡的任務，但不再加調車', () => {
    const result = applyRotationOverlay([planned('B', 3), planned('C', 9)], [overlay()], '2026-11-04');
    expect(result.map((item) => item.orderId)).toEqual(['C']);
  });

  it('別天的計畫不受影響', () => {
    const plan = [planned('B', 3)];
    expect(applyRotationOverlay(plan, [overlay()], '2026-11-05')).toEqual(plan);
  });
});
