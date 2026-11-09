import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { rebuildRowHoldCards } from './fillYardHoldGaps';
import { solveMoveShifts, type ShiftVariable } from './moveConflictSolver';
import { YARD_TASK_TYPES } from './moveCardShared';
import {
  collectTrajectories,
  conflictsForTrajectory,
  escapeShiftsFor,
  facilityAliases,
  moveTrajectory,
  movePassBufferSeconds,
  resourceIdOf,
  type VehicleTrajectory,
} from './pathOccupancy';
import {
  resolveMaintenanceEntrySlackSeconds,
  type MaintenanceEntrySlackBySection,
} from './resolveMaintenanceEntrySlackSeconds';
import {
  collectPlanViolations,
  compareViolations,
  type PlanEvaluationContext,
} from './schedule-engine/evaluatePlan';
import { snapUpToClockAlignSeconds } from './schedule-engine/physics';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond, pushIssue, secondToMinute } from './schedule-engine/types';
import type { TaskTypeKey } from '../../time-templates/types/editor';
import { isWorkYardTaskType, nonZeroYardWorkSeconds } from './yardWorkMinimum';

/**
 * 移動卡路徑衝突修復
 * ================
 *
 * 出入場移動卡穿過正線（月台、轉線點）時跟別列車撞上：<strong>挪移動卡自己的時刻</strong>，
 * 不動任何載客班次。可以挪多少完全由這一列自己的卡決定——
 *
 * <ul>
 *   <li><strong>出場</strong>（整備 → 移動 → 下一班）：可以提早出廠，最早到前一段整備
 *       能結束的時刻（作業類整備要做滿，待命至少留一個刻度）；提早到站就在站上等，
 *       等待那段由暫停卡記載、照樣受站位碰撞檢查。可以延後，但到站不能晚於下一班發車。</li>
 *   <li><strong>入場</strong>（上一班 → 移動 → 整備）：可以在月台多等一下再走，最晚到
 *       整備開頭可讓渡的量（整備設定的讓渡餘裕）而且整備至少留一個刻度；不能早於上一班到站。</li>
 *   <li>其他移動卡：只在前後卡之間已有的空檔裡挪。</li>
 * </ul>
 *
 * 候選時刻不逐秒掃：從每個衝突點「剛好閃開對方」的邊界產生（貼著緩衝邊緣），
 * 挪過去若撞上別的，再從新衝突的邊界展開下一層。候選先用路徑檢查快篩，通過的才跑
 * 全套限制比較（{@link compareViolations}）：不能修一筆、在別處生一筆。
 */

export type MovePathRepair = {
  timelineRow: number;
  blockId: string;
  label: string;
  /** 移動卡平移的秒數（負＝提早） */
  shiftSeconds: number;
};

const MAX_DEPTH = 3;
const MAX_CANDIDATES = 48;

type Window = { min: number; max: number };

/**
 * 一串首尾相接的移動卡（整備間轉場＝出廠卡＋入廠卡，中間沒有空檔）是同一趟車在路上，
 * 要整串一起挪；分開挪的話每一張都被另一張卡死，挪不動。
 */
type MoveChain = {
  cards: GeneratedScheduleBlock[];
  previous: GeneratedScheduleBlock | null;
  next: GeneratedScheduleBlock | null;
};

function orderedBlocks(timeline: GeneratedScheduleTimeline): GeneratedScheduleBlock[] {
  return timeline.blocks
    .filter((item) => item.source !== 'hold')
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
}

function chainAround(timeline: GeneratedScheduleTimeline, block: GeneratedScheduleBlock): MoveChain {
  const ordered = orderedBlocks(timeline);
  let first = ordered.findIndex((item) => item.id === block.id);
  let last = first;
  const touching = (a: GeneratedScheduleBlock, b: GeneratedScheduleBlock) =>
    Math.abs(a.plannedEndMinute - b.plannedStartMinute) < 1e-6;
  while (first > 0 && ordered[first - 1]!.taskType === 'dispatch' && touching(ordered[first - 1]!, ordered[first]!)) first -= 1;
  while (last < ordered.length - 1 && ordered[last + 1]!.taskType === 'dispatch' && touching(ordered[last]!, ordered[last + 1]!)) last += 1;
  return {
    cards: ordered.slice(first, last + 1),
    previous: first > 0 ? ordered[first - 1]! : null,
    next: ordered[last + 1] ?? null,
  };
}

/** 停在設施／格位、可以多停或少停一點的卡（整備、待命、讓站暫停） */
function isParked(block: GeneratedScheduleBlock | null): boolean {
  return block != null && (YARD_TASK_TYPES.has(block.taskType) || block.taskType === 'idle');
}

function cardTravel(block: GeneratedScheduleBlock): number {
  const duration = minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute);
  return block.travelSeconds != null ? Math.min(duration, Math.max(0, block.travelSeconds)) : duration;
}

/**
 * 整串可以平移的範圍（秒，相對原時刻）：
 * 往前——前一段若是作業類整備要做滿、不能提早結束；待命或讓站暫停至少留一個刻度；
 * 前一段是載客班次就不能早於它到站。往後——下一段是載客班次就不能晚於它發車；
 * 下一段是整備，開頭最多讓渡整備設定的餘裕、整備至少留一個刻度。前一段整備往後
 * 延長沒有限制（車多充一下、多停一下）。
 */
function shiftWindow(
  chain: MoveChain,
  slackBySection: MaintenanceEntrySlackBySection | null | undefined,
): Window {
  const first = chain.cards[0]!;
  const last = chain.cards[chain.cards.length - 1]!;
  const start = minuteToSecond(first.plannedStartMinute);
  const arrival = minuteToSecond(last.plannedStartMinute) + cardTravel(last);
  const end = minuteToSecond(last.plannedEndMinute);
  const tick = nonZeroYardWorkSeconds();
  const { previous, next } = chain;
  let earliest = start;
  if (previous) {
    if (isParked(previous) && !isWorkYardTaskType(previous.taskType)) {
      earliest = minuteToSecond(previous.plannedStartMinute) + tick;
    } else {
      earliest = minuteToSecond(previous.plannedEndMinute);
    }
  }
  let max = 600;
  if (next) {
    if (isParked(next)) {
      // 作業類整備（充電、保養、行檢）開頭最多讓渡設定的餘裕；待命與讓站暫停不是作業，
      // 晚一點進去只是少等一下，至少留一個刻度就好
      const latestEnd = isWorkYardTaskType(next.taskType)
        ? Math.min(
          minuteToSecond(next.plannedStartMinute)
            + resolveMaintenanceEntrySlackSeconds(next.taskType as TaskTypeKey, slackBySection),
          minuteToSecond(next.plannedEndMinute) - tick,
        )
        : minuteToSecond(next.plannedEndMinute) - tick;
      max = latestEnd - end;
    } else {
      max = minuteToSecond(next.plannedStartMinute) - arrival;
    }
  }
  // 換日處的串（前或後沒有卡）：前後是別天的卡，這裡看不到，不挪那一側
  return {
    min: previous ? Math.min(0, earliest - start) : 0,
    max: next ? Math.max(0, max) : 0,
  };
}

/** 把平移套到這一列（整串移動卡＋前後停放卡的邊界），回傳還原用的函式 */
function applyShift(timeline: GeneratedScheduleTimeline, chain: MoveChain, shiftSeconds: number): () => void {
  const snapshot = timeline.blocks.map((item) => ({ ...item }));
  const byId = new Map(timeline.blocks.map((item) => [item.id, item] as const));
  const cards = chain.cards.map((card) => byId.get(card.id)!);
  const previous = chain.previous ? byId.get(chain.previous.id) ?? null : null;
  const next = chain.next ? byId.get(chain.next.id) ?? null : null;
  const oldStart = minuteToSecond(cards[0]!.plannedStartMinute);
  for (const [index, card] of cards.entries()) {
    const start = minuteToSecond(card.plannedStartMinute) + shiftSeconds;
    const isLast = index === cards.length - 1;
    let end = minuteToSecond(card.plannedEndMinute) + shiftSeconds;
    if (isLast && next && next.taskType === 'passenger') {
      // 到站後等下一班的那段由暫停卡記載（跟排卡時同一個寫法），卡片只到「抵達」
      end = Math.min(minuteToSecond(next.plannedStartMinute), start + cardTravel(card));
    }
    card.plannedStartMinute = secondToMinute(start);
    if (card.anchorStartMinute != null) card.anchorStartMinute = card.plannedStartMinute;
    card.plannedEndMinute = secondToMinute(end);
  }
  const newStart = oldStart + shiftSeconds;
  if (previous && isParked(previous)) {
    const previousEnd = minuteToSecond(previous.plannedEndMinute);
    // 車在格子裡多停（或少停）一下，出廠時刻就是停放結束
    if (Math.abs(previousEnd - oldStart) < 1e-6 || previousEnd > newStart) {
      previous.plannedEndMinute = secondToMinute(newStart);
    }
  }
  if (next && isParked(next)) {
    // 車幾點到格子，整備就幾點開始（結束不動）
    next.plannedStartMinute = cards[cards.length - 1]!.plannedEndMinute;
    if (next.anchorStartMinute != null) next.anchorStartMinute = next.plannedStartMinute;
  }
  return () => {
    timeline.blocks = snapshot;
  };
}

function chainConflicts(
  chain: MoveChain,
  timelineRow: number,
  shift: number,
  others: readonly VehicleTrajectory[],
  topology: PointTopology,
  aliases: ReadonlyMap<string, string>,
  bufferSeconds: number,
) {
  const out: ReturnType<typeof conflictsForTrajectory> = [];
  const last = chain.cards[chain.cards.length - 1]!;
  for (const card of chain.cards) {
    const trajectory = moveTrajectory(card, timelineRow, topology, minuteToSecond(card.plannedStartMinute) + shift, aliases);
    if (!trajectory) continue;
    if (card === last && chain.next?.taskType === 'passenger') {
      // 提早到站：車在站上等到下一班發車，那段也佔著站位
      const stop = trajectory.visits[trajectory.visits.length - 1]!;
      stop.departSecond = Math.max(stop.departSecond, minuteToSecond(chain.next.plannedStartMinute));
    }
    out.push(...conflictsForTrajectory(trajectory, others, bufferSeconds));
  }
  return out;
}

/** 候選平移量：從衝突邊界展開，對齊 10 秒格、落在可挪範圍內，依幅度由小到大 */
function candidateShifts(
  chain: MoveChain,
  timelineRow: number,
  others: readonly VehicleTrajectory[],
  window: Window,
  topology: PointTopology,
  aliases: ReadonlyMap<string, string>,
  bufferSeconds: number,
): number[] {
  const accepted: number[] = [];
  const tried = new Set<number>([0]);
  let frontier = [0];
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length > 0; depth += 1) {
    const nextFrontier: number[] = [];
    for (const base of frontier) {
      const conflicts = chainConflicts(chain, timelineRow, base, others, topology, aliases, bufferSeconds);
      if (conflicts.length === 0) {
        if (base !== 0) accepted.push(base);
        continue;
      }
      if (depth === MAX_DEPTH) continue;
      for (const raw of escapeShiftsFor(conflicts, bufferSeconds)) {
        const total = base + raw;
        const value = total < 0 ? -snapUpToClockAlignSeconds(-total) : snapUpToClockAlignSeconds(total);
        if (tried.has(value)) continue;
        tried.add(value);
        if (value < window.min - 1e-9 || value > window.max + 1e-9) continue;
        nextFrontier.push(value);
      }
    }
    if (accepted.length >= 4) break;
    frontier = nextFrontier.sort((a, b) => Math.abs(a) - Math.abs(b)).slice(0, MAX_CANDIDATES);
  }
  if (accepted.length === 0) {
    /*
     * 邊界展開沒找到：正線班距密的時段，一個閃避點往往緊接著下一列車，離原時刻較遠的
     * 空檔要多層才展得到。退回在可挪範圍內以 10 秒為格由近到遠掃一次——只做路徑快篩
     * （每個位移只比時間上重疊的軌跡），通過的才交給呼叫端做全套驗證。
     */
    const step = 10;
    const reach = Math.max(-window.min, window.max);
    for (let distance = step; distance <= reach && accepted.length < 4; distance += step) {
      for (const value of [-distance, distance]) {
        if (value < window.min - 1e-9 || value > window.max + 1e-9 || tried.has(value)) continue;
        tried.add(value);
        if (chainConflicts(chain, timelineRow, value, others, topology, aliases, bufferSeconds).length === 0) {
          accepted.push(value);
        }
      }
    }
  }
  return [...new Set(accepted)].sort((a, b) => Math.abs(a) - Math.abs(b));
}

export function resolveMovePathConflicts(args: {
  timelines: GeneratedScheduleTimeline[];
  ctx: PlanEvaluationContext;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  maintenanceEntrySlackBySection?: MaintenanceEntrySlackBySection | null;
  warnings?: FeasibilityIssue[];
}): { timelines: GeneratedScheduleTimeline[]; repairs: MovePathRepair[]; unresolved: number } {
  const { timelines } = args;
  const ctx: PlanEvaluationContext = { ...args.ctx, includeMovePath: true };
  const topology = ctx.topology;
  const repairs: MovePathRepair[] = [];
  if (!topology) return { timelines, repairs, unresolved: 0 };
  const bufferSeconds = movePassBufferSeconds(ctx.collisionProtectionSeconds);
  if (bufferSeconds <= 0) return { timelines, repairs, unresolved: 0 };
  const aliases = facilityAliases(timelines);

  let trajectories = collectTrajectories(timelines, args.selectedRoutes, topology);
  let violations = collectPlanViolations(ctx, timelines);

  /*
   * 第一段：替代圖整體消解（見 moveConflictSolver.ts）。有衝突的移動串，連同跟它們
   * 撞上的其他移動串，一起當變數；載客班次與其餘移動卡是固定背景。時間上互相碰得到的
   * 串分成一組一起解——一次只挪一串解不開的（同時結束充電、同時要過正線的幾台車），
   * 在這裡一起決定誰先過。每組解完套用、全套限制比對，沒變好就整組還原。
   */
  {
    const chainsByKey = new Map<string, { timeline: GeneratedScheduleTimeline; chain: MoveChain }>();
    const addChain = (trajectory: VehicleTrajectory) => {
      const timeline = timelines.find((item) => item.row === trajectory.timelineRow);
      const block = timeline?.blocks.find((item) => item.id === trajectory.blockId);
      if (!timeline || !block) return;
      const chain = chainAround(timeline, block);
      const key = chain.cards.map((card) => card.id).join('+');
      if (!chainsByKey.has(key)) chainsByKey.set(key, { timeline, chain });
    };
    for (const trajectory of trajectories) {
      if (trajectory.kind !== 'move') continue;
      const conflicts = conflictsForTrajectory(trajectory, trajectories, bufferSeconds);
      if (conflicts.length === 0) continue;
      addChain(trajectory);
      for (const conflict of conflicts) if (conflict.other.kind === 'move') addChain(conflict.other);
    }
    const variables: Array<ShiftVariable & { timeline: GeneratedScheduleTimeline; chain: MoveChain }> = [];
    for (const [key, { timeline, chain }] of chainsByKey) {
      const chainTrajectories = chain.cards
        .map((card) => moveTrajectory(card, timeline.row, topology, undefined, aliases))
        .filter((item): item is VehicleTrajectory => item != null);
      if (chainTrajectories.length !== chain.cards.length) continue;
      const window = shiftWindow(chain, args.maintenanceEntrySlackBySection);
      const parkedNode = (block: GeneratedScheduleBlock | null) =>
        block && isParked(block) && block.yardFacilityNodeId ? resourceIdOf(topology, block.yardFacilityNodeId) : null;
      const beforeNode = parkedNode(chain.previous);
      const afterNode = parkedNode(chain.next);
      // 前一段是載客班次：車從到站起就停在月台，等到這串出發（多等多佔）
      const stationBefore = chain.previous?.taskType === 'passenger'
        ? trajectories.find((item) => item.blockId === chain.previous!.id)?.visits.at(-1) ?? null
        : null;
      variables.push({
        key, timeline, chain, timelineRow: timeline.row, trajectories: chainTrajectories, min: window.min, max: window.max,
        fixedLastDepartSecond: chain.next?.taskType === 'passenger' ? minuteToSecond(chain.next.plannedStartMinute) : null,
        parkedBefore: beforeNode
          ? { resource: beforeNode, fromSecond: minuteToSecond(chain.previous!.plannedStartMinute) }
          : stationBefore && stationBefore.nodeId === chainTrajectories[0]!.visits[0]!.nodeId
            ? { resource: stationBefore.nodeId, fromSecond: stationBefore.arriveSecond }
            : null,
        parkedAfter: afterNode ? { resource: afterNode, untilSecond: minuteToSecond(chain.next!.plannedEndMinute) } : null,
      });
    }
    const variableIds = new Set(variables.flatMap((variable) => [
      ...variable.chain.cards.map((card) => card.id),
      ...(variable.parkedBefore ? [variable.chain.previous!.id] : []),
      ...(variable.parkedAfter ? [variable.chain.next!.id] : []),
    ]));
    // 別台車停在設施格的那幾段也是固定背景（格位交接一樣要差開緩衝）
    const parked: VehicleTrajectory[] = [];
    for (const timeline of timelines) {
      for (const block of timeline.blocks) {
        if (variableIds.has(block.id) || !block.yardFacilityNodeId) continue;
        if (block.taskType === 'passenger' || block.taskType === 'dispatch') continue;
        // 變數那幾列，夾在串跟它前後停放卡之間的暫停卡會跟著重建，不算背景
        if (variables.some((variable) => variable.timeline === timeline && block.source === 'hold'
          && block.plannedStartMinute >= (variable.chain.previous?.plannedStartMinute ?? Infinity) - 1e-9
          && block.plannedEndMinute <= (variable.chain.next?.plannedEndMinute ?? -Infinity) + 1e-9)) continue;
        const resource = resourceIdOf(topology, block.yardFacilityNodeId);
        parked.push({
          blockId: block.id, timelineRow: timeline.row, kind: 'passenger', label: block.label ?? block.id,
          visits: [{
            nodeId: resource, nodeLabel: block.yardFacilityLabel ?? resource,
            arriveSecond: minuteToSecond(block.plannedStartMinute), departSecond: minuteToSecond(block.plannedEndMinute),
          }],
        });
      }
    }
    const fixed = [...trajectories.filter((trajectory) => !variableIds.has(trajectory.blockId)), ...parked];
    // 時間上碰得到的串分成一組（含可挪範圍與緩衝）
    const spans = variables.map((variable) => {
      const visits = variable.trajectories.flatMap((trajectory) => trajectory.visits);
      return [
        Math.min(...visits.map((visit) => visit.arriveSecond)) + variable.min - bufferSeconds,
        Math.max(...visits.map((visit) => visit.departSecond), variable.fixedLastDepartSecond ?? -Infinity)
          + variable.max + bufferSeconds,
      ] as [number, number];
    });
    const order = variables.map((_, index) => index).sort((a, b) => spans[a]![0] - spans[b]![0]);
    const groups: number[][] = [];
    let groupEnd = -Infinity;
    for (const index of order) {
      if (groups.length === 0 || spans[index]![0] > groupEnd) groups.push([]);
      groups[groups.length - 1]!.push(index);
      groupEnd = Math.max(groupEnd, spans[index]![1]);
    }
    for (const group of groups) {
      const members = group.map((index) => variables[index]!);
      const others = members.length === variables.length
        ? fixed
        : [...fixed, ...variables.filter((variable) => !members.includes(variable)).flatMap((variable) => variable.trajectories)];
      const solved = solveMoveShifts({ variables: members, fixed: others, bufferSeconds });
      if (!solved || solved.shifts.size === 0) continue;
      if ([...solved.shifts.values()].every((value) => value === 0)) continue;
      const restores: Array<() => void> = [];
      const rows = new Set<GeneratedScheduleTimeline>();
      for (const member of members) {
        const shift = solved.shifts.get(member.key) ?? 0;
        if (shift === 0) continue;
        // 同一列前一串挪過之後 timeline.blocks 換成新陣列，要用目前的卡重抓這一串
        const first = member.timeline.blocks.find((item) => item.id === member.chain.cards[0]!.id);
        if (!first) continue;
        restores.push(applyShift(member.timeline, chainAround(member.timeline, first), shift));
        rows.add(member.timeline);
      }
      for (const timeline of rows) rebuildRowHoldCards(timeline, args.selectedRoutes);
      const next = collectPlanViolations(ctx, timelines);
      const comparison = compareViolations(violations, next);
      if (comparison.safeToAdopt && comparison.better) {
        violations = next;
        for (const member of members) {
          const shift = solved.shifts.get(member.key) ?? 0;
          if (shift !== 0) {
            repairs.push({
              timelineRow: member.timeline.row, blockId: member.chain.cards[0]!.id,
              label: member.chain.cards.map((card) => card.label ?? card.id).join(' + '), shiftSeconds: shift,
            });
          }
        }
      } else {
        for (const restore of restores.reverse()) restore();
      }
    }
    trajectories = collectTrajectories(timelines, args.selectedRoutes, topology);
  }

  // 第二段：剩下的逐串修復（替代圖那組整體比對沒變好時的退路）
  const failed = new Set<string>();
  /** 上一次清空放棄名單之後採用了幾筆：別串挪開會空出位置，先前沒解的值得再試一輪 */
  let adoptedSinceReset = 0;
  let resets = 0;

  for (let guard = 0; guard < 2000; guard += 1) {
    // 找下一張還有衝突、還沒放棄的移動卡
    let target: { timeline: GeneratedScheduleTimeline; block: GeneratedScheduleBlock } | null = null;
    for (const trajectory of trajectories) {
      if (trajectory.kind !== 'move' || failed.has(trajectory.blockId)) continue;
      if (conflictsForTrajectory(trajectory, trajectories, bufferSeconds).length === 0) continue;
      const timeline = timelines.find((item) => item.row === trajectory.timelineRow);
      const block = timeline?.blocks.find((item) => item.id === trajectory.blockId);
      if (timeline && block) {
        target = { timeline, block };
        break;
      }
    }
    if (!target) {
      if (adoptedSinceReset === 0 || failed.size === 0 || resets >= 4) break;
      failed.clear();
      adoptedSinceReset = 0;
      resets += 1;
      continue;
    }
    const { timeline, block } = target;
    const chain = chainAround(timeline, block);
    const chainIds = new Set(chain.cards.map((card) => card.id));
    const window = shiftWindow(chain, args.maintenanceEntrySlackBySection);
    const others = trajectories.filter((item) => !chainIds.has(item.blockId));
    const shifts = candidateShifts(chain, timeline.row, others, window, topology, aliases, bufferSeconds);
    let adopted = false;
    for (const shift of shifts) {
      const restore = applyShift(timeline, chain, shift);
      rebuildRowHoldCards(timeline, args.selectedRoutes);
      const next = collectPlanViolations(ctx, timelines);
      const comparison = compareViolations(violations, next);
      if (comparison.safeToAdopt && comparison.better) {
        violations = next;
        repairs.push({ timelineRow: timeline.row, blockId: block.id, label: block.label ?? block.id, shiftSeconds: shift });
        adopted = true;
        adoptedSinceReset += 1;
        break;
      }
      restore();
    }
    if (!adopted) for (const id of chainIds) failed.add(id);
    trajectories = collectTrajectories(timelines, args.selectedRoutes, topology);
  }

  if (args.warnings) {
    for (const repair of repairs) {
      pushIssue(args.warnings, {
        code: 'MOVE_PATH_SHIFTED',
        severity: 'warning',
        kind: 'policy',
        message: `時間線 ${repair.timelineRow}「${repair.label}」${repair.shiftSeconds < 0 ? '提早' : '延後'} `
          + `${Math.abs(repair.shiftSeconds)} 秒，避開途經月台／路段上的別列車`,
        detail: { timelineRow: repair.timelineRow, blockId: repair.blockId, shiftSeconds: repair.shiftSeconds },
      });
    }
  }
  return { timelines, repairs, unresolved: failed.size };
}

/** 診斷與測試用：單一移動卡所屬那一串的可挪範圍與無衝突候選 */
export const movePathRepairInternals = { chainAround, shiftWindow, candidateShifts, chainConflicts };
