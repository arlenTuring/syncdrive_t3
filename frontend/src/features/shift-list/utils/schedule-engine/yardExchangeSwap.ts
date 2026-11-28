import { resolveRouteForBlock } from '../buildBlockStationDepartures';
import { edgeSeconds, findTopologyPath } from '../findTopologyPath';
import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { PlanEvaluationContext } from './evaluatePlan';
import { rerouteTripInCopy } from './resolveResidualConflicts';
import { listOnlineBoundaries } from './roundJoin';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';
import { minuteToSecond } from './types';

type Plan = GeneratedSchedulePlan['timelines'];

const DAY_SECONDS = 24 * 3600;

/**
 * 對向交換：兩台車在同一段時間各自要去對方所在的位置
 * ======================================================
 *
 * 使用者（2026-11-16）：「不應該讓兩台車在一個時間內要抵達對方在的地方」；真的遇到時，
 * 「在充電區前的車子應該要到對手車的對向的月台（如果該月台沒有人的話）」。
 *
 * 一台車跑完載客到了月台，接著要進某個整備區（離線）；另一台車從同一個整備區出來，要到<strong>同一個
 * 月台</strong>發車（上線）。兩台車走的是同一段路、方向相反：離線的車要先離開月台、走完共用的那一段，
 * 上線的車才能進來。需要的時間是
 *
 *   離線車在月台的最短停留 ＋ 離線車走完共用路段 ＋ 一個碰撞保護時間 ＋ 上線車走完共用路段
 *
 * 上線車的發車時刻離離線車的到站時刻不到這麼久，就一定排不出來（2026-11-16 實測：尖峰時上線的車
 * 在離線車到站後 110 秒就要發車，需要 160 秒）。原本這種情況要等出入廠排不出來、搜尋再逐筆換月台，
 * 每一筆重排一次十幾秒，搜尋時間不夠時就留下排不出的出廠卡。
 *
 * 這裡在站位求解之前就把它排除：上線車的第一班改跑同終點、下游相同、從另一個月台發車的已允許路線
 * （跟搜尋裡換月台用的是同一個換法），前提是那個月台這段時間沒有別的車、也不會形成另一組對向交換。
 * 兩台車只剩在共用的入口點交會，差開一個碰撞保護時間就過得去。
 *
 * 不寫任何站名、路線名：月台、整備位置、共用路段全部由路線資料與路網最短路徑推出來。
 */
export function avoidYardExchangeSwap(args: {
  timelines: Plan;
  topology: PointTopology | null | undefined;
  ctx: PlanEvaluationContext;
  warnings: FeasibilityIssue[];
  /** 只檢查這幾班（上線後的第一班）；不給＝每一次上線都檢查 */
  onlyFirstTripIds?: ReadonlySet<string>;
}): { timelines: Plan; swaps: number; rerouted: number } {
  const { topology, ctx } = args;
  if (!topology) return { timelines: args.timelines, swaps: 0, rerouted: 0 };
  const nodeOfStation = new Map<string, string>();
  for (const node of topology.nodes) nodeOfStation.set(node.stationId?.trim() || node.id, node.id);
  const hold = Math.max(0, ctx.minimumRecoveryTimeSeconds);
  const gap = Math.max(0, ctx.collisionProtectionSeconds);

  const originOf = (block: GeneratedScheduleBlock) =>
    resolveRouteForBlock(block, ctx.selectedRoutes)?.stationIds?.[0]?.trim() || null;
  const destinationOf = (block: GeneratedScheduleBlock) =>
    resolveRouteForBlock(block, ctx.selectedRoutes)?.stationIds?.at(-1)?.trim() || null;
  /** 往回看幾秒（a 在 b 之前多久）；跨日取繞一圈的結果 */
  const secondsBefore = (earlier: number, later: number) => (((later - earlier) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;

  /**
   * 從月台出發的 a 路徑、與到月台為止的 b 路徑，方向相反的共用路段各要走幾秒。
   * 沒有共用路段回 null。
   */
  const sharedStretch = (fromPlatform: string, bayA: string, bayB: string): { outSeconds: number; inSeconds: number } | null => {
    const out = findTopologyPath(topology, fromPlatform, bayA);
    const into = findTopologyPath(topology, bayB, fromPlatform);
    if (!out || !into) return null;
    const intoReversed = [...into.nodeIds].reverse();
    let shared = 0;
    while (
      shared + 1 < out.nodeIds.length
      && shared + 1 < intoReversed.length
      && out.nodeIds[shared + 1] === intoReversed[shared + 1]
    ) shared += 1;
    if (shared === 0) return null;
    const sum = (values: number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
    return {
      outSeconds: sum(out.edges.slice(0, shared).map((edge) => edgeSeconds(edge, 'avg'))),
      inSeconds: sum(into.edges.slice(into.edges.length - shared).map((edge) => edgeSeconds(edge, 'avg'))),
    };
  };

  /** 每一列依時間排好的卡片 */
  const sortedRows = (plan: Plan) => plan.map((timeline) => ({
    row: timeline.row,
    blocks: [...timeline.blocks].sort((x, y) => x.plannedStartMinute - y.plannedStartMinute || x.id.localeCompare(y.id)),
  }));

  /**
   * 這台上線車（從 bayNodeId 出來、在 startSecond 從 platformStationId 發車）會不會跟某台離線車對向交換。
   * 回傳對手那一班（離線車的最後一班載客）；沒有回 null。
   */
  const findSwapPartner = (
    plan: Plan,
    ownRow: number,
    platformStationId: string,
    bayNodeId: string,
    startSecond: number,
  ): GeneratedScheduleBlock | null => {
    const platformNodeId = nodeOfStation.get(platformStationId);
    if (!platformNodeId) return null;
    for (const timeline of sortedRows(plan)) {
      if (timeline.row === ownRow) continue;
      for (let index = 0; index < timeline.blocks.length; index += 1) {
        const trip = timeline.blocks[index]!;
        if (trip.taskType !== 'passenger' || destinationOf(trip) !== platformStationId) continue;
        // 下一張模板任務是整備（這台車要離線），而且知道它停哪
        let next: GeneratedScheduleBlock | null = null;
        for (let offset = 1; offset <= timeline.blocks.length; offset += 1) {
          const candidate = timeline.blocks[(index + offset) % timeline.blocks.length]!;
          if (candidate.id === trip.id) break;
          if (candidate.taskType === 'passenger' || candidate.source === 'template_bar') { next = candidate; break; }
        }
        if (!next || next.taskType === 'passenger' || !next.yardFacilityNodeId) continue;
        const stretch = sharedStretch(platformNodeId, next.yardFacilityNodeId, bayNodeId);
        if (!stretch) continue;
        const need = hold + stretch.outSeconds + gap + stretch.inSeconds;
        const lead = secondsBefore(minuteToSecond(trip.plannedEndMinute), startSecond);
        if (lead < need) return trip;
      }
    }
    return null;
  };

  /** 這個月台在發車前後有沒有別的車（別列的班次在這裡到站或發車） */
  const platformIsQuiet = (plan: Plan, ownRow: number, platformStationId: string, startSecond: number): boolean => {
    const window = hold + 2 * gap;
    for (const timeline of plan) {
      if (timeline.row === ownRow) continue;
      for (const trip of timeline.blocks) {
        if (trip.taskType !== 'passenger') continue;
        if (originOf(trip) === platformStationId) {
          const start = minuteToSecond(trip.plannedStartMinute);
          if (Math.min(secondsBefore(start, startSecond), secondsBefore(startSecond, start)) < window) return false;
        }
        if (destinationOf(trip) === platformStationId) {
          const end = minuteToSecond(trip.plannedEndMinute);
          if (Math.min(secondsBefore(end, startSecond), secondsBefore(startSecond, end)) < window) return false;
        }
      }
    }
    return true;
  };

  let timelines = args.timelines;
  let swaps = 0;
  let rerouted = 0;
  for (const boundary of listOnlineBoundaries(args.timelines)) {
    if (args.onlyFirstTripIds && !args.onlyFirstTripIds.has(boundary.first.id)) continue;
    const bayNodeId = boundary.yard.yardFacilityNodeId;
    const platform = originOf(boundary.first);
    if (!bayNodeId || !platform) continue;
    const startSecond = minuteToSecond(boundary.first.plannedStartMinute);
    const partner = findSwapPartner(timelines, boundary.row, platform, bayNodeId, startSecond);
    if (!partner) continue;
    swaps += 1;
    for (const item of rerouteTripInCopy(timelines, boundary.first.id, ctx)) {
      const otherPlatform = item.toRoute.stationIds?.[0]?.trim();
      if (!otherPlatform) continue;
      if (!platformIsQuiet(timelines, boundary.row, otherPlatform, startSecond)) continue;
      if (findSwapPartner(timelines, boundary.row, otherPlatform, bayNodeId, startSecond)) continue;
      timelines = item.timelines;
      rerouted += 1;
      const from = item.fromRoute.routeName ?? item.fromRoute.routeId;
      const to = item.toRoute.routeName ?? item.toRoute.routeId;
      args.warnings.push({
        code: 'ROUTE_ALIGNED_TO_VEHICLE_LOCATION',
        severity: 'warning',
        kind: 'policy',
        message:
          `運用 ${boundary.row}：運用 ${partner.timelineRow} 的車同一段時間要從這個月台進同一個整備區（兩台車要去對方的位置），`
          + `已把「${from}」改派為同終點、下游相同的「${to}」，從它的起點站發車；班次時刻不變。`,
        detail: {
          timelineRow: boundary.row,
          blockId: boundary.first.id,
          fromRouteId: from,
          toRouteId: to,
          swapWithTimelineRow: partner.timelineRow,
          swapWithBlockId: partner.id,
        },
      });
      break;
    }
  }
  return { timelines, swaps, rerouted };
}
