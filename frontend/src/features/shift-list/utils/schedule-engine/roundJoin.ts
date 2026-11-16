import { findTopologyPath } from '../findTopologyPath';
import { resolveRouteForBlock } from '../buildBlockStationDepartures';
import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { joinRoundLaterInCopy } from './resolveResidualConflicts';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';

type Plan = GeneratedSchedulePlan['timelines'];

/** 車上線時從一輪的中途加入：一筆紀錄寫成警告，逐筆列出少掉的班次 */
export function roundJoinNote(args: {
  timelineRow: number;
  joinBlockId: string;
  description: string;
  dropped: GeneratedScheduleBlock[];
  why: string;
}): FeasibilityIssue {
  return {
    code: 'ROUND_JOINED_MIDWAY',
    severity: 'warning',
    kind: 'policy',
    message: `時間線 ${args.timelineRow}：${args.why}，${args.description}。之後各段時刻不變。`,
    detail: {
      timelineRow: args.timelineRow,
      blockId: args.joinBlockId,
      droppedTripCount: args.dropped.length,
      droppedTrips: args.dropped.map((block) => ({
        blockId: block.id,
        routeName: block.routeName ?? null,
        routeCode: block.routeCode ?? null,
        plannedStartMinute: block.plannedStartMinute,
      })),
    },
  };
}

/** 整備之後的第一班：回傳（整備卡, 第一班） */
export function listOnlineBoundaries(plan: Plan): Array<{
  row: number;
  yard: GeneratedScheduleBlock;
  first: GeneratedScheduleBlock;
}> {
  const out: ReturnType<typeof listOnlineBoundaries> = [];
  for (const timeline of plan) {
    const sorted = [...timeline.blocks].sort(
      (x, y) => x.plannedStartMinute - y.plannedStartMinute || x.id.localeCompare(y.id),
    );
    let lastYard: GeneratedScheduleBlock | null = null;
    for (const block of sorted) {
      if (block.taskType === 'passenger') {
        if (lastYard) out.push({ row: timeline.row, yard: lastYard, first: block });
        lastYard = null;
      } else if (block.source === 'template_bar') {
        lastYard = block;
      }
    }
  }
  return out;
}

/** 從整備位置空車開到某一班起點站要多久（路網最短路徑、平均行駛時間）；算不出來回 null */
export function emptyRunSecondsToTripOrigin(args: {
  topology: PointTopology | null | undefined;
  fromNodeId: string | null | undefined;
  trip: GeneratedScheduleBlock;
  selectedRoutes: ShiftScheduleSelectedRoute[];
}): number | null {
  const { topology, fromNodeId, trip, selectedRoutes } = args;
  const stationId = resolveRouteForBlock(trip, selectedRoutes)?.stationIds?.[0]?.trim();
  if (!topology || !fromNodeId || !stationId) return null;
  const to = topology.nodes.find((node) => (node.stationId?.trim() || node.id) === stationId)?.id;
  if (!to) return null;
  return findTopologyPath(topology, fromNodeId, to)?.avgSeconds ?? null;
}

/** 從中途加入時少開的那幾班（鍵＝加入的那一班的 id）：整備位置後來換了、要把班次加回來時用 */
export type RoundJoinDroppedStore = Map<string, GeneratedScheduleBlock[]>;

type OnlineBoundary = ReturnType<typeof listOnlineBoundaries>[number];

/** 這一次上線，從哪一段加入空車路程最短；沒有比現在更短的就回 null */
function nearestJoin(args: {
  timelines: Plan;
  boundary: OnlineBoundary;
  bayNodeId: string | null;
  topology: PointTopology | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
}): { item: ReturnType<typeof joinRoundLaterInCopy>[number]; seconds: number; currentSeconds: number } | null {
  const { timelines, boundary, bayNodeId, topology, selectedRoutes } = args;
  const currentSeconds = emptyRunSecondsToTripOrigin({ topology, fromNodeId: bayNodeId, trip: boundary.first, selectedRoutes });
  if (currentSeconds == null) return null;
  let best: { item: ReturnType<typeof joinRoundLaterInCopy>[number]; seconds: number } | null = null;
  for (const item of joinRoundLaterInCopy(timelines, boundary.first.id)) {
    const join = item.timelines
      .find((timeline) => timeline.row === boundary.row)
      ?.blocks.find((block) => block.id === item.joinBlockId);
    if (!join) continue;
    const seconds = emptyRunSecondsToTripOrigin({ topology, fromNodeId: bayNodeId, trip: join, selectedRoutes });
    if (seconds == null || seconds >= currentSeconds) continue;
    if (!best || seconds < best.seconds) best = { item, seconds };
  }
  return best ? { ...best, currentSeconds } : null;
}

/**
 * 車上線時，從離整備位置最近的那一段加入這一輪。
 *
 * 整備位置定案之後、站位求解之前做：每一次上線，比較「空車開到這一輪各段起點站」的路程，
 * 挑最短的那一段加入；跟循環起點一樣近或更遠就不動。前面沒開的那幾段是少掉的載客班次，
 * 寫成 ROUND_JOINED_MIDWAY。不寫任何站名：全部由路線資料與路網最短路徑決定。
 */
export function applyRoundJoinAtYardExit(args: {
  timelines: Plan;
  topology: PointTopology | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  warnings: FeasibilityIssue[];
  /** 記下少開的班次，之後整備位置換了可以加回來（見 reconcileRoundJoinWithYardLocations） */
  dropped?: RoundJoinDroppedStore;
}): Plan {
  let timelines = args.timelines;
  for (const boundary of listOnlineBoundaries(args.timelines)) {
    const best = nearestJoin({
      timelines,
      boundary,
      bayNodeId: boundary.yard.yardFacilityNodeId ?? null,
      topology: args.topology,
      selectedRoutes: args.selectedRoutes,
    });
    if (!best) continue;
    timelines = best.item.timelines;
    args.dropped?.set(best.item.joinBlockId, best.item.dropped);
    args.warnings.push(roundJoinNote({
      timelineRow: best.item.timelineRow,
      joinBlockId: best.item.joinBlockId,
      description: best.item.description,
      dropped: best.item.dropped,
      why: `整備位置到這一站的空車路程較短（${best.seconds} 秒，到原本起點站要 ${best.currentSeconds} 秒）`,
    }));
  }
  return timelines;
}

/**
 * 上線站跟著最後的整備位置走。
 *
 * applyRoundJoinAtYardExit 用的是整備位置<strong>第一次</strong>定案的結果。出入廠排卡時，停設施格
 * 的整備會依當時的時刻重新挑位置，待命又是「下一班從哪裡發就停在順路的地方」——位置和上線站
 * 互相決定，重挑之後兩邊可能對不上（2026-11-16 實測 900 秒：28 次上線有 6 次對不上，1 次車停在
 * 遠的那一區卻要趕回循環起點、排不出出廠卡；5 次車就停在循環起點旁邊卻繞去中途加入、白白少一班）。
 *
 * 這裡拿排完出入廠的版面（located）上每一張整備卡的實際位置重新比一次：
 * - 已經從中途加入、但實際位置離循環起點一樣近或更近：把少開的班次加回來。
 * - 沒有從中途加入、但實際位置離後面某一段的起點站比較近：改從那一段加入。
 * 只回傳改好的副本與改了哪幾筆；要不要採用由呼叫端重排之後判斷。
 */
export function reconcileRoundJoinWithYardLocations(args: {
  /** 出入廠排卡之前的版面（要改的是這一份） */
  pre: Plan;
  /** 排完出入廠的版面：只讀每一張整備卡最後停在哪 */
  located: Plan;
  topology: PointTopology | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  warnings: readonly FeasibilityIssue[];
  dropped: RoundJoinDroppedStore;
  /** 只處理這幾張整備卡（逐筆試的時候用）；不給＝全部 */
  onlyYardBlockIds?: ReadonlySet<string>;
  /** 要不要把少開的班次加回來（預設要）。給 false 就只做「改從中途加入」 */
  restoreDroppedTrips?: boolean;
  /** 要不要改從中途加入（預設要）。給 false 就只做「把少開的班次加回來」 */
  joinNearer?: boolean;
}): {
  timelines: Plan;
  warnings: FeasibilityIssue[];
  changes: Array<{ yardBlockId: string; timelineRow: number; kind: 'join' | 'unjoin'; firstTripId: string; bayNodeId: string }>;
} {
  const finalBay = new Map<string, string>();
  for (const timeline of args.located) {
    for (const block of timeline.blocks) {
      const nodeId = block.yardExitFacilityNodeId ?? block.yardFacilityNodeId;
      if (nodeId) finalBay.set(block.id, nodeId);
    }
  }
  let timelines = args.pre;
  let warnings = [...args.warnings];
  const changes: Array<{ yardBlockId: string; timelineRow: number; kind: 'join' | 'unjoin'; firstTripId: string; bayNodeId: string }> = [];
  for (const boundary of listOnlineBoundaries(args.pre)) {
    if (args.onlyYardBlockIds && !args.onlyYardBlockIds.has(boundary.yard.id)) continue;
    const bayNodeId = finalBay.get(boundary.yard.id) ?? null;
    if (!bayNodeId) continue;
    const { first, yard, row } = boundary;

    if ((first.roundJoinSkippedLegs ?? 0) > 0) {
      if (args.restoreDroppedTrips === false) continue;
      const dropped = args.dropped.get(first.id);
      if (!dropped || dropped.length === 0) continue;
      const here = emptyRunSecondsToTripOrigin({ topology: args.topology, fromNodeId: bayNodeId, trip: first, selectedRoutes: args.selectedRoutes });
      const cycleStart = emptyRunSecondsToTripOrigin({ topology: args.topology, fromNodeId: bayNodeId, trip: dropped[0]!, selectedRoutes: args.selectedRoutes });
      if (here == null || cycleStart == null || cycleStart > here) continue;
      // 加回來的班次要塞得進整備結束到加入那一班之間，時刻沿用原本排的
      const fits = dropped[0]!.plannedStartMinute >= yard.plannedEndMinute - 1e-9
        && dropped[dropped.length - 1]!.plannedEndMinute <= first.plannedStartMinute + 1e-9;
      if (!fits) continue;
      timelines = timelines.map((timeline) => (timeline.row !== row ? timeline : {
        ...timeline,
        blocks: [
          ...timeline.blocks.map((block) => {
            if (block.id !== first.id) return block;
            const restored: GeneratedScheduleBlock = { ...block };
            delete restored.roundJoinSkippedLegs;
            return restored;
          }),
          ...dropped.map((block) => ({ ...block })),
        ].sort((x, y) => x.plannedStartMinute - y.plannedStartMinute || x.id.localeCompare(y.id)),
      }));
      warnings = warnings.filter((issue) => !(
        issue.code === 'ROUND_JOINED_MIDWAY' && (issue.detail as { blockId?: string } | undefined)?.blockId === first.id
      ));
      changes.push({ yardBlockId: yard.id, timelineRow: row, kind: 'unjoin', firstTripId: dropped[0]!.id, bayNodeId });
      continue;
    }

    if (args.joinNearer === false) continue;
    const best = nearestJoin({ timelines, boundary, bayNodeId, topology: args.topology, selectedRoutes: args.selectedRoutes });
    if (!best) continue;
    timelines = best.item.timelines;
    args.dropped.set(best.item.joinBlockId, best.item.dropped);
    warnings.push(roundJoinNote({
      timelineRow: best.item.timelineRow,
      joinBlockId: best.item.joinBlockId,
      description: best.item.description,
      dropped: best.item.dropped,
      why: `整備位置到這一站的空車路程較短（${best.seconds} 秒，到原本起點站要 ${best.currentSeconds} 秒）`,
    }));
    changes.push({ yardBlockId: yard.id, timelineRow: row, kind: 'join', firstTripId: best.item.joinBlockId, bayNodeId });
  }
  return { timelines, warnings, changes };
}
