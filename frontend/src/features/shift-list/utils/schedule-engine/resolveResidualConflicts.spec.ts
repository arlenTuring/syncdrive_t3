import assert from 'node:assert/strict';
import { it } from 'node:test';
import { rerouteBerthPairInCopy, shiftTripInCopy } from './resolveResidualConflicts';
import type { PlanEvaluationContext } from './evaluatePlan';
import type { GeneratedScheduleBlock } from './types';
import type { ShiftScheduleSelectedRoute } from '../../types/create';

const route = { routeId: 'ab', stationIds: ['a', 'b'], minTravelTimeSeconds: 60,
  avgTravelTimeSeconds: 120, dwellSlackSeconds: 0, switchBufferAfterSeconds: 0,
  stationDwells: [{ stationId: 'a', dwellSeconds: 0 }, { stationId: 'b', dwellSeconds: 0 }],
} as ShiftScheduleSelectedRoute;
const ctx: PlanEvaluationContext = { selectedRoutes: [route], routeById: new Map([['ab', route]]),
  passengerRoutes: [route], minimumRecoveryTimeSeconds: 0, collisionProtectionSeconds: 30,
  intervals: [], attributes: [], scheduleRowCount: 1 };
function block(id: string, start: number, end: number, taskType: GeneratedScheduleBlock['taskType'],
  source: GeneratedScheduleBlock['source'] = 'template_bar'): GeneratedScheduleBlock {
  return { id, timelineRow: 1, label: id, taskType, source, routeId: taskType === 'passenger' ? 'ab' : undefined,
    plannedStartMinute: start, plannedEndMinute: end, anchorStartMinute: start,
    travelSeconds: taskType === 'standby' ? 0 : (end - start) * 60, dwellSeconds: 0 };
}

it('首班延後時出廠卡同步延後，固定待命時間及原始輸入不變', () => {
  const plan = [{ row: 1, blocks: [block('wait', 0, 5, 'standby'),
    block('exit', 5, 6, 'dispatch', 'yard_exit_move'), block('trip', 6, 8, 'passenger')] }];
  const before = structuredClone(plan);
  const moved = shiftTripInCopy(plan, 'trip', 1, 1, ctx, '測試')!;
  assert.deepEqual(moved.timelines[0]!.blocks.map((b) => [b.id, b.plannedStartMinute, b.plannedEndMinute]),
    [['wait', 0, 5], ['exit', 6, 7], ['trip', 7, 9]]);
  assert.deepEqual(plan, before);
  assert.equal(shiftTripInCopy(plan, 'trip', -1, -1, ctx, '測試'), null);
});

it('提早班次可使用前一班的合法行駛餘裕，不修改基本停靠設定', () => {
  const plan = [{ row: 1, blocks: [block('first', 6, 8, 'passenger'), block('second', 8, 10, 'passenger')] }];
  const moved = shiftTripInCopy(plan, 'second', -1, -1, ctx, '測試')!;
  assert.deepEqual(moved.timelines[0]!.blocks.map((b) => [b.plannedStartMinute, b.plannedEndMinute]), [[6, 7], [7, 9]]);
  assert.equal(route.stationDwells![1]!.dwellSeconds, 0);
});

it('入廠卡可在既有空檔內聯動，但不能擠進固定整備時間', () => {
  const plan = [{ row: 1, blocks: [block('trip', 6, 8, 'passenger'),
    block('entry', 8, 9, 'dispatch', 'yard_entry_move'), block('wait', 10, 20, 'standby')] }];
  const moved = shiftTripInCopy(plan, 'trip', 1, 1, ctx, '測試')!;
  assert.equal(moved.timelines[0]!.blocks.find((b) => b.id === 'entry')!.plannedEndMinute, 10);
  assert.equal(moved.timelines[0]!.blocks.find((b) => b.id === 'wait')!.plannedStartMinute, 10);
  assert.equal(shiftTripInCopy(plan, 'trip', 2, 2, ctx, '測試'), null);
});

it('停站換位：進站那一趟與下一班一起換到另一個停靠位（起訖、下游銜接都要在允許的關聯內）', () => {
  // 名稱只是測試資料：T→S（主）／T→S2（備用）進站，S→Y／S2→Y 出站
  const mk = (routeId: string, from: string, to: string) => ({
    ...route, routeId, instanceId: routeId, routeName: routeId, stationIds: [from, to],
    stationDwells: [{ stationId: from, dwellSeconds: 0 }, { stationId: to, dwellSeconds: 0 }],
  }) as ShiftScheduleSelectedRoute;
  const routes = [mk('p', 'X', 'T'), mk('in', 'T', 'S'), mk('in2', 'T', 'S2'), mk('out', 'S', 'Y'), mk('out2', 'S2', 'Y'), mk('n', 'Y', 'X')];
  const edges = (pairs: Array<[string, string]>) => {
    const map = new Map<string, string[]>();
    for (const [from, to] of pairs) map.set(from, [...(map.get(from) ?? []), to]);
    return map;
  };
  const policyWith = (pairs: Array<[string, string]>) => ({
    valid: true,
    routesByInstanceId: new Map(routes.map((item) => [item.routeId, item] as const)),
    prioritySuccessors: edges(pairs),
    secondarySuccessors: new Map<string, string[]>(),
  });
  const trip = (id: string, routeId: string, start: number) => ({
    ...block(id, start, start + 2, 'passenger'), routeId, routeInstanceId: routeId,
  });
  const plan = [{ row: 1, blocks: [trip('t1', 'p', 0), trip('t2', 'in', 2), trip('t3', 'out', 10), trip('t4', 'n', 12)] }];
  const context = (pairs: Array<[string, string]>) => ({
    ...ctx, selectedRoutes: routes, routeById: new Map(routes.map((item) => [item.routeId, item] as const)),
    passengerRoutes: routes, successorPolicy: policyWith(pairs),
  }) as unknown as PlanEvaluationContext;
  const full: Array<[string, string]> = [['p', 'in'], ['p', 'in2'], ['in', 'out'], ['in2', 'out2'], ['out', 'n'], ['out2', 'n']];
  const found = rerouteBerthPairInCopy(plan, 't2', context(full));
  assert.equal(found.length, 1);
  const blocks = found[0]!.timelines[0]!.blocks;
  assert.deepEqual(blocks.map((b) => [b.id, b.routeId, b.plannedStartMinute]),
    [['t1', 'p', 0], ['t2', 'in2', 2], ['t3', 'out2', 10], ['t4', 'n', 12]]);
  // 時刻不動、原始輸入不變
  assert.equal(plan[0]!.blocks[1]!.routeId, 'in');
  // 任何一段銜接不在允許的關聯內，就不能換
  for (const missing of [['p', 'in2'], ['in2', 'out2'], ['out2', 'n']]) {
    const pairs = full.filter(([from, to]) => !(from === missing[0] && to === missing[1]));
    assert.equal(rerouteBerthPairInCopy(plan, 't2', context(pairs)).length, 0, `少了 ${missing.join('→')} 仍然換了`);
  }
});
