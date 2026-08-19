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
 * <strong>設施節點只能當終點，不能當通道。</strong>充電樁、維修坑不是走廊——
 * 車不會為了到對面月台而穿過充電樁。這條規則在拓樸上開了「站 → 設施」的邊之後
 * 才顯出重要性：2026-08-19 使用者把 T3上行 → H1–H3／M1–M4 開通，本意是讓車進得了
 * 廠，結果引擎把它當一般可通行節點，於是 <code>T3上行 → T3下行</code> 從繞一圈的
 * 340 秒變成穿過 M4 的 60 秒——等於在廠區裡開了一條上下行捷徑。車開始穿機廠切換
 * 方向，原本乾淨的 T3下行 被灌爆（站位碰撞 0 → 22 對），全域硬錯誤 0 → 4、
 * 班次 1096 → 972。擋掉「穿過」之後，進廠照樣是 30 秒，捷徑則不存在。
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

/**
 * 單一邊的行駛秒數（均或快，缺就退回另一個，都缺算 0）。
 * 對外開放——需要把一條完整路徑拆成兩段分別計時時（例如整備間轉場卡
 * 拆成「出廠卡＋入廠卡」）要用同一套 fallback 規則，不能自己另外猜。
 */
export function edgeSeconds(
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
  /** 設施節點：可以是起點（出廠）或終點（入廠），但不可以被路過 */
  const facilityNodeIds = new Set<string>();
  for (const node of topology.nodes) {
    if (node.kind === 'facility') facilityNodeIds.add(node.id);
  }

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
      // 設施是目的地不是走廊：不得穿過設施節點去別的地方
      if (nextId !== toNodeId && facilityNodeIds.has(nextId)) continue;
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
