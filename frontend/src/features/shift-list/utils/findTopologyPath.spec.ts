import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import {
  explainTopologyPathGap,
  findTopologyPath,
  listTopologyTravelTimeGaps,
  missingTravelTimeEdgesBetween,
} from './findTopologyPath';

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

  it('拓樸缺行駛時間的邊不能當 0 秒走：找不到路徑，並說出缺哪一段', () => {
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
    assert.equal(findTopologyPath(topology, 'A', 'B'), null);
    assert.match(explainTopologyPathGap(topology, 'A', 'B') ?? '', /A.*B/);
    // 使用者明確填 0 秒是資料，不是缺資料
    const zero: PointTopology = {
      ...topology,
      edges: [{ ...topology.edges[0]!, minTravelTimeSeconds: 0, avgTravelTimeSeconds: 0 }],
    };
    assert.equal(findTopologyPath(zero, 'A', 'B')?.avgSeconds, 0);
  });

  it('資料檢查：缺時間與明確填 0 秒分開列；有資料完整的替代路徑就不算缺', () => {
    const topology: PointTopology = {
      ...emptyPointTopology(),
      nodes: [node('A'), node('B'), node('C')],
      edges: [
        { ...edge('A', 'B', 0, 0), minTravelTimeSeconds: null, avgTravelTimeSeconds: null },
        edge('B', 'C', 0, 0),
        edge('A', 'C', 20, 20),
      ],
    };
    const gaps = listTopologyTravelTimeGaps(topology);
    assert.deepEqual(gaps.missing.map((item) => [item.fromLabel, item.toLabel]), [['A', 'B']]);
    assert.deepEqual(gaps.explicitZero.map((item) => [item.fromLabel, item.toLabel]), [['B', 'C']]);
    // A→B 只有那一段：缺的是它
    assert.deepEqual(missingTravelTimeEdgesBetween(topology, 'A', 'B')?.map((item) => item.toLabel), ['B']);
    // A→C 有完整的直達邊：不缺
    assert.equal(missingTravelTimeEdgesBetween(topology, 'A', 'C'), null);
  });
});

describe('不設固定段數上限（白皮書 ROUTE-03）', () => {
  // 設施 → 12 段轉折 → 站；名稱只是測試資料
  const hops = 12;
  const chainIds = ['fac', ...Array.from({ length: hops - 1 }, (_, i) => `w${i}`), 'st'];
  const chain: PointTopology = {
    ...emptyPointTopology(),
    nodes: chainIds.map((id) => node(id, id === 'fac' ? 'facility' : 'docking')),
    edges: chainIds.slice(0, -1).map((id, i) => edge(id, chainIds[i + 1]!, 10, 10)),
  };

  it('合法路徑超過 8 段也找得到', () => {
    const path = findTopologyPath(chain, 'fac', 'st');
    assert.ok(path, '12 段的合法路徑應該被找到');
    assert.equal(path!.edges.length, hops);
    assert.equal(path!.avgSeconds, 120);
  });

  it('方向仍然嚴格：反方向沒有路', () => {
    assert.equal(findTopologyPath(chain, 'st', 'fac'), null);
  });

  it('呼叫端明確給的段數上限仍然有效', () => {
    assert.equal(findTopologyPath(chain, 'fac', 'st', { maxHops: 3 }), null);
  });

  it('設施不能當中途通道', () => {
    const through: PointTopology = {
      ...emptyPointTopology(),
      nodes: [node('a'), node('mid', 'facility'), node('b')],
      edges: [edge('a', 'mid', 10, 10), edge('mid', 'b', 10, 10)],
    };
    assert.equal(findTopologyPath(through, 'a', 'b'), null);
    assert.ok(findTopologyPath(through, 'a', 'mid'), '設施當目的地可以');
  });
});
