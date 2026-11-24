import type { PointTopology, PointTopologyEdge } from '../../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { edgeHasTravelTime, edgeSeconds } from '../findTopologyPath';
import { facilityAliases, moveCardOwnSegment, resolveMoveViaNodeIds } from '../pathOccupancy';
import { resolveMaintenanceEntrySlackSeconds } from '../resolveMaintenanceEntrySlackSeconds';
import type { MaintenanceEntrySlackBySection } from '../resolveMaintenanceEntrySlackSeconds';
import type { TaskTypeKey } from '../../../time-templates/types/editor';
import { collectPlanViolations, compareViolations, type PlanEvaluationContext, type PlanViolation } from './evaluatePlan';
import { resolvePassengerRouteOccupancy } from './physics';
import type { FeasibilityIssue, GeneratedSchedulePlan, GeneratedScheduleBlock } from './types';
import { minuteToSecond, pushIssue, secondToMinute } from './types';

/**
 * 移動卡開在正線上的那一段改成載客（調度載客班次）
 * ============================================
 *
 * 進出場、整備間轉場的移動卡原本一律是空車：車從充電洗車區回整備區要開 NWD → T3D，
 * 整備區出場要開 T3U → NWU，這幾段跟載客路線一模一樣，一天卻空跑二十幾趟
 * （2026-11-24 使用者：正線上移動的車不要當成空車）。
 *
 * 規則跟「整備後的調度營運班次」（insertMaintenanceEntryServiceTrips，source＝entry_service）
 * 同一套，不另訂特規：
 * - 正線那一段照<strong>那條路線自己的設定</strong>開：行駛用路線平均時間、停站照路線的停站秒數
 *   （resolvePassengerRouteOccupancy，跟一般載客班次同一個算法）。
 * - 不受同方向班距約束（它是要把車送到該去的地方，不是補班距）；不算輪替圈數。
 * - 站位、碰撞保護、移動路徑、設施佔用一律照最終驗證：改完的班表跟改之前比，
 *   <strong>不能新增或加重任何硬錯誤、安全問題</strong>（compareViolations.safeToAdopt），
 *   做不到就維持空車，並回報原因。
 *
 * 多出來的時間（停站秒數、路線平均跟移動卡快排的差）只能從車自己的空檔拿：
 * 移動前後的待命、暫停卡，或下一段整備使用者給的讓渡餘裕（充電不縮）。不動別台車、不動載客班次。
 * 放置時刻由近而遠試，取第一個整份班表驗證不變差的。
 *
 * 一張移動（單張出場／入廠，或出廠＋入廠成對的轉場）拆成：
 *   [出場：格位 → 正線第一站]（有格位起點才有）＋[載客 × N 段]＋[入廠：正線最後一站 → 格位]（有格位終點才有）
 * 拆不成這三種卡（例如兩段正線中間要穿過場區入口）的部分維持空車。
 */

export type MainlineMoveConversion = {
  timelineRow: number;
  /** 原本的移動卡 */
  blockIds: string[];
  label: string;
  /** 改成載客的路線（依序） */
  routeCodes: string[];
  status: 'converted' | 'kept';
  /** 整趟移動比原本多花的秒數（停站等） */
  extraSeconds?: number;
  /** 出發時刻比原本早（負）或晚（正）幾秒 */
  shiftSeconds?: number;
  reason?: string;
};

type TopologyIndex = {
  nodeById: Map<string, PointTopology['nodes'][number]>;
  edgeByPair: Map<string, PointTopologyEdge>;
  stationIdOf: (nodeId: string) => string | null;
  isFacility: (nodeId: string) => boolean;
  isDocking: (nodeId: string) => boolean;
  labelOf: (nodeId: string) => string;
};

function indexTopology(topology: PointTopology): TopologyIndex {
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const));
  const edgeByPair = new Map(topology.edges.map((edge) => [`${edge.fromNodeId}>${edge.toNodeId}`, edge] as const));
  return {
    nodeById,
    edgeByPair,
    stationIdOf: (id) => nodeById.get(id)?.stationId?.trim() || null,
    isFacility: (id) => nodeById.get(id)?.kind === 'facility',
    isDocking: (id) => nodeById.get(id)?.kind === 'docking',
    labelOf: (id) => nodeById.get(id)?.label?.trim() || id,
  };
}

/** 一段路徑（節點序列）的行駛秒數；缺邊或缺時間回 null */
function pathSeconds(index: TopologyIndex, ids: readonly string[], pace: 'avg' | 'min'): number | null {
  let total = 0;
  for (let i = 1; i < ids.length; i += 1) {
    const edge = index.edgeByPair.get(`${ids[i - 1]}>${ids[i]}`) ?? index.edgeByPair.get(`${ids[i]}>${ids[i - 1]}`);
    if (!edge || !edgeHasTravelTime(edge)) return null;
    total += edgeSeconds(edge, pace);
  }
  return total;
}

type Leg = { from: number; to: number; route: ShiftScheduleSelectedRoute; seconds: number };

/** 路徑上跟載客路線完全重疊的段：兩個停靠點之間、中間只有交叉軌道接口（都有站點識別碼） */
function findLegs(
  index: TopologyIndex,
  ids: readonly string[],
  routeByStations: Map<string, ShiftScheduleSelectedRoute>,
): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (!index.isDocking(ids[i]!)) continue;
    let j = i + 1;
    while (j < ids.length && !index.isDocking(ids[j]!) && index.stationIdOf(ids[j]!) && !index.isFacility(ids[j]!)) j += 1;
    if (j >= ids.length || !index.isDocking(ids[j]!)) continue;
    const stations = ids.slice(i, j + 1).map((id) => index.stationIdOf(id));
    if (stations.some((id) => !id)) continue;
    const route = routeByStations.get(stations.join('>'));
    if (!route) continue;
    const seconds = resolvePassengerRouteOccupancy(route)?.occupancySeconds ?? null;
    if (seconds == null || seconds <= 0) continue;
    legs.push({ from: i, to: j, route, seconds });
  }
  return legs;
}

/** 入廠半張的途經點是出廠半張整條路線的後半段（出廠半張記整趟，入廠半張從轉乘點記起） */
function isSuffix(tail: readonly string[], whole: readonly string[]): boolean {
  if (tail.length < 2 || tail.length > whole.length) return false;
  const offset = whole.length - tail.length;
  return tail.every((id, i) => whole[offset + i] === id);
}

const FLEXIBLE = (block: GeneratedScheduleBlock | undefined) =>
  Boolean(block) && (block!.taskType === 'standby' || (block!.taskType === 'idle' && block!.source === 'hold'));
const YARD_WORK = new Set(['charging', 'inspection', 'servicing', 'washing', 'standby']);

export function convertMainlineMovesToService(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  maintenanceEntrySlackBySection?: MaintenanceEntrySlackBySection | null;
  ctx: PlanEvaluationContext;
  warnings: FeasibilityIssue[];
  /** 每張移動最多試幾個出發時刻 */
  maxCandidates?: number;
}): { timelines: GeneratedSchedulePlan['timelines']; conversions: MainlineMoveConversion[] } {
  const { topology } = args;
  const conversions: MainlineMoveConversion[] = [];
  if (!topology || topology.nodes.length === 0) return { timelines: args.timelines, conversions };
  const index = indexTopology(topology);
  const routeByStations = new Map<string, ShiftScheduleSelectedRoute>();
  for (const route of args.selectedRoutes) {
    const key = route.stationIds.map((id) => id.trim()).join('>');
    if (!routeByStations.has(key)) routeByStations.set(key, route);
  }
  const ctx: PlanEvaluationContext = { ...args.ctx, includeMovePath: true };
  let timelines = args.timelines;
  let baseline: PlanViolation[] = collectPlanViolations(ctx, timelines);
  const maxCandidates = args.maxCandidates ?? 24;

  // 依時間處理每一列的每一趟移動；每採用一次，後面的判斷都看新的班表
  // 途經節點 id 在生成最後才蓋章（stampMoveViaNodeIds）；這裡還沒有就照途經名稱對回路網
  const aliases = facilityAliases(timelines);
  const viaIds = (block: GeneratedScheduleBlock): string[] => {
    if (block.yardMoveViaNodeIds && block.yardMoveViaNodeIds.length >= 2) return [...block.yardMoveViaNodeIds];
    const resolved = resolveMoveViaNodeIds(block, topology, aliases);
    return resolved.some((id) => id == null) ? [] : (resolved as string[]);
  };
  const rows = timelines.map((timeline) => timeline.row);
  for (const row of rows) {
    const done = new Set<string>();
    for (;;) {
      const timeline = timelines.find((item) => item.row === row)!;
      const blocks = [...timeline.blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute
        || a.plannedEndMinute - b.plannedEndMinute);
      const at = blocks.findIndex((block) => block.taskType === 'dispatch'
        && (block.source === 'yard_exit_move' || block.source === 'yard_entry_move')
        && !done.has(block.id));
      if (at < 0) break;
      const first = blocks[at]!;
      done.add(first.id);
      // 成對的轉場：出廠半張後面緊接同一條路線的入廠半張
      const second = blocks[at + 1];
      const pair = first.source === 'yard_exit_move' && second?.source === 'yard_entry_move'
        && Math.abs(second.plannedStartMinute - first.plannedEndMinute) < 1e-6
        && isSuffix(viaIds(second), viaIds(first))
        ? second : null;
      if (pair) done.add(pair.id);
      const cards = pair ? [first, pair] : [first];
      const ids = pair
        ? viaIds(first)
        : (() => {
          const all = viaIds(first);
          if (all.length < 2) return all;
          const [from, to] = moveCardOwnSegment(first, all, topology);
          return all.slice(from, to + 1);
        })();
      if (ids.length < 2 || ids.some((id) => !index.nodeById.has(id))) continue;
      const legs = findLegs(index, ids, routeByStations);
      if (legs.length === 0) continue;
      const label = pair ? `${first.label} ＋ ${pair.label}` : (first.label ?? first.id);
      const record = (status: MainlineMoveConversion['status'], extra: Partial<MainlineMoveConversion>) => {
        conversions.push({
          timelineRow: row, blockIds: cards.map((card) => card.id), label, routeCodes: [], status, ...extra,
        });
      };

      // 連續的幾段正線（前一段終點＝下一段起點）；前後要接得成出場卡／入廠卡
      const startsAtFacility = index.isFacility(ids[0]!);
      const endsAtFacility = index.isFacility(ids[ids.length - 1]!);
      type Run = { legs: Leg[]; from: number; to: number };
      const runs: Run[] = [];
      for (let i = 0; i < legs.length; i += 1) {
        let j = i;
        while (j + 1 < legs.length && legs[j + 1]!.from === legs[j]!.to) j += 1;
        for (let a = i; a <= j; a += 1) {
          for (let b = a; b <= j; b += 1) runs.push({ legs: legs.slice(a, b + 1), from: legs[a]!.from, to: legs[b]!.to });
        }
        i = j;
      }
      const feasibleRuns = runs
        .filter((run) => (run.from === 0 || startsAtFacility) && (run.to === ids.length - 1 || endsAtFacility))
        .sort((a, b) => b.legs.length - a.legs.length || a.from - b.from);
      if (feasibleRuns.length === 0) {
        record('kept', {
          routeCodes: legs.map((leg) => leg.route.routeCode ?? leg.route.routeId),
          reason: '正線那一段前後要穿過場區入口，拆不成「出場＋載客＋入廠」，維持空車',
        });
        continue;
      }
      const run = feasibleRuns[0]!;
      const pace = first.yardMovePace === 'min' ? 'min' : 'avg';
      const exitIds = ids.slice(0, run.from + 1);
      const entryIds = ids.slice(run.to);
      const exitSeconds = run.from > 0 ? pathSeconds(index, exitIds, pace) : 0;
      const entrySeconds = run.to < ids.length - 1 ? pathSeconds(index, entryIds, pace) : 0;
      if (exitSeconds == null || entrySeconds == null) continue;
      const legSeconds = run.legs.reduce((sum, leg) => sum + leg.seconds, 0);
      const newTotal = exitSeconds + legSeconds + entrySeconds;
      const oldStart = Math.round(minuteToSecond(cards[0]!.plannedStartMinute));
      const oldEnd = Math.round(minuteToSecond(cards[cards.length - 1]!.plannedEndMinute));

      // 前後鄰居：能讓出時間的只有車自己的待命／暫停，或下一段整備的讓渡餘裕（充電不縮）
      const firstIndex = blocks.indexOf(cards[0]!);
      const lastIndex = blocks.indexOf(cards[cards.length - 1]!);
      const prev = blocks[firstIndex - 1];
      const next = blocks[lastIndex + 1];
      const prevFlexible = FLEXIBLE(prev);
      const nextFlexible = FLEXIBLE(next);
      const prevEnd = prev ? Math.round(minuteToSecond(prev.plannedEndMinute)) : -Infinity;
      const nextStart = next ? Math.round(minuteToSecond(next.plannedStartMinute)) : Infinity;
      const prevStart = prev ? Math.round(minuteToSecond(prev.plannedStartMinute)) : -Infinity;
      const nextEnd = next ? Math.round(minuteToSecond(next.plannedEndMinute)) : Infinity;
      const nextYardWork = next && !nextFlexible && YARD_WORK.has(next.taskType) && next.source !== 'hold';
      const nextSlack = nextYardWork && next!.taskType !== 'charging'
        ? Math.min(
          resolveMaintenanceEntrySlackSeconds(next!.taskType as TaskTypeKey, args.maintenanceEntrySlackBySection),
          Math.max(0, nextEnd - nextStart - 60),
        )
        : 0;
      // 出發時刻範圍
      const earliest = prevFlexible ? prevStart : (prev && prev.taskType === 'passenger' ? oldStart : Math.min(oldStart, prevEnd));
      const latestEnd = nextFlexible ? nextEnd : nextYardWork ? nextStart + nextSlack : nextStart;
      // 前面是整備（不能縮）就不能比原本早；前面是載客就是車在月台等，可以晚
      const minStart = Math.max(earliest, prevFlexible || prev?.taskType === 'passenger' ? earliest : oldStart);
      const maxStart = latestEnd - newTotal;
      // 比原本晚出發：車做完整備就在格位裡多等一下（補一張暫停卡），跟整備做完等出場同一件事
      const startCap = maxStart;
      // 後面是整備而且不是待命：抵達不能比原本早（整備前面不留空白）
      const startFloor = nextYardWork ? Math.max(minStart, oldEnd - newTotal) : minStart;
      const routeCodes = run.legs.map((leg) => leg.route.routeCode ?? leg.route.routeId);
      if (startFloor > startCap) {
        record('kept', {
          routeCodes,
          extraSeconds: newTotal - (oldEnd - oldStart),
          reason: `改載客要多 ${newTotal - (oldEnd - oldStart)} 秒（照路線停站），`
            + `前後${prevFlexible || nextFlexible ? '的待命／暫停' : '沒有待命或暫停可以讓出時間'}`
            + `${nextYardWork ? '、下一段整備的讓渡餘裕' : ''}放不下，維持空車`,
        });
        continue;
      }
      const candidates: number[] = [];
      const push = (value: number) => {
        const s = Math.round(value / 10) * 10;
        if (s < startFloor || s > startCap || candidates.includes(s)) return;
        candidates.push(s);
      };
      push(oldStart);
      push(oldEnd - newTotal);
      for (let step = 10; candidates.length < maxCandidates && (oldStart - step >= startFloor || oldStart + step <= startCap); step += 10) {
        push(oldStart - step);
        push(oldStart + step);
        push(oldEnd - newTotal - step);
        push(oldEnd - newTotal + step);
      }
      let adopted: { timelines: GeneratedSchedulePlan['timelines']; violations: PlanViolation[]; start: number } | null = null;
      let lastRejection = '';
      for (const start of candidates.slice(0, maxCandidates)) {
        const built = buildRow({
          blocks: timeline.blocks, cards, prev, next, prevFlexible, nextFlexible, nextYardWork: Boolean(nextYardWork),
          start, exitIds, entryIds, exitSeconds, entrySeconds, run, index, row,
        });
        const candidate = timelines.map((item) => (item.row === row ? { ...item, blocks: built } : item));
        const violations = collectPlanViolations(ctx, candidate);
        const comparison = compareViolations(baseline, violations);
        if (comparison.safeToAdopt) {
          adopted = { timelines: candidate, violations, start };
          break;
        }
        const sample = [...comparison.introduced, ...comparison.worsened][0];
        lastRejection = sample ? `${sample.code}（${sample.resource}）` : '安全問題數變多';
      }
      if (!adopted) {
        record('kept', {
          routeCodes,
          extraSeconds: newTotal - (oldEnd - oldStart),
          reason: `試了 ${Math.min(candidates.length, maxCandidates)} 個出發時刻，改載客都會讓班表多出問題（例：${lastRejection}），維持空車`,
        });
        continue;
      }
      timelines = adopted.timelines;
      baseline = adopted.violations;
      record('converted', {
        routeCodes,
        extraSeconds: newTotal - (oldEnd - oldStart),
        shiftSeconds: adopted.start - oldStart,
      });
    }
  }

  const converted = conversions.filter((item) => item.status === 'converted');
  const kept = conversions.filter((item) => item.status === 'kept');
  if (converted.length > 0) {
    pushIssue(args.warnings, {
      code: 'MOVE_MAINLINE_SERVICE',
      severity: 'warning',
      kind: 'policy',
      message: `${converted.length} 趟進出場／轉場移動在正線上的那一段改成載客（照路線停站，不受班距約束）：`
        + converted.map((item) => `時間線 ${item.timelineRow}「${item.label}」→ ${item.routeCodes.join('＋')}`
          + `${item.shiftSeconds ? `（出發${item.shiftSeconds > 0 ? '晚' : '早'} ${Math.abs(item.shiftSeconds)} 秒）` : ''}`).join('；'),
      detail: { conversions: converted },
    });
  }
  if (kept.length > 0) {
    pushIssue(args.warnings, {
      code: 'MOVE_MAINLINE_EMPTY',
      severity: 'warning',
      kind: 'policy',
      message: `${kept.length} 趟移動有一段開在正線上但仍是空車：`
        + kept.map((item) => `時間線 ${item.timelineRow}「${item.label}」${item.reason}`).join('；'),
      detail: { conversions: kept },
    });
  }
  return { timelines, conversions };
}

function buildRow(args: {
  blocks: GeneratedScheduleBlock[];
  cards: GeneratedScheduleBlock[];
  prev: GeneratedScheduleBlock | undefined;
  next: GeneratedScheduleBlock | undefined;
  prevFlexible: boolean;
  nextFlexible: boolean;
  nextYardWork: boolean;
  start: number;
  exitIds: string[];
  entryIds: string[];
  exitSeconds: number;
  entrySeconds: number;
  run: { legs: Leg[] };
  index: TopologyIndex;
  row: number;
}): GeneratedScheduleBlock[] {
  const { cards, index, start } = args;
  const drop = new Set(cards.map((card) => card.id));
  const exitCard = cards.find((card) => card.source === 'yard_exit_move') ?? null;
  const entryCard = [...cards].reverse().find((card) => card.source === 'yard_entry_move') ?? null;
  const out: GeneratedScheduleBlock[] = [];
  let cursor = start;
  const sectionCode = (exitCard ?? entryCard)?.yardExitSectionCode;
  if (args.exitIds.length > 1) {
    const base = exitCard ?? cards[0]!;
    const facility = args.exitIds[0]!;
    const station = args.exitIds[args.exitIds.length - 1]!;
    out.push({
      ...base,
      label: `出場移動 · ${index.labelOf(facility)} → ${index.labelOf(station)}`,
      source: 'yard_exit_move',
      plannedStartMinute: secondToMinute(cursor),
      anchorStartMinute: secondToMinute(cursor),
      plannedEndMinute: secondToMinute(cursor + args.exitSeconds),
      travelSeconds: args.exitSeconds,
      yardMoveViaNodeIds: [...args.exitIds],
      yardMoveViaLabels: args.exitIds.map((id) => index.labelOf(id)),
      yardExitStationId: index.stationIdOf(station) ?? station,
      yardExitStationLabel: index.labelOf(station),
      yardExitFacilityNodeId: facility,
      yardExitFacilityLabel: index.labelOf(facility),
    });
    delete out[out.length - 1]!.yardMoveStops;
    cursor += args.exitSeconds;
  }
  for (const leg of args.run.legs) {
    const route = leg.route;
    out.push({
      id: `mainline-svc-${cards[0]!.id}-${route.routeId}-${cursor}`,
      timelineRow: args.row,
      taskType: 'passenger',
      label: `調度載客 · ${route.routeName || route.routeId}`,
      routeId: route.routeId,
      routeName: route.routeName,
      routeCode: route.routeCode ?? undefined,
      routeInstanceId: route.instanceId,
      anchorStartMinute: secondToMinute(cursor),
      plannedStartMinute: secondToMinute(cursor),
      plannedEndMinute: secondToMinute(cursor + leg.seconds),
      travelSeconds: leg.seconds,
      dwellSeconds: 0,
      source: 'entry_service',
      firstTripOriginStationId: route.stationIds[0]?.trim(),
      ...(sectionCode ? { entryServiceSectionCode: sectionCode } : {}),
    });
    cursor += leg.seconds;
  }
  if (args.entryIds.length > 1) {
    const base = entryCard ?? cards[cards.length - 1]!;
    const station = args.entryIds[0]!;
    const facility = args.entryIds[args.entryIds.length - 1]!;
    out.push({
      ...base,
      id: entryCard ? entryCard.id : `${base.id}-in`,
      label: `整備入廠 · ${index.labelOf(station)} → ${index.labelOf(facility)}`,
      source: 'yard_entry_move',
      plannedStartMinute: secondToMinute(cursor),
      anchorStartMinute: secondToMinute(cursor),
      plannedEndMinute: secondToMinute(cursor + args.entrySeconds),
      travelSeconds: args.entrySeconds,
      yardMoveViaNodeIds: [...args.entryIds],
      yardMoveViaLabels: args.entryIds.map((id) => index.labelOf(id)),
      yardExitStationId: index.stationIdOf(station) ?? station,
      yardExitStationLabel: index.labelOf(station),
      yardExitFacilityNodeId: facility,
      yardExitFacilityLabel: index.labelOf(facility),
    });
    delete out[out.length - 1]!.yardMoveStops;
    cursor += args.entrySeconds;
  }
  const end = cursor;
  const result: GeneratedScheduleBlock[] = [];
  const oldStart = Math.round(minuteToSecond(cards[0]!.plannedStartMinute));
  if (start > oldStart && !args.prevFlexible && args.prev && args.prev.taskType !== 'passenger') {
    // 整備做完、晚一點才出場：車停在原本的格位裡等（暫停卡）
    const facilityNodeId = args.prev.yardFacilityNodeId ?? args.exitIds[0];
    result.push({
      id: `hold-${cards[0]!.id}-${oldStart}`,
      label: `列車 ${args.row} · 暫停`,
      source: 'hold',
      taskType: 'idle',
      timelineRow: args.row,
      dwellSeconds: start - oldStart,
      travelSeconds: 0,
      anchorStartMinute: secondToMinute(oldStart),
      plannedStartMinute: secondToMinute(oldStart),
      plannedEndMinute: secondToMinute(start),
      ...(args.prev.yardFacilityLabel ? { yardFacilityLabel: args.prev.yardFacilityLabel } : {}),
      ...(facilityNodeId ? { yardFacilityNodeId: facilityNodeId } : {}),
    });
  }
  for (const block of args.blocks) {
    if (drop.has(block.id)) continue;
    if (block === args.prev && args.prevFlexible) {
      const from = minuteToSecond(block.plannedStartMinute);
      if (start - from <= 0) continue; // 待命／暫停整段讓掉
      result.push({ ...block, plannedEndMinute: secondToMinute(start) });
      continue;
    }
    if (block === args.next && (args.nextFlexible || args.nextYardWork)) {
      const to = minuteToSecond(block.plannedEndMinute);
      if (to - end <= 0) continue;
      result.push({
        ...block,
        plannedStartMinute: secondToMinute(end),
        ...(block.anchorStartMinute != null ? { anchorStartMinute: secondToMinute(end) } : {}),
      });
      continue;
    }
    result.push(block);
  }
  result.push(...out);
  return result.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute || a.plannedEndMinute - b.plannedEndMinute);
}
