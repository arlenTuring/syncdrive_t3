import { OrderRouteService, type TaskGroupItem } from './order-route.service';
import { OrderActionState } from '../database/entities/order-action-state.entity';
import { RouteActionStatus } from '../database/entities/operation-route-station-action.entity';

/** order_action_states 的記憶體替身：只實作 applyTaskGroupUpdate 用到的 find／create／save */
function memoryRepo(initial: Partial<OrderActionState>[] = []) {
  const table = new Map<string, OrderActionState>();
  for (const row of initial) table.set(row.id!, Object.assign(new OrderActionState(), row));
  const saves: string[] = [];
  return {
    table,
    saves,
    find: jest.fn(async ({ where }: { where: { orderId: string } }) =>
      [...table.values()].filter((r) => r.orderId === where.orderId).map((r) => Object.assign(new OrderActionState(), r))),
    create: jest.fn((data: Partial<OrderActionState>) => Object.assign(new OrderActionState(), data)),
    save: jest.fn(async (row: OrderActionState) => {
      saves.push(row.id);
      table.set(row.id, Object.assign(new OrderActionState(), row));
      return row;
    }),
  };
}

function service(repo: ReturnType<typeof memoryRepo>) {
  return new OrderRouteService({} as never, {} as never, {} as never, repo as never);
}

const task = (id: string, name: string, station: string, status: string, start: number | null = null, end: number | null = null): TaskGroupItem => ({
  task_id: id,
  task_name: name,
  task_params: { node_id: station, station_id: station },
  status,
  actual_start_time: start,
  actual_end_time: end,
});

describe('OrderRouteService.applyTaskGroupUpdate', () => {
  it('調度引擎的單沒有預建動作列：車端回報的動作直接新增，各站分開（2026-11-23 TNB1329）', async () => {
    const repo = memoryRepo();
    await service(repo).applyTaskGroupUpdate('261123-TNB1329', [
      task('261123-TNB1329_t3_u_STATION_DEPARTURE', 'STATION_DEPARTURE', 't3_u', 'COMPLETED', 1000, 4000),
      task('261123-TNB1329_n2w_u_PLATFORM_DOCKING', 'PLATFORM_DOCKING', 'n2w_u', 'IN_PROGRESS', 150000),
      task('261123-TNB1329_n2w_u_OPEN_DOORS', 'OPEN_DOORS', 'n2w_u', 'PENDING'),
    ]);
    const rows = [...repo.table.values()];
    expect(rows.map((r) => [r.stationId, r.actionType, r.actionStatus])).toEqual([
      ['t3_u', 'STATION_DEPARTURE', RouteActionStatus.COMPLETED],
      ['n2w_u', 'PLATFORM_DOCKING', RouteActionStatus.IN_PROGRESS],
      ['n2w_u', 'OPEN_DOORS', RouteActionStatus.PENDING],
    ]);
    expect(rows[0].actualStartTime).toBe('1000');
    expect(rows[0].actualEndTime).toBe('4000');
  });

  it('同一動作在第二站：不蓋掉第一站那一列', async () => {
    const repo = memoryRepo([
      { id: 'tpl-1', orderId: 'O1', stationId: 's2w_u', actionType: 'PLATFORM_DOCKING', actionStatus: RouteActionStatus.COMPLETED, actualStartTime: '10' },
    ]);
    await service(repo).applyTaskGroupUpdate('O1', [task('O1_t3_u_PLATFORM_DOCKING', 'PLATFORM_DOCKING', 't3_u', 'IN_PROGRESS', 50)]);
    expect(repo.table.get('tpl-1')!.actualStartTime).toBe('10');
    expect(repo.table.get('O1_t3_u_PLATFORM_DOCKING')!.stationId).toBe('t3_u');
  });

  it('已有模板列：照站與動作對上並更新，不另外新增', async () => {
    const repo = memoryRepo([
      { id: 'O2_tpl', orderId: 'O2', stationId: 't3_u', actionType: 'OPEN_DOORS', actionStatus: RouteActionStatus.PENDING },
    ]);
    await service(repo).applyTaskGroupUpdate('O2', [task('O2_t3_u_OPEN_DOORS', 'OPEN_DOORS', 't3_u', 'COMPLETED', 7, 7)]);
    expect([...repo.table.keys()]).toEqual(['O2_tpl']);
    expect(repo.table.get('O2_tpl')!.actionStatus).toBe(RouteActionStatus.COMPLETED);
  });

  it('每秒重送同樣內容不重寫；已完成的不被較舊的進行中改回去', async () => {
    const repo = memoryRepo();
    const svc = service(repo);
    const done = task('O3_a_CLOSE_DOORS', 'CLOSE_DOORS', 'a', 'COMPLETED', 5, 5);
    await svc.applyTaskGroupUpdate('O3', [done]);
    await svc.applyTaskGroupUpdate('O3', [done]);
    await svc.applyTaskGroupUpdate('O3', [{ ...done, status: 'IN_PROGRESS' }]);
    expect(repo.saves).toEqual(['O3_a_CLOSE_DOORS']);
    expect(repo.table.get('O3_a_CLOSE_DOORS')!.actionStatus).toBe(RouteActionStatus.COMPLETED);
  });
});
