import type {
  PointTopology,
  PointTopologyEdge,
} from '../../map-editor/types/pointTopology';
import { snapUpToClockAlignSeconds } from './schedule-engine/physics';

/**
 * 路網拓樸最短路徑
 * ================
 *
 * 為什麼要有這個：整備任務之間的移動（例「充電做完要去保養」）不可能要求
 * 使用者一條條畫出來——那是 N×M 條組合，而且換一張地圖就要重畫。
 * 拓樸上已經有<strong>有向邊與行駛時間</strong>，路徑本來就該由系統自己找。
 *
 * 走 Dijkstra，權重取「均」（沒有就退回「快」，再沒有算 0 但仍可通行——
 * 拓樸缺時間是資料問題，不該讓整條路徑變成不可達）。
 *
 * <strong>方向嚴格遵守拓樸</strong>：只走 fromNodeId → toNodeId 的邊。
 * 這很重要——例如 M 系設施「出場」接的是 T3上行、「入場」卻要從 T3下行進去，
 * 反過來走就是逆行。雙向是使用者在拓樸上明確補了反向邊才成立，
 * 不是搜尋時自己假設的。
 */

export type TopologyPath = {
  /** 依序經過的節點 id（含起點與終點） */
  nodeIds: string[];
  /** 依序經過的邊 */
  edges: PointTopologyEdge[];
  /** 全程最快秒數（各段取快，10 秒格向上） */
  minSeconds: number;
  /** 全程平均秒數（各段取均，10 秒格向上） */
  avgSeconds: number;
};

function edgeSeconds(
  edge: PointTopologyEdge,
  prefer: 'avg' | 'min',
): number {
  const avg = edge.avgTravelTimeSeconds;
  const min = edge.minTravelTimeSeconds;
  const primary = prefer === 'avg' ? avg : min;
  const fallback = prefer === 'avg' ? min : avg;
  if (typeof primary === 'number' && Number.isFinite(primary) && primary >= 0) {
    return primary;
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0) {
    return fallback;
  }
  return 0;
}

export function findTopologyPath(
  topology: PointTopology | null | undefined,
  fromNodeId: string,
  toNodeId: string,
  options?: {
    /** 不得經過的節點（例：已被別台車佔住的設施） */
    blockedNodeIds?: ReadonlySet<string>;
    /** 最多幾段；超過視為找不到（避免繞遠路繞到不合理） */
    maxHops?: number;
  },
): TopologyPath | null {
  if (!topology || !fromNodeId || !toNodeId) return null;
  if (fromNodeId === toNodeId) {
    return { nodeIds: [fromNodeId], edges: [], minSeconds: 0, avgSeconds: 0 };
  }

  const blocked = options?.blockedNodeIds;
  const maxHops = options?.maxHops ?? 8;

  const outgoing = new Map<string, PointTopologyEdge[]>();
  for (const edge of topology.edges) {
    // 方向嚴格：只加 from → to，不自動補反向
    const list = outgoing.get(edge.fromNodeId) ?? [];
    list.push(edge);
    outgoing.set(edge.fromNodeId, list);
  }

  type Entry = {
    nodeId: string;
    cost: number;
    hops: number;
    nodeIds: string[];
    edges: PointTopologyEdge[];
  };
  const best = new Map<string, number>([[fromNodeId, 0]]);
  // 節點數量是幾十的量級，用陣列取最小即可，不必上堆
  const queue: Entry[] = [
    { nodeId: fromNodeId, cost: 0, hops: 0, nodeIds: [fromNodeId], edges: [] },
  ];

  while (queue.length > 0) {
    let pickIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (queue[i]!.cost < queue[pickIndex]!.cost) pickIndex = i;
    }
    const current = queue.splice(pickIndex, 1)[0]!;
    if (current.nodeId === toNodeId) {
      let minTotal = 0;
      let avgTotal = 0;
      for (const edge of current.edges) {
        minTotal += edgeSeconds(edge, 'min');
        avgTotal += edgeSeconds(edge, 'avg');
      }
      return {
        nodeIds: current.nodeIds,
        edges: current.edges,
        minSeconds: snapUpToClockAlignSeconds(minTotal),
        avgSeconds: snapUpToClockAlignSeconds(avgTotal),
      };
    }
    if (current.hops >= maxHops) continue;
    if ((best.get(current.nodeId) ?? Infinity) < current.cost) continue;

    for (const edge of outgoing.get(current.nodeId) ?? []) {
      const nextId = edge.toNodeId;
      // 終點就算在 blocked 名單裡也要能到——擋的是「路過」，不是「目的地」
      if (blocked?.has(nextId) && nextId !== toNodeId) continue;
      if (current.nodeIds.includes(nextId)) continue;
      const nextCost = current.cost + edgeSeconds(edge, 'avg');
      if ((best.get(nextId) ?? Infinity) <= nextCost) continue;
      best.set(nextId, nextCost);
      queue.push({
        nodeId: nextId,
        cost: nextCost,
        hops: current.hops + 1,
        nodeIds: [...current.nodeIds, nextId],
        edges: [...current.edges, edge],
      });
    }
  }

  return null;
}
