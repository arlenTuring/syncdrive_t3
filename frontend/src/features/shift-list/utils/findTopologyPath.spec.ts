import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { findTopologyPath } from './findTopologyPath';

function node(id: string, kind: 'facility' | 'docking' = 'docking') {
  return { id, kind, label: id, x: 0, y: 0, color: '#111111' } as const;
}

function edge(from: string, to: string, min: number, avg: number) {
  return {
    id: `e:${from}->${to}`,
    fromNodeId: from,
    toNodeId: to,
    minTravelTimeSeconds: min,
    avgTravelTimeSeconds: avg,
    distanceMeters: null,
  };
}

/**
 * 仿真實場域的方向性：
 *   出場 M → T3上行、E → N2W
 *   入場 T3下行 → M、N2W → E
 * 所以 E → M 走得通（E→N2W→T3下→M），但 M → E 不能原路折返。
 */
function fixture(): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      node('E1', 'facility'),
      node('M1', 'facility'),
      node('N2W'),
      node('T3down'),
      node('T3up'),
    ],
    edges: [
      edge('E1', 'N2W', 30, 30),
      edge('N2W', 'E1', 30, 30),
      edge('N2W', 'T3down', 140, 170),
      edge('T3down', 'M1', 30, 30),
      edge('M1', 'T3up', 30, 30),
    ],
  };
}

describe('findTopologyPath', () => {
  it('找得出「充電做完去保養」的路徑，時間逐段加總', () => {
    const path = findTopologyPath(fixture(), 'E1', 'M1');
    assert.ok(path);
    assert.deepEqual(path.nodeIds, ['E1', 'N2W', 'T3down', 'M1']);
    assert.equal(path.avgSeconds, 230); // 30 + 170 + 30
    assert.equal(path.minSeconds, 200); // 30 + 140 + 30
  });

  it('方向嚴格遵守拓樸：沒有反向邊就不會自己折返', () => {
    // M1 只有 M1→T3up，T3up 是死路，回不到 E1
    assert.equal(findTopologyPath(fixture(), 'M1', 'E1'), null);
  });

  it('起點等於終點時回傳零長度路徑，不是 null', () => {
    const path = findTopologyPath(fixture(), 'E1', 'E1');
    assert.deepEqual(path?.nodeIds, ['E1']);
    assert.equal(path?.avgSeconds, 0);
    assert.equal(path?.edges.length, 0);
  });

  it('取最短：有兩條路時走總時間小的那條', () => {
    const topology = fixture();
    topology.nodes.push(node('SHORT'));
    topology.edges.push(edge('E1', 'SHORT', 10, 10));
    topology.edges.push(edge('SHORT', 'M1', 10, 10));
    const path = findTopologyPath(topology, 'E1', 'M1');
    assert.deepEqual(path?.nodeIds, ['E1', 'SHORT', 'M1']);
    assert.equal(path?.avgSeconds, 20);
  });

  it('可以擋掉被佔用的中途節點，改繞別條', () => {
    const topology = fixture();
    topology.nodes.push(node('ALT'));
    topology.edges.push(edge('N2W', 'ALT', 200, 200));
    topology.edges.push(edge('ALT', 'M1', 30, 30));

    const blocked = findTopologyPath(topology, 'E1', 'M1', {
      blockedNodeIds: new Set(['T3down']),
    });
    assert.deepEqual(blocked?.nodeIds, ['E1', 'N2W', 'ALT', 'M1']);
  });

  it('終點就算在擋用名單裡也到得了——擋的是路過，不是目的地', () => {
    const path = findTopologyPath(fixture(), 'E1', 'M1', {
      blockedNodeIds: new Set(['M1']),
    });
    assert.deepEqual(path?.nodeIds, ['E1', 'N2W', 'T3down', 'M1']);
  });

  it('超過段數上限就當作找不到', () => {
    assert.equal(
      findTopologyPath(fixture(), 'E1', 'M1', { maxHops: 2 }),
      null,
    );
  });

  it('拓樸缺行駛時間時仍可通行，只是該段算 0 秒', () => {
    const topology: PointTopology = {
      ...emptyPointTopology(),
      nodes: [node('A'), node('B')],
      edges: [
        {
          id: 'e:A->B',
          fromNodeId: 'A',
          toNodeId: 'B',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: null,
          distanceMeters: null,
        },
      ],
    };
    const path = findTopologyPath(topology, 'A', 'B');
    assert.deepEqual(path?.nodeIds, ['A', 'B']);
    assert.equal(path?.avgSeconds, 0);
  });
});
