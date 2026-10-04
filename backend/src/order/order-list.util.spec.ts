import { OrderStatus } from '../database/entities/operation-order.entity';
import {
  buildRouteLabel,
  matchesTab,
  resolveDepartTime,
  resolveEndTime,
  resolveExecutionStatus,
  toShiftRecordListItem,
} from './order-list.util';

describe('order-list.util', () => {
  const baseOrder = {
    id: '260624-U1030',
    tripCode: 'U1030',
    vehicleCode: 'PMS05',
    lineKind: 'MAINLINE',
    routeId: 'ROUTE-MAINLINE-UP',
    status: OrderStatus.PROCESSING,
    delayMinutes: 0,
    plannedStart: String(new Date('2026-06-24T10:30:00').getTime()),
    completedAt: null,
    payload: {},
  };

  it('maps running mainline status and route', () => {
    const item = toShiftRecordListItem(baseOrder as never);
    expect(item.execution_status).toBe('running');
    expect(item.execution_status_label).toBe('執行中');
    expect(item.route_label).toBe('S2W→T3→N2W');
    expect(item.depart_time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(item.end_time).toBeNull();
  });

  it('maps delayed processing', () => {
    const exec = resolveExecutionStatus({
      ...baseOrder,
      delayMinutes: 3,
    } as never);
    expect(exec.key).toBe('delayed');
    expect(exec.label).toBe('延誤中');
  });

  it('maps maintenance route', () => {
    const label = buildRouteLabel({
      ...baseOrder,
      lineKind: 'MAINTENANCE',
      tripCode: 'CHG-01',
      payload: { yard_slot_id: 'E3' },
    } as never);
    expect(label).toBe('S2W→E3');
  });

  it('shows TEST orders in the mainline monitor with their selected route name', () => {
    const order = {
      ...baseOrder,
      lineKind: 'TEST',
      tripCode: 'TEST-PMS99-1',
      payload: { route_name: 'N2W下行→T3下行' },
    } as never;
    expect(matchesTab(order, 'mainline')).toBe(true);
    expect(buildRouteLabel(order)).toBe('N2W下行→T3下行');
  });

  it('end time uses planned_end (shift duration), not completed_at wall clock', () => {
    const end = resolveEndTime({
      ...baseOrder,
      status: OrderStatus.END,
      plannedStart: String(new Date('2026-06-24T10:30:00').getTime()),
      plannedEnd: String(new Date('2026-06-24T10:36:00').getTime()),
      completedAt: String(new Date('2026-06-24T19:58:28').getTime()),
    } as never);
    expect(end).toBe('10:36:00');
    expect(resolveEndTime(baseOrder as never)).toBeNull();
  });

  it('沒有計畫發車時刻就是沒有，不從班次代號推', () => {
    for (const tripCode of ['D1133', 'NT1133', 'XYZ']) {
      expect(resolveDepartTime({ ...baseOrder, tripCode, plannedStart: undefined } as never)).toBeNull();
    }
  });

  it('同一筆任務換成任何班次代號，分頁、路線、時刻都一樣', () => {
    const results = ['D1234', 'NT0000', 'U9999', 'ANY-NAME'].map((tripCode) => {
      const order = { ...baseOrder, tripCode } as never;
      return {
        tab: matchesTab(order, 'mainline'),
        route: buildRouteLabel(order),
        depart: resolveDepartTime(order),
      };
    });
    for (const result of results) expect(result).toEqual(results[0]);
  });

  it('分類不明的單不靠 D/U 代號擠進正線分頁', () => {
    const order = { ...baseOrder, lineKind: null, tripCode: 'D1234', payload: {} } as never;
    expect(matchesTab(order, 'mainline')).toBe(false);
    expect(matchesTab(order, 'maintenance')).toBe(false);
  });

  it('路線看訂單記錄的路線；沒有路線也不看班次代號開頭', () => {
    expect(buildRouteLabel({ ...baseOrder, routeId: 'ROUTE-MAINLINE-DOWN', tripCode: 'U0830' } as never)).toBe('N2W→T3→S2W');
    expect(buildRouteLabel({ ...baseOrder, routeId: undefined, tripCode: 'U0830' } as never)).toBe('—');
  });
});

describe('resolveExecutionStatus：中心端取消', () => {
  it('取消後車端回報 FAULTED：標示已中止，不說故障', () => {
    const cancelled = resolveExecutionStatus({ status: 'FAULTED', payload: { cancel_requested_at: 1 } } as never);
    expect(cancelled.label).toBe('已中止（中心端取消）');
    expect(resolveExecutionStatus({ status: 'FAULTED', payload: {} } as never).label).toBe('故障');
  });
});
