import type { PointTopology } from '../../map-editor/types/pointTopology';
import { facilityAliases, moveOwnVisits } from './pathOccupancy';
import type { GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';

/**
 * 移動卡的訂單途經點
 * ================
 *
 * 訂單原本只給起訖兩點，路徑由車端自己規劃（車端介接說明書 §五：「路徑由車端依 §六 自行
 * 規劃」）。排班檢查過的卻是引擎排的那一條，車端規劃出來的只要不同，檢查就不算數。
 *
 * 先前只在「不是唯一最短路」時才帶，理由是車自己規劃也會走最短路。實際上車端的「最短」
 * 跟引擎拓樸的平均秒數不一定同一把尺：MAT → 充電洗車區經 NWU 與經 NWD 只差 4 公尺，
 * 引擎排 NWU、模擬器走了 NWD，撞上照班表停在 NWD 等下一班的車（2026-11-19）。所以每張
 * 移動卡都把經過的點位寫進 {@link GeneratedScheduleBlock.yardMoveStops}，後端放進訂單
 * <code>stations[]</code>（role＝intermediate；協議允許交叉軌道途經點），車端照站序規劃就會
 * 走同一條路。
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
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'dispatch') continue;
      delete block.yardMoveStops;
      const visits = moveOwnVisits(block, topology, undefined, aliases);
      if (!visits || visits.length < 3) continue;
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
