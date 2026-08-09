import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { edgeSeconds, findTopologyPath } from './findTopologyPath';
import {
  extractFacilityMapCodes,
  type MaintenanceBodySectionKey,
} from './maintenanceFirstTripOrigins';
import {
  resolveMaintenanceSectionCodeForTaskType,
  resolveMaintenanceSectionLabelForTaskType,
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
 * 整備轉場卡（MI／MO／整備間轉場）
 * ================================
 *
 * 每一種整備任務（充電／洗車／保養／行前／機動）都用<strong>同一套轉場機制</strong>：
 * 車進去前補一張入廠卡、出來後補一張出廠卡、跟另一種整備直接銜接時補一對
 * 出廠＋入廠——不是四張各自寫死的卡片，是同一個模組依「這一段整備的左右
 * 鄰居是什麼」自己判斷該補哪一種、去哪個設施、算多久。前身是三個各自獨立、
 * 各自重讀一次拓樸／各自建一份設施佔用表的檔案
 * （insertYardExitMoveCards／insertYardEntryMoveCards／
 * insertYardTransitionMoveCards），這裡合併成一個：拓樸、設施代號比對、
 * 路徑搜尋、設施佔用表只建一份，三段規則共用。
 *
 * 三段規則本身是<strong>三種不同的時序邏輯</strong>，不是重複的程式碼硬湊在一起——
 * 各自對應「車要開進整備」「車要開出整備」「兩段不同整備直接銜接」三種
 * 完全不同的情境，本來就該算法不同：
 *
 * <ol>
 *   <li><strong>入廠（entry，MI）</strong>：只在整備串「串首」（前面接正線或本來就沒有
 *   前一段整備）補。車一跑完正線就能走，越早到、整備就從越早開始——
 *   <strong>開始時刻提前、結束時刻不動</strong>，時長變長。</li>
 *   <li><strong>出廠（exit，MO）</strong>：只在整備串「串尾」（後面接正線）補。
 *   往前貼齊下一段發車時刻，零秒緩衝；空間不夠時<strong>唯一有特權</strong>
 *   吃掉整備的尾巴。</li>
 *   <li><strong>整備間轉場（transition）</strong>：串「內部」兩段不同類型整備直接
 *   銜接（例：充電做完接著去保養）——前一段跑滿全長、結束不動；出廠卡
 *   接入廠卡、中間是真實的路網移動時間；後一段開始被推遲到入廠卡抵達
 *   那一刻、結束不動，運輸成本佔的是後一段的工作時間。</li>
 * </ol>
 *
 * 三段規則在「左右鄰居是誰」這件事上互斥、不重疊：入廠只在左鄰居不是
 * 整備任務時才補；出廠只在右鄰居不是整備任務時才補；轉場只在左右鄰居
 * <strong>都是</strong>整備任務、且類型不同時才補。所以三段可以照順序各掃一遍
 * 全部時間線，不必互相協調誰先誰後——但仍然共用<strong>同一份</strong>設施佔用表，
 * 讓入廠、出廠、轉場三種卡片都看得到彼此佔走的設施時段，不會兩張卡
 * 各自以為設施是空的而撞車。
 *
 * 設施路徑一律走 {@link findTopologyPath}（拓樸最短路徑），不再有出廠卡
 * 獨立用「聚合後的每站最快空駛時間」這種另一套資料來源——路徑只有一種
 * 找法，多一套就是多一份要保持同步的重複。
 *
 * 調度入／出廠卡（PI／PO，見 insertParkMoveCards.ts）刻意<strong>不</strong>併進來：
 * 觸發條件是「兩段正線之間的空檔長到會佔死站位」的營運策略門檻，不是
 * 時間模板裡「這一段是不是整備任務」的結構性判斷，跟這裡的三段規則
 * 本質不同，硬併只會讓一個模組同時扛兩種互不相干的觸發邏輯。
 */

/** 這一段是否需要車「人已經在轉乘站上」才能開始 */
function requiresVehicleAtStation(block: GeneratedScheduleBlock): boolean {
  return block.taskType === 'passenger';
}

function resolveBlockOriginStationId(
  block: GeneratedScheduleBlock,
): string | null {
  const dwells = block.stationDwells;
  if (Array.isArray(dwells) && dwells.length > 0) {
    return dwells[0]?.stationId?.trim() || null;
  }
  return null;
}

export type MaintenanceTransferCardsResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 插入的卡數（入廠、出廠各算一張；轉場的出廠＋入廠成對算一次） */
  inserted: number;
  /** 出廠卡吃到整備尾巴的次數 */
  ateYardTail: number;
  /** 入廠卡讓整備頭部提前而變長的次數 */
  yardHeadExtended: number;
  /** 轉場卡讓後一段整備被壓縮時長的次數 */
  laterTaskCompressed: number;
  skipped: Array<{
    timelineRow: number;
    taskType?: string;
    fromTaskType?: string;
    toTaskType?: string;
    reason: string;
  }>;
};

export function insertMaintenanceTransferCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  maintenanceBody: Record<string, unknown> | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** 整備區塊代號；用來把來源／目的整備類型的代號算好寫進卡片 */
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): MaintenanceTransferCardsResult {
  const {
    timelines,
    topology,
    maintenanceBody,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
    sectionCodes,
  } = args;
  const skipped: MaintenanceTransferCardsResult['skipped'] = [];
  let inserted = 0;
  let ateYardTail = 0;
  let yardHeadExtended = 0;
  let laterTaskCompressed = 0;

  if (!topology || topology.nodes.length === 0) {
    return { timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed, skipped };
  }

  const routeStartStation = new Map<string, string>();
  const routeEndStation = new Map<string, string>();
  for (const route of selectedRoutes) {
    const ids = route.stationIds ?? [];
    const start = ids[0]?.trim();
    const end = ids[ids.length - 1]?.trim();
    if (!route.routeId) continue;
    if (start) routeStartStation.set(route.routeId, start);
    if (end) routeEndStation.set(route.routeId, end);
  }

  /** stationId → 拓樸節點 id（停靠節點的 stationId 才是路線用的站碼） */
  const nodeIdByStationId = new Map<string, string>();
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const));
  for (const node of topology.nodes) {
    const stationId = node.stationId?.trim();
    if (stationId) nodeIdByStationId.set(stationId, node.id);
  }

  const codesBySection = new Map<MaintenanceBodySectionKey, string[]>();
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

  // 入廠、出廠、轉場三段共用同一份設施佔用表——同一台設施同一時刻只能停
  // 一台車，不分是被哪一種卡佔的。
  const bookings: MoveCardFacilityBooking[] = [];

  // ---- 入廠（MI）：只在串首補，開始時刻提前、結束不動 ----
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;
      // 連續整備串只在串首入廠：左鄰居是別種整備由轉場處理，同種整備不需要
      const prevYard = sorted[i - 1];
      if (prevYard && YARD_TASK_TYPES.has(prevYard.taskType)) continue;

      const previousPassenger = [...sorted.slice(0, i)]
        .reverse()
        .find((block) => block.taskType === 'passenger');
      if (!previousPassenger?.routeId) continue;
      const stationId = routeEndStation.get(previousPassenger.routeId);
      const fromNodeId = stationId ? nodeIdByStationId.get(stationId) : undefined;
      if (!fromNodeId) {
        skipped.push({
          timelineRow: timeline.row,
          taskType: yard.taskType,
          reason: `前一段載客的終點站在拓樸上找不到對應節點（${stationId ?? '未知'}）`,
        });
        continue;
      }

      const facilities = facilityNodesFor(yard.taskType);
      if (facilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          taskType: yard.taskType,
          reason: '整備任務沒設定這一類的設施，或設施不在拓樸上',
        });
        continue;
      }

      const freeSecond = minuteToSecond(previousPassenger.plannedEndMinute)
        + Math.max(0, minimumRecoveryTimeSeconds);
      const yardStartSecond = minuteToSecond(yard.plannedStartMinute);
      if (freeSecond >= yardStartSecond - 1e-9) continue;

      let chosen: { nodeId: string; label: string; seconds: number } | null = null;
      for (const facility of facilities) {
        const path = findTopologyPath(topology, fromNodeId, facility.id);
        if (!path) continue;
        const arriveSecond = freeSecond + path.avgSeconds;
        if (arriveSecond >= yardStartSecond - 1e-9) continue;
        if (
          !moveCardFacilityIsFree(bookings, facility.id, arriveSecond, yardStartSecond, timeline.row)
        ) {
          continue;
        }
        if (!chosen || path.avgSeconds < chosen.seconds) {
          chosen = { nodeId: facility.id, label: facility.label || facility.id, seconds: path.avgSeconds };
        }
      }
      if (!chosen) {
        skipped.push({
          timelineRow: timeline.row,
          taskType: yard.taskType,
          reason: '拓樸上到不了任何一座該類設施，或設施都被別列車佔著',
        });
        continue;
      }

      const arriveSecond = freeSecond + chosen.seconds;
      const card: GeneratedScheduleBlock = {
        id: `yardentry-${yard.id}-${Math.round(freeSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備入廠 · → ${chosen.label}`,
        anchorStartMinute: secondToMinute(freeSecond),
        plannedStartMinute: secondToMinute(freeSecond),
        plannedEndMinute: secondToMinute(arriveSecond),
        travelSeconds: chosen.seconds,
        dwellSeconds: 0,
        source: 'yard_entry_move',
        yardExitFacilityNodeId: chosen.nodeId,
        yardExitFacilityLabel: chosen.label,
        yardExitStationId: stationId,
        yardExitSectionCode:
          resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes) ?? undefined,
        yardExitSectionLabel: resolveMaintenanceSectionLabelForTaskType(yard.taskType) ?? undefined,
      };
      timeline.blocks.push(card);

      yard.plannedStartMinute = secondToMinute(arriveSecond);
      yardHeadExtended += 1;
      bookings.push({
        facilityNodeId: chosen.nodeId,
        startSecond: arriveSecond,
        endSecond: minuteToSecond(yard.plannedEndMinute),
        timelineRow: timeline.row,
      });
      inserted += 1;
    }
  }

  // ---- 整備間轉場：串內部兩段不同類型整備銜接，出廠卡＋入廠卡成對 ----
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

      const departSecond = minuteToSecond(earlier.plannedEndMinute);
      const laterEndSecond = minuteToSecond(later.plannedEndMinute);

      let chosen: {
        exitNodeId: string;
        exitLabel: string;
        entryNodeId: string;
        entryLabel: string;
        midNodeId: string;
        midLabel: string;
        exitLegSeconds: number;
        entryLegSeconds: number;
        /**
         * 出廠設施的第一段邊終點，跟入廠設施的最後一段邊起點，是不是同一個
         * 轉折點——只隔一個轉折點就代表兩座設施在同一個區域，卡面直接顯示
         * 「設施 → 設施」（例 M1 → H1），不用把中間那個轉折點的站名也印出來。
         * 隔更多段（要先繞去別的轉乘站）才維持顯示「設施 → 轉折點」兩段式。
         */
        sameArea: boolean;
      } | null = null;

      for (const exitFacility of exitFacilities) {
        for (const entryFacility of entryFacilities) {
          const path = findTopologyPath(topology, exitFacility.id, entryFacility.id);
          if (!path || path.edges.length === 0) continue;
          const totalSeconds = path.avgSeconds;
          const arriveSecond = departSecond + totalSeconds;
          if (arriveSecond >= laterEndSecond - 1e-9) continue;
          // 分界點取最後一段邊的起點：入廠卡永遠是「進入這座設施專屬的那一段
          // 邊」（例 T3下行 → M1，跟出場方向 M1 → T3上行 對稱），出廠卡吸收掉
          // 中間所有正線轉乘——不是反過來，因為入廠設施同樣有自己專屬的單一
          // 進場邊，不該被中間的轉乘路程稀釋掉。
          const lastEdge = path.edges[path.edges.length - 1]!;
          const midNodeId = lastEdge.fromNodeId;
          const midNode = nodeById.get(midNodeId);
          const entryLegSeconds = edgeSeconds(lastEdge, 'avg');
          const exitLegSeconds = Math.max(0, totalSeconds - entryLegSeconds);
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
              // 只有一個轉折點（設施→轉折點→設施，恰好兩段邊）才算同一區域
              sameArea: path.edges.length === 2,
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
      const exitLabel = resolveMaintenanceSectionLabelForTaskType(earlier.taskType) ?? undefined;
      const entryLabel = resolveMaintenanceSectionLabelForTaskType(later.taskType) ?? undefined;

      // 同一區域（只隔一個轉折點）：卡面直接顯示「設施 → 設施」，不印中間那個
      // 轉折點的站名——使用者不需要知道車繞了哪個轉乘站，只需要知道從哪一台
      // 設施到哪一台設施。隔更多段才維持顯示「設施 → 轉折點」兩段式。
      const exitOtherSideLabel = chosen.sameArea ? chosen.entryLabel : chosen.midLabel;
      const entryOtherSideLabel = chosen.sameArea ? chosen.exitLabel : chosen.midLabel;

      const exitCard: GeneratedScheduleBlock = {
        id: `yardtransit-out-${earlier.id}-${Math.round(departSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備出廠 · ${chosen.exitLabel} → ${exitOtherSideLabel}`,
        anchorStartMinute: secondToMinute(departSecond),
        plannedStartMinute: secondToMinute(departSecond),
        plannedEndMinute: secondToMinute(midSecond),
        travelSeconds: chosen.exitLegSeconds,
        dwellSeconds: 0,
        source: 'yard_exit_move',
        yardExitFacilityNodeId: chosen.exitNodeId,
        yardExitFacilityLabel: chosen.exitLabel,
        yardExitStationId: chosen.midNodeId,
        yardExitStationLabel: exitOtherSideLabel,
        yardExitSectionCode: exitCode,
        yardExitSectionLabel: exitLabel,
      };
      const entryCard: GeneratedScheduleBlock = {
        id: `yardtransit-in-${later.id}-${Math.round(midSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備入廠 · ${entryOtherSideLabel} → ${chosen.entryLabel}`,
        anchorStartMinute: secondToMinute(midSecond),
        plannedStartMinute: secondToMinute(midSecond),
        plannedEndMinute: secondToMinute(arriveSecond),
        travelSeconds: chosen.entryLegSeconds,
        dwellSeconds: 0,
        source: 'yard_entry_move',
        yardExitFacilityNodeId: chosen.entryNodeId,
        yardExitFacilityLabel: chosen.entryLabel,
        yardExitStationId: chosen.midNodeId,
        yardExitStationLabel: entryOtherSideLabel,
        yardExitSectionCode: entryCode,
        yardExitSectionLabel: entryLabel,
      };
      timeline.blocks.push(exitCard, entryCard);

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

  // ---- 出廠（MO）：只在串尾補，往前貼齊、零秒緩衝，空間不夠可吃整備尾巴 ----
  type Pending = {
    timeline: GeneratedSchedulePlan['timelines'][number];
    yard: GeneratedScheduleBlock;
    next: GeneratedScheduleBlock;
  };
  const pending: Pending[] = [];

  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;

      // 連續整備串只在串尾出場：右鄰居是別種整備由轉場處理，同種整備不需要
      const nextYardIndex = sorted.findIndex(
        (b, idx) => idx > i && YARD_TASK_TYPES.has(b.taskType),
      );
      const next = sorted
        .slice(i + 1)
        .find((b) => requiresVehicleAtStation(b));
      if (!next) continue;
      if (
        nextYardIndex >= 0
        && sorted[nextYardIndex]!.plannedStartMinute < next.plannedStartMinute
      ) {
        // 後面還有整備排在這一段載客之前 → 這一段不是串尾，交給串尾處理
        continue;
      }
      pending.push({ timeline, yard, next });
    }
  }

  // 早的整備先挑設施，晚的才需要讓
  pending.sort((a, b) => a.yard.plannedStartMinute - b.yard.plannedStartMinute);

  for (const { timeline, yard, next } of pending) {
    // 要的是「這一段自己從哪一站發車」＝路線起點站。
    // 不能用 firstTripOriginStationId——那個欄位在調度營運班次上存的是
    // 「要把車送到的首班起點站」（終點側），拿來當起點會查到完全另一站。
    const stationId = (next.routeId ? routeStartStation.get(next.routeId) : undefined)
      || resolveBlockOriginStationId(next)
      || next.firstTripOriginStationId?.trim();
    if (!stationId) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: '下一段載客查不到起點站',
      });
      continue;
    }
    const stationNodeId = nodeIdByStationId.get(stationId);
    if (!stationNodeId) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: `${stationId} 在拓樸上找不到對應節點`,
      });
      continue;
    }
    const stationLabel = nodeById.get(stationNodeId)?.label || stationId;

    const facilities = facilityNodesFor(yard.taskType);
    if (facilities.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: '整備任務沒設定這一類的設施，或設施不在拓樸上',
      });
      continue;
    }

    // 快的先挑：佔整備尾巴的風險最小
    const candidates = facilities
      .map((facility) => {
        const path = findTopologyPath(topology, facility.id, stationNodeId);
        return path ? { facility, seconds: path.avgSeconds } : null;
      })
      .filter((c): c is { facility: (typeof facilities)[number]; seconds: number } => c !== null)
      .sort((a, b) => a.seconds - b.seconds);
    if (candidates.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: `整備設定的設施拓樸上都沒有連到 ${stationId}`,
      });
      continue;
    }

    const departSecond = minuteToSecond(next.plannedStartMinute);
    const yardEndSecond = minuteToSecond(yard.plannedEndMinute);
    const yardStartSecond = minuteToSecond(yard.plannedStartMinute);

    let chosen: { nodeId: string; label: string; seconds: number } | null = null;
    let chosenStart = 0;
    for (const { facility, seconds } of candidates) {
      const startSecond = departSecond - seconds;
      // 出場移動不得早於整備開始（那代表整備根本沒做）
      if (startSecond < yardStartSecond - 1e-9) continue;
      if (!moveCardFacilityIsFree(bookings, facility.id, yardStartSecond, startSecond, timeline.row)) {
        continue;
      }
      chosen = { nodeId: facility.id, label: facility.label || facility.id, seconds };
      chosenStart = startSecond;
      break;
    }
    if (!chosen) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: '設施都被別列車佔著，或空駛時間長到蓋掉整段整備',
      });
      continue;
    }

    // 空間不夠 → 吃整備尾巴（全系統唯一有此特權的卡）
    const eatsTail = chosenStart < yardEndSecond - 1e-9;
    if (eatsTail) {
      yard.plannedEndMinute = secondToMinute(chosenStart);
      ateYardTail += 1;
    }

    const card: GeneratedScheduleBlock = {
      id: `yardexit-${yard.id}-${Math.round(chosenStart)}`,
      timelineRow: timeline.row,
      taskType: 'dispatch',
      label: `出場移動 · ${chosen.label} → ${stationLabel}`,
      anchorStartMinute: secondToMinute(chosenStart),
      plannedStartMinute: secondToMinute(chosenStart),
      plannedEndMinute: next.plannedStartMinute,
      travelSeconds: chosen.seconds,
      dwellSeconds: 0,
      source: 'yard_exit_move',
      yardExitFacilityNodeId: chosen.nodeId,
      yardExitFacilityLabel: chosen.label,
      yardExitStationId: stationId,
      yardExitStationLabel: stationLabel,
      yardExitSectionCode:
        resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes) ?? undefined,
      yardExitSectionLabel: resolveMaintenanceSectionLabelForTaskType(yard.taskType) ?? undefined,
      yardExitAteYardTail: eatsTail || undefined,
    };
    timeline.blocks.push(card);
    bookings.push({
      facilityNodeId: chosen.nodeId,
      startSecond: yardStartSecond,
      endSecond: chosenStart,
      timelineRow: timeline.row,
    });
    inserted += 1;
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return { timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed, skipped };
}
