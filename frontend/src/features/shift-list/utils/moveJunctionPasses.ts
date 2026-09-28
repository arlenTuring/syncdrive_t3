import type { PointTopology } from '../../map-editor/types/pointTopology';
import { edgeHasTravelTime, edgeSeconds } from './findTopologyPath';
import type { GeneratedScheduleTimeline } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';

/**
 * 移動卡經過的轉折點
 * ================
 *
 * 移動卡（出入廠、讓站、轉場）是車真的開在路網上，途中每一個中途節點同一時刻
 * 只能有一台車經過；不同列車經過同一點至少要差開 2 × 碰撞保護時間，跟
 * insertMaintenanceTransferCards 排卡時用的轉折點規則同一個數字。
 *
 * 這裡從班表<strong>事後重建</strong>每張移動卡經過中途節點的時刻：卡片記了途經節點
 * （<code>yardMoveViaLabels</code>），沿拓樸邊的平均行駛秒數從卡片開始時刻往下累加。
 * 零長度的示意卡（同區域 0 秒轉移）沒有實際路徑，不參與。
 */
export type MoveJunctionPass = {
  nodeId: string;
  nodeLabel: string;
  /** 經過的時刻（秒，跟卡片同一個時間軸） */
  instant: number;
  timelineRow: number;
  blockId: string;
};

const DAY_SECONDS = 24 * 60 * 60;

function cyclicGapSeconds(a: number, b: number): number {
  const raw = Math.abs(a - b) % DAY_SECONDS;
  return Math.min(raw, DAY_SECONDS - raw);
}

/** 移動卡路徑上無法算出經過時刻的地方 */
export type MoveJunctionGap = {
  blockId: string;
  timelineRow: number;
  fromLabel: string;
  toLabel: string;
  /** missing-time：這段邊沒有行駛時間；no-edge：兩點之間沒有邊；unknown／ambiguous-node：名稱對不到唯一節點 */
  reason: 'missing-time' | 'no-edge' | 'unknown-node' | 'ambiguous-node';
};

export function collectMoveJunctionPasses(
  timelines: GeneratedScheduleTimeline[],
  topology: PointTopology | null | undefined,
  /**
   * 移動卡經過的某一段沒有行駛時間：經過時刻算不出來，轉折點碰撞也就無從檢查。
   * 不能當 0 秒略過——呼叫端（最終驗證）要把它當成缺資料擋下。
   */
  onMissingTravelTime?: (gap: MoveJunctionGap) => void,
): MoveJunctionPass[] {
  if (!topology) return [];
  const nodeIdByLabel = new Map<string, string>();
  // 同一個名稱對到兩個節點：路徑對不回路網，不能挑第一個將就
  const ambiguousLabels = new Set<string>();
  for (const node of topology.nodes) {
    const label = (node.label ?? '').trim();
    if (!label) continue;
    if (nodeIdByLabel.has(label)) ambiguousLabels.add(label);
    else nodeIdByLabel.set(label, node.id);
  }
  const edgeByPair = new Map<string, (typeof topology.edges)[number]>();
  for (const edge of topology.edges) {
    edgeByPair.set(`${edge.fromNodeId}>${edge.toNodeId}`, edge);
    if (!edgeByPair.has(`${edge.toNodeId}>${edge.fromNodeId}`)) {
      edgeByPair.set(`${edge.toNodeId}>${edge.fromNodeId}`, edge);
    }
  }

  const passes: MoveJunctionPass[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'dispatch') continue;
      if (block.plannedEndMinute - block.plannedStartMinute <= 1e-9) continue;
      const labels = block.yardMoveViaLabels ?? [];
      if (labels.length < 3) continue;
      const ids = labels.map((label) =>
        ambiguousLabels.has(label.trim()) ? null : nodeIdByLabel.get(label.trim()) ?? null);
      // 經過的點對不回路網：經過時刻算不出來，跟缺行駛時間一樣要回報，不能整張略過
      const unresolved = ids.findIndex((id) => id == null);
      if (unresolved >= 0) {
        onMissingTravelTime?.({
          blockId: block.id,
          timelineRow: timeline.row,
          fromLabel: labels[unresolved]!,
          toLabel: labels[unresolved]!,
          reason: ambiguousLabels.has(labels[unresolved]!.trim()) ? 'ambiguous-node' : 'unknown-node',
        });
        continue;
      }
      let instant = minuteToSecond(block.plannedStartMinute);
      for (let index = 1; index < ids.length; index += 1) {
        const edge = edgeByPair.get(`${ids[index - 1]}>${ids[index]}`);
        if (!edge || !edgeHasTravelTime(edge)) {
          onMissingTravelTime?.({
            blockId: block.id,
            timelineRow: timeline.row,
            fromLabel: labels[index - 1]!,
            toLabel: labels[index]!,
            reason: edge ? 'missing-time' : 'no-edge',
          });
          break;
        }
        instant += edgeSeconds(edge, 'avg');
        if (index === ids.length - 1) break;
        passes.push({
          nodeId: ids[index]!,
          nodeLabel: labels[index]!,
          instant,
          timelineRow: timeline.row,
          blockId: block.id,
        });
      }
    }
  }
  return passes;
}

/** 這幾張卡的中途節點，有沒有跟別列車的經過時刻貼得太近 */
export function findJunctionConflictsForBlocks(
  passes: MoveJunctionPass[],
  blockIds: ReadonlySet<string>,
  bufferSeconds: number,
): Array<{ mine: MoveJunctionPass; other: MoveJunctionPass; gapSeconds: number }> {
  if (bufferSeconds <= 0) return [];
  const out: Array<{ mine: MoveJunctionPass; other: MoveJunctionPass; gapSeconds: number }> = [];
  for (const mine of passes) {
    if (!blockIds.has(mine.blockId)) continue;
    for (const other of passes) {
      if (other.timelineRow === mine.timelineRow) continue;
      if (other.nodeId !== mine.nodeId) continue;
      const gapSeconds = cyclicGapSeconds(mine.instant, other.instant);
      if (gapSeconds < bufferSeconds - 1e-9) out.push({ mine, other, gapSeconds });
    }
  }
  return out;
}
