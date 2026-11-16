import type { PointTopology } from '../../map-editor/types/pointTopology';
import { findTopologyPaths } from './findTopologyPath';
import { facilityAliases, moveOwnVisits } from './pathOccupancy';
import type { GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';

/**
 * 移動卡的訂單途經點
 * ================
 *
 * 訂單原本只給起訖兩點，路徑由車端自己規劃（車端介接說明書 §五：「路徑由車端依 §六 自行
 * 規劃」）。只要引擎排的是起訖之間<strong>唯一的最短路</strong>，車自己規劃也會走同一條，
 * 不必多帶東西。
 *
 * 兩種情況不一樣：
 * - 引擎改走替代路線（最短路在可用時間內排不開）；
 * - 有兩條以上一樣快的路。
 *
 * 這時車可能開去另一條，排班檢查過的路線跟實際開的不同。所以把這一段經過的點位寫進
 * {@link GeneratedScheduleBlock.yardMoveStops}，後端放進訂單 <code>stations[]</code>
 * （role＝intermediate；協議允許交叉軌道途經點），車端照站序規劃就會走同一條路。
 *
 * 只收拓樸上有 stationId（協議點位識別碼）的節點；入口途經點這類沒有識別碼的節點不送。
 * 每次都整批重算，舊值先清掉。
 */
export function annotateMoveStops(
  timelines: GeneratedSchedulePlan['timelines'],
  topology: PointTopology | null | undefined,
): void {
  if (!topology) return;
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const));
  const aliases = facilityAliases(timelines);
  const keyOf = (ids: readonly string[]) => ids.join('>');
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'dispatch') continue;
      delete block.yardMoveStops;
      const visits = moveOwnVisits(block, topology, undefined, aliases);
      if (!visits || visits.length < 3) continue;
      const nodeIds = visits.map((visit) => visit.nodeId);
      const [shortest, second] = findTopologyPaths(topology, nodeIds[0]!, nodeIds[nodeIds.length - 1]!, 2);
      const isUniqueShortest = Boolean(shortest)
        && keyOf(shortest!.nodeIds) === keyOf(nodeIds)
        && !(second && second.avgSeconds <= shortest!.avgSeconds);
      if (isUniqueShortest) continue;
      const startSecond = minuteToSecond(block.plannedStartMinute);
      const stops = visits.slice(1, -1).flatMap((visit) => {
        const node = nodeById.get(visit.nodeId);
        const stationId = node?.stationId?.trim();
        if (!stationId) return [];
        return [{
          stationId,
          name: node?.label?.trim() || visit.nodeLabel,
          offsetSeconds: Math.round(visit.arriveSecond - startSecond),
        }];
      });
      if (stops.length > 0) block.yardMoveStops = stops;
    }
  }
}
