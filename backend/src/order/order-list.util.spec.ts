import { OrderStatus } from '../database/entities/operation-order.entity';
import {
  buildRouteLabel,
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

  it('depart falls back to trip code schedule', () => {
    const depart = resolveDepartTime({
      ...baseOrder,
      tripCode: 'D1133',
      plannedStart: undefined,
    } as never);
    expect(depart).toBe('11:33:00');
  });
});
