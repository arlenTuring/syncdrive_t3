import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { TaskTypeKey } from '../../time-templates/types/editor';
import { edgeSeconds, findTopologyPath } from './findTopologyPath';
import { extractFacilityMapCodes } from './maintenanceFirstTripOrigins';
import {
  resolveMaintenanceSectionCodeForTaskType,
  type MaintenanceSectionCodeBySection,
} from './maintenanceSectionCode';
import {
  FACILITY_SECTION_BY_TASK_TYPE,
  YARD_TASK_TYPES,
  nodeMatchesMoveCardCodes,
  moveCardFacilityIsFree,
  type MoveCardFacilityBooking,
} from './moveCardShared';
import {
  minuteToSecond,
  secondToMinute,
  type GeneratedScheduleBlock,
  type GeneratedSchedulePlan,
} from './schedule-engine/types';

/**
 * 整備間轉場（兩段不同類型整備銜接：出廠卡 + 入廠卡）
 * ================================================
 *
 * 整備出廠卡（MO）跟整備入廠卡（MI）目前只處理<strong>整備串的頭尾</strong>：
 * MI 只在串首（前面接正線）補、MO 只在串尾（後面接正線）補。串<strong>內部</strong>
 * 兩段不同類型的整備銜接（例：充電做完接著要去保養）完全沒有卡片——車在資料上
 * 等於瞬間從充電設施移動到保養設施，這不對，兩者是不同的設施群組，
 * 之間有真實的路網距離。這個模組補上這一段。
 *
 * <strong>跟外側頭尾一樣，是兩張卡，不是一張</strong>：先一張出廠卡開離前一段
 * 的設施，緊接著一張入廠卡開進下一段的設施——跟「正線 → 整備」「整備 → 正線」
 * 兩側的 MI／MO 是同一套視覺語言，只是這次兩端都是整備、沒有正線介入。
 * 代號各自用來源類型自己的代號 + I/O 尾綴（見 resolveMoveCardPrefix）。
 *
 * 兩張卡的分界點取整條路徑的<strong>第一段邊</strong>（設施 → 緊鄰它的轉乘站，
 * 跟一張普通 MO 卡的形狀一樣）；分界點之後到下一個設施，就是入廠卡
 * （跟一張普通 MI 卡的形狀一樣）。這不是任意切的：出廠卡本來就是「設施 →
 * 緊鄰站」，入廠卡本來就是「某一站 → 設施」，兩者的形狀在既有的 MO／MI
 * 就已經是這樣，這裡只是把同一條完整路徑依既有形狀拆成兩段。
 *
 * 時序規則（跟 MO／MI 兩種既有規則都不一樣，是第三種）：
 * <pre>
 * [充電做滿全長] ─┤出廠├─┤入廠├─ [保養，開始被推遲、結束不動]
 * </pre>
 * <ol>
 *   <li><strong>前一段（充電）跑滿模板配置的全長，結束時刻不動</strong>——
 *   它已經真正做完事，不能被這個轉場偷時間、也沒有理由提前結束。</li>
 *   <li>出廠卡從前一段結束的那一刻起飛，接著馬上是入廠卡——不可能充電一做完
 *   車就瞬間出現在保養廠，中間這段真實的移動時間就是「運輸成本」。</li>
 *   <li><strong>後一段（保養）的開始時刻被推遲到入廠卡抵達的那一刻，
 *   結束時刻不動</strong>——運輸成本佔用的是後一段的工作時間，不是無中生有，
 *   也不是從前一段偷。</li>
 * </ol>
 *
 * 若移動時間長到會把後一段推到結束時刻之後（時長變成負的），視為排不出來，
 * 回報但不強插——這代表這個時間模板的安排在物理上做不到。
 */

export type YardTransitionMoveCardsResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 插入的（出廠卡＋入廠卡）成對數 */
  inserted: number;
  /** 因為轉場而被壓縮時長的整備段數 */
  laterTaskCompressed: number;
  skipped: Array<{
    timelineRow: number;
    fromTaskType: string;
    toTaskType: string;
    reason: string;
  }>;
};

export function insertYardTransitionMoveCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  maintenanceBody: Record<string, unknown> | null | undefined;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): YardTransitionMoveCardsResult {
  const { timelines, topology, maintenanceBody, sectionCodes } = args;
  const skipped: YardTransitionMoveCardsResult['skipped'] = [];
  let inserted = 0;
  let laterTaskCompressed = 0;

  if (!topology || topology.nodes.length === 0) {
    return { timelines, inserted, laterTaskCompressed, skipped };
  }

  const codesBySection = new Map<string, string[]>();
  const facilityNodesFor = (taskType: string) => {
    const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as TaskTypeKey];
    if (!section) return [];
    let codes = codesBySection.get(section);
    if (!codes) {
      codes = extractFacilityMapCodes(maintenanceBody, section);
      codesBySection.set(section, codes);
    }
    return topology.nodes.filter(
      (node) => node.kind === 'facility' && nodeMatchesMoveCardCodes(node, codes!),
    );
  };

  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const));
  const bookings: MoveCardFacilityBooking[] = [];

  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const earlier = sorted[i]!;
      const later = sorted[i + 1]!;
      if (!YARD_TASK_TYPES.has(earlier.taskType) || !YARD_TASK_TYPES.has(later.taskType)) {
        continue;
      }
      // 同類型銜接不需要轉場——不確定車會不會換到別台同型設施，
      // 但那屬於「同一格待著」的合理簡化，不是這個模組要處理的範圍。
      if (earlier.taskType === later.taskType) continue;

      const exitFacilities = facilityNodesFor(earlier.taskType);
      const entryFacilities = facilityNodesFor(later.taskType);
      if (exitFacilities.length === 0 || entryFacilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          fromTaskType: earlier.taskType,
          toTaskType: later.taskType,
          reason: '其中一種整備類型沒設定設施，或設施不在拓樸上',
        });
        continue;
      }

      // 前一段跑滿全長，結束時刻是這個轉場的起飛點，不可更動
      const departSecond = minuteToSecond(earlier.plannedEndMinute);
      const laterEndSecond = minuteToSecond(later.plannedEndMinute);

      let chosen: {
        exitNodeId: string;
        exitLabel: string;
        entryNodeId: string;
        entryLabel: string;
        /** 分界點：出廠卡的終點，同時是入廠卡的起點 */
        midNodeId: string;
        midLabel: string;
        exitLegSeconds: number;
        entryLegSeconds: number;
      } | null = null;

      for (const exitFacility of exitFacilities) {
        for (const entryFacility of entryFacilities) {
          const path = findTopologyPath(topology, exitFacility.id, entryFacility.id);
          if (!path || path.edges.length === 0) continue;
          const totalSeconds = path.avgSeconds;
          const arriveSecond = departSecond + totalSeconds;
          if (arriveSecond >= laterEndSecond - 1e-9) continue;
          // 分界點＝路徑第一段邊的終點：設施→緊鄰站，跟一張普通 MO 卡同形狀；
          // 分界點之後到下一個設施，跟一張普通 MI 卡同形狀。
          const firstEdge = path.edges[0]!;
          const midNodeId = firstEdge.toNodeId;
          const midNode = nodeById.get(midNodeId);
          const exitLegSeconds = edgeSeconds(firstEdge, 'avg');
          const entryLegSeconds = Math.max(0, totalSeconds - exitLegSeconds);
          if (
            !moveCardFacilityIsFree(
              bookings,
              exitFacility.id,
              departSecond,
              departSecond,
              timeline.row,
            )
            || !moveCardFacilityIsFree(
              bookings,
              entryFacility.id,
              arriveSecond,
              laterEndSecond,
              timeline.row,
            )
          ) {
            continue;
          }
          if (!chosen || totalSeconds < chosen.exitLegSeconds + chosen.entryLegSeconds) {
            chosen = {
              exitNodeId: exitFacility.id,
              exitLabel: exitFacility.label || exitFacility.id,
              entryNodeId: entryFacility.id,
              entryLabel: entryFacility.label || entryFacility.id,
              midNodeId,
              midLabel: midNode?.label || midNodeId,
              exitLegSeconds,
              entryLegSeconds,
            };
          }
        }
      }
      if (!chosen) {
        skipped.push({
          timelineRow: timeline.row,
          fromTaskType: earlier.taskType,
          toTaskType: later.taskType,
          reason:
            '拓樸上找不到任何一條設施到設施的路徑，或移動時間長到會把後一段推過結束時刻，或設施都被別列車佔著',
        });
        continue;
      }

      const midSecond = departSecond + chosen.exitLegSeconds;
      const arriveSecond = midSecond + chosen.entryLegSeconds;

      const exitCode =
        resolveMaintenanceSectionCodeForTaskType(earlier.taskType, sectionCodes) ?? undefined;
      const entryCode =
        resolveMaintenanceSectionCodeForTaskType(later.taskType, sectionCodes) ?? undefined;

      const exitCard: GeneratedScheduleBlock = {
        id: `yardtransit-out-${earlier.id}-${Math.round(departSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備出廠 · ${chosen.exitLabel} → ${chosen.midLabel}`,
        anchorStartMinute: secondToMinute(departSecond),
        plannedStartMinute: secondToMinute(departSecond),
        plannedEndMinute: secondToMinute(midSecond),
        travelSeconds: chosen.exitLegSeconds,
        dwellSeconds: 0,
        source: 'yard_exit_move',
        moveCardTag: 'MO',
        yardExitFacilityNodeId: chosen.exitNodeId,
        yardExitFacilityLabel: chosen.exitLabel,
        yardExitStationId: chosen.midNodeId,
        yardExitStationLabel: chosen.midLabel,
        yardExitSectionCode: exitCode,
      };
      const entryCard: GeneratedScheduleBlock = {
        id: `yardtransit-in-${later.id}-${Math.round(midSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備入廠 · ${chosen.midLabel} → ${chosen.entryLabel}`,
        anchorStartMinute: secondToMinute(midSecond),
        plannedStartMinute: secondToMinute(midSecond),
        plannedEndMinute: secondToMinute(arriveSecond),
        travelSeconds: chosen.entryLegSeconds,
        dwellSeconds: 0,
        source: 'yard_entry_move',
        moveCardTag: 'MI',
        yardExitFacilityNodeId: chosen.entryNodeId,
        yardExitFacilityLabel: chosen.entryLabel,
        yardExitStationId: chosen.midNodeId,
        yardExitStationLabel: chosen.midLabel,
        yardExitSectionCode: entryCode,
      };
      timeline.blocks.push(exitCard, entryCard);

      // 後一段開始時刻推遲到入廠卡抵達的那一刻，結束時刻不動——時長被壓縮
      later.plannedStartMinute = secondToMinute(arriveSecond);
      laterTaskCompressed += 1;
      bookings.push({
        facilityNodeId: chosen.exitNodeId,
        startSecond: departSecond - 1,
        endSecond: departSecond,
        timelineRow: timeline.row,
      });
      bookings.push({
        facilityNodeId: chosen.entryNodeId,
        startSecond: arriveSecond,
        endSecond: laterEndSecond,
        timelineRow: timeline.row,
      });
      inserted += 1;
    }
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return { timelines, inserted, laterTaskCompressed, skipped };
}
