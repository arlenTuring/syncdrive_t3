import { describe, expect, it } from 'vitest';
import {
  emptyShiftRouteRelationGraph,
  pruneRouteRelationLinksByJunction,
} from './routeRelationGraph';
import {
  emptyShiftRouteThroughAnchorsDraft,
  invalidateThroughAnchorsForRouteChange,
} from './routeRelationThroughCycles';

/** 0913 換圖後的實際資料：同一個 instanceId 指到別條路線，12 條關聯只有 4 條接得起來 */
const ROUTES_0913 = [
  ['p-route_1-0', 'n2w_d_start', 't3_d'],
  ['sel-80753f39', 't3_d', 's2w_u_start'],
  ['p-route_2-1', 't3_d', 's2w_d_start'],
  ['sel-04082fe0', 'n2w_u_start', 't3_d'],
  ['sel-3e1bd771', 's2w_d_start', 't3_u'],
  ['sel-f922818d', 't3_u', 'n2w_d_start'],
  ['sel-40d0be6e', 't3_u', 'n2w_u_start'],
  ['sel-d0a02c2f', 's2w_u_start', 't3_u'],
] as const;

const LINKS = [
  ['p-route_1-0', 'p-route_2-1'], ['p-route_1-0', 'sel-80753f39'],
  ['sel-40d0be6e', 'p-route_2-1'], ['sel-40d0be6e', 'sel-80753f39'],
  ['sel-04082fe0', 'sel-3e1bd771'], ['sel-04082fe0', 'sel-f922818d'],
  ['sel-d0a02c2f', 'sel-3e1bd771'], ['sel-d0a02c2f', 'sel-f922818d'],
  ['sel-3e1bd771', 'p-route_1-0'], ['sel-f922818d', 'sel-40d0be6e'],
  ['p-route_2-1', 'sel-04082fe0'], ['sel-80753f39', 'sel-d0a02c2f'],
] as const;

const routes = ROUTES_0913.map(([instanceId, first, last]) => ({
  instanceId,
  routeId: instanceId,
  stationIds: [first, last],
  stationDwells: [],
  avgTravelTimeSeconds: 600,
  minTravelTimeSeconds: 500,
}));

const graph = {
  ...emptyShiftRouteRelationGraph(),
  nodes: routes.map((r, i) => ({ instanceId: r.instanceId, x: i * 10, y: 0 })),
  links: LINKS.map(([from, to]) => ({
    id: `rel:${from}->${to}`,
    fromInstanceId: from,
    toInstanceId: to,
  })),
};

describe('換圖後的自動失效', () => {
  it('接不起來的關聯全部剪掉，只留真的接得上的', () => {
    const { graph: next, removed } = pruneRouteRelationLinksByJunction(graph, routes);
    expect(removed).toBe(8);
    expect(next.links).toHaveLength(4);
    for (const link of next.links) {
      const from = routes.find((r) => r.instanceId === link.fromInstanceId)!;
      const to = routes.find((r) => r.instanceId === link.toInstanceId)!;
      expect(from.stationIds[1]).toBe(to.stationIds[0]);
    }
  });

  it('路線身分變了就清掉起算結算與上次驗算', () => {
    const anchors = {
      ...emptyShiftRouteThroughAnchorsDraft(),
      startInstanceIds: ['p-route_1-0', 'sel-40d0be6e'],
      endInstanceIds: ['sel-f922818d', 'sel-3e1bd771'],
      verifiedFingerprint: 'stale',
      verifiedPathCount: 8,
      preferredThroughCycleId: 'stale-cycle',
    };
    const changed = new Set(['sel-04082fe0', 'sel-3e1bd771', 'sel-f922818d', 'sel-40d0be6e']);
    const out = invalidateThroughAnchorsForRouteChange(anchors, changed);
    expect(out.changed).toBe(true);
    expect(out.anchors.startInstanceIds).toEqual(['p-route_1-0']);
    expect(out.anchors.endInstanceIds).toEqual([]);
    expect(out.anchors.verifiedFingerprint).toBeNull();
    expect(out.anchors.preferredThroughCycleId).toBeNull();
    expect(out.anchors.verifiedPathCount).toBe(0);
  });

  it('沒有路線變動就一字不改', () => {
    const anchors = {
      ...emptyShiftRouteThroughAnchorsDraft(),
      startInstanceIds: ['p-route_1-0'],
      verifiedFingerprint: 'ok',
      verifiedPathCount: 8,
    };
    const out = invalidateThroughAnchorsForRouteChange(anchors, new Set());
    expect(out.changed).toBe(false);
    expect(out.anchors).toBe(anchors);
  });
});
