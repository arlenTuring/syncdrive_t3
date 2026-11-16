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

/**
 * 車上線時，從離整備位置最近的那一段加入這一輪（試驗功能，roundJoin: 'always'）。
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
}): Plan {
  let timelines = args.timelines;
  for (const boundary of listOnlineBoundaries(args.timelines)) {
    const bayNodeId = boundary.yard.yardFacilityNodeId ?? null;
    const currentSeconds = emptyRunSecondsToTripOrigin({
      topology: args.topology, fromNodeId: bayNodeId, trip: boundary.first, selectedRoutes: args.selectedRoutes,
    });
    if (currentSeconds == null) continue;
    let best: { item: ReturnType<typeof joinRoundLaterInCopy>[number]; seconds: number } | null = null;
    for (const item of joinRoundLaterInCopy(timelines, boundary.first.id)) {
      const join = item.timelines
        .find((timeline) => timeline.row === boundary.row)
        ?.blocks.find((block) => block.id === item.joinBlockId);
      if (!join) continue;
      const seconds = emptyRunSecondsToTripOrigin({
        topology: args.topology, fromNodeId: bayNodeId, trip: join, selectedRoutes: args.selectedRoutes,
      });
      if (seconds == null || seconds >= currentSeconds) continue;
      if (!best || seconds < best.seconds) best = { item, seconds };
    }
    if (!best) continue;
    timelines = best.item.timelines;
    args.warnings.push(roundJoinNote({
      timelineRow: best.item.timelineRow,
      joinBlockId: best.item.joinBlockId,
      description: best.item.description,
      dropped: best.item.dropped,
      why: `整備位置到這一站的空車路程較短（${best.seconds} 秒，到原本起點站要 ${currentSeconds} 秒）`,
    }));
  }
  return timelines;
}
