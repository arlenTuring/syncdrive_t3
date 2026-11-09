import { describe, expect, it } from 'vitest';
import { moveSelectedRouteToIndex, type ShiftScheduleSelectedRoute } from './create';

const route = (id: string, executionOrder: number, backupFor?: string) =>
  ({ instanceId: id, routeId: id, routeName: id, executionOrder, backupForInstanceId: backupFor ?? null }) as unknown as ShiftScheduleSelectedRoute;

const order = (routes: ShiftScheduleSelectedRoute[]) =>
  routes.filter((item) => !item.backupForInstanceId).sort((a, b) => a.executionOrder - b.executionOrder).map((item) => item.instanceId);

describe('拖拉排序 moveSelectedRouteToIndex', () => {
  const routes = [route('A', 1), route('B', 2), route('C', 3), route('D', 4)];

  it('往後拖：其餘依原相對順序', () => {
    expect(order(moveSelectedRouteToIndex(routes, 'A', 2))).toEqual(['B', 'C', 'A', 'D']);
  });

  it('往前拖到最前面成為第 1 條', () => {
    expect(order(moveSelectedRouteToIndex(routes, 'D', 0))).toEqual(['D', 'A', 'B', 'C']);
  });

  it('超出範圍時夾到頭尾；原地不動時不改', () => {
    expect(order(moveSelectedRouteToIndex(routes, 'B', 99))).toEqual(['A', 'C', 'D', 'B']);
    expect(moveSelectedRouteToIndex(routes, 'B', 1)).toBe(routes);
  });

  it('找不到路線時原樣回傳', () => {
    expect(moveSelectedRouteToIndex(routes, 'Z', 0)).toBe(routes);
  });
});
