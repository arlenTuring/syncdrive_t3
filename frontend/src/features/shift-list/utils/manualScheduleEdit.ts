import { resolveBlockDwellSlackBreakdown } from './buildBlockStationDepartures';
import {
  clampScheduleMinute,
  snapScheduleMinuteUnbounded,
  SCHEDULE_DAY_MINUTES,
  TASK_TYPE_OPTIONS,
  type TaskTypeKey,
} from '../../time-templates/types/editor';
import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../types/create';
import {
  applyStationDwellWithSlack,
  normalizeDwellSlackSeconds,
} from './schedule-engine/physics';
import {
  MANUAL_BLOCK_DEFAULT_DURATION_MINUTES,
  MANUAL_BLOCK_MIN_DURATION_SECONDS,
} from './buildManualShiftScheduleOutput';
import {
  buildScheduleBlockTripCode,
  resolveMaintenanceSectionCodeForTaskType,
  type MaintenanceSectionCodeBySection,
} from './maintenanceSectionCode';
import { validateTimelineOverlaps } from './schedule-engine/validate';
import { splitIntoDayCycleSegments, wrapScheduleMinute } from './scheduleDayCycle';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
} from './schedule-engine/types';
import { computeScheduleGateOk } from './scheduleAcceptance';

const MIN_DURATION_MINUTES = MANUAL_BLOCK_MIN_DURATION_SECONDS / 60;

function rebuildRowTransitions(
  bars: GeneratedScheduleBlock[],
  timelineRow: number,
): GeneratedScheduleBlock[] {
  const sorted = [...bars].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  const result: GeneratedScheduleBlock[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    result.push(current);
    const next = sorted[i + 1];
    if (!next) continue;
    if (next.plannedStartMinute > current.plannedEndMinute) {
      result.push({
        id: `transition-${timelineRow}-${Math.round(current.plannedEndMinute * 60)}`,
        timelineRow,
        taskType: 'idle',
        label: '過渡',
        anchorStartMinute: current.plannedEndMinute,
        plannedStartMinute: current.plannedEndMinute,
        plannedEndMinute: next.plannedStartMinute,
        travelSeconds: 0,
        dwellSeconds: 0,
        source: 'transition',
      });
    }
  }
  return result;
}

export function revalidateManualPlan(plan: GeneratedSchedulePlan): ShiftScheduleFeasibilityReport {
  const errors: ShiftScheduleFeasibilityReport['errors'] = [];
  validateTimelineOverlaps(plan.timelines, errors);
  return {
    ok: computeScheduleGateOk(errors),
    errors,
    warnings: [],
  };
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

export function wouldManualBlockOverlap(args: {
  plan: GeneratedSchedulePlan;
  timelineRow: number;
  startMinute: number;
  endMinute: number;
  excludeBlockId?: string;
}): boolean {
  const timeline = args.plan.timelines.find((row) => row.row === args.timelineRow);
  if (!timeline) return false;
  return timeline.blocks.some((block) => {
    if (block.source !== 'template_bar') return false;
    if (args.excludeBlockId && block.id === args.excludeBlockId) return false;
    return cyclicRangesOverlap(
      args.startMinute,
      args.endMinute,
      block.plannedStartMinute,
      block.plannedEndMinute,
    );
  });
}

/**
 * 兩段時間在<strong>日循環</strong>上有沒有重疊。
 *
 * 跨午夜的卡結束時刻會落在 1440 之後（23:40–24:20 記成 1420–1460），
 * 直接拿原始數字比大小，它跟 00:00–00:30 的那張永遠不會判定成重疊——
 * 但那兩張在同一台車上就是撞在一起。先切成鐘面區段再兩兩比，才是對的。
 */
function cyclicRangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  const a = splitIntoDayCycleSegments(aStart, aEnd);
  const b = splitIntoDayCycleSegments(bStart, bEnd);
  return a.some((one) =>
    b.some((other) =>
      rangesOverlap(one.startMinute, one.endMinute, other.startMinute, other.endMinute),
    ),
  );
}

function resolveManualBlockLabel(taskType: TaskTypeKey): string {
  return TASK_TYPE_OPTIONS.find((item) => item.key === taskType)?.label ?? taskType;
}

/** 靠站＋緩衝合計秒數（未填站視為 0；不停靠／換線停靠不加緩衝） */
export function resolveManualBlockDwellTotalSeconds(
  block: Pick<GeneratedScheduleBlock, 'stationDwells' | 'dwellSlackSeconds' | 'dwellSeconds' | 'dwellSlackAdjustment'>,
): number {
  const dwells = block.stationDwells ?? [];
  if (dwells.length === 0) {
    return Math.max(0, Math.round(block.dwellSeconds ?? 0));
  }
  // 跟逐站時刻同一套解析：單班明確緩衝（含 0）＋系統增加量
  const slack = resolveBlockDwellSlackBreakdown(block, null).effectiveSlackSeconds;
  let total = 0;
  for (const [index, dwell] of dwells.entries()) {
    total += applyStationDwellWithSlack(dwell, slack, index);
  }
  return total;
}

/** 班次卡最短占用分鐘（不得短於靠站合計；且至少 10 秒格） */
export function resolveManualBlockMinDurationMinutes(
  block: Pick<GeneratedScheduleBlock, 'stationDwells' | 'dwellSlackSeconds' | 'dwellSeconds' | 'dwellSlackAdjustment'>,
): number {
  return Math.max(MIN_DURATION_MINUTES, resolveManualBlockDwellTotalSeconds(block) / 60);
}

export function resolveManualBlockTripCode(args: {
  block: Pick<
    GeneratedScheduleBlock,
    'taskType' | 'timelineRow' | 'plannedStartMinute' | 'routeCode'
  >;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): string {
  const { block, sectionCodes } = args;
  if (block.taskType === 'passenger') {
    return buildScheduleBlockTripCode({
      prefixCode: block.routeCode,
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
      includeColumnCode: false,
    });
  }
  if (block.taskType === 'idle') return '----';
  const sectionCode = resolveMaintenanceSectionCodeForTaskType(block.taskType, sectionCodes);
  return buildScheduleBlockTripCode({
    prefixCode: sectionCode,
    timelineRow: block.timelineRow,
    startMinute: block.plannedStartMinute,
  });
}

function withUpdatedTimelines(
  plan: GeneratedSchedulePlan,
  timelineRow: number,
  bars: GeneratedScheduleBlock[],
): GeneratedSchedulePlan {
  return {
    ...plan,
    generatedAt: new Date().toISOString(),
    timelines: plan.timelines.map((timeline) =>
      timeline.row === timelineRow
        ? { row: timelineRow, blocks: rebuildRowTransitions(bars, timelineRow) }
        : timeline,
    ),
  };
}

function barsOnRow(plan: GeneratedSchedulePlan, timelineRow: number): GeneratedScheduleBlock[] {
  const timeline = plan.timelines.find((row) => row.row === timelineRow);
  return (timeline?.blocks ?? []).filter((block) => block.source === 'template_bar');
}

function findBlock(
  plan: GeneratedSchedulePlan,
  blockId: string,
): { block: GeneratedScheduleBlock; timelineRow: number } | null {
  for (const timeline of plan.timelines) {
    const found = timeline.blocks.find((block) => block.id === blockId);
    if (found) return { block: found, timelineRow: timeline.row };
  }
  return null;
}

function cloneStationDwells(
  dwells: ShiftScheduleStationDwell[],
): ShiftScheduleStationDwell[] {
  return dwells.map((dwell) => ({
    stationId: dwell.stationId,
    stationName: dwell.stationName,
    dwellSeconds: dwell.dwellSeconds,
  }));
}

/**
 * 參數生成的正線班次卡通常只有 routeId／合計 dwellSeconds，
 * 沒有寫入各站靠站。手動製作介面需要卡上的 stationDwells 才能編輯，
 * 因此從路線群組設定補回（不改動已有各站資料的卡）。
 */
export function hydrateManualPlanStationDwellsFromRoutes(args: {
  plan: GeneratedSchedulePlan;
  routes: ShiftScheduleSelectedRoute[];
}): GeneratedSchedulePlan {
  if (args.routes.length === 0) return args.plan;
  const routeById = new Map(args.routes.map((route) => [route.routeId, route]));
  let changed = false;

  const timelines = args.plan.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => {
      if (block.source !== 'template_bar' || block.taskType !== 'passenger') {
        return block;
      }
      if (!block.routeId || (block.stationDwells?.length ?? 0) > 0) {
        return block;
      }
      const route = routeById.get(block.routeId);
      if (!route || route.stationDwells.length === 0) {
        return block;
      }
      changed = true;
      const stationDwells = cloneStationDwells(route.stationDwells);
      const dwellSlackSeconds = normalizeDwellSlackSeconds(route.dwellSlackSeconds);
      return {
        ...block,
        routeName: block.routeName ?? route.routeName,
        routeCode:
          block.routeCode
          ?? (route.routeCode?.trim().toUpperCase() || undefined),
        stationDwells,
        dwellSlackSeconds,
        dwellSeconds: resolveManualBlockDwellTotalSeconds({
          stationDwells,
          dwellSlackSeconds,
          dwellSeconds: block.dwellSeconds,
        }),
      };
    }),
  }));

  return changed ? { ...args.plan, timelines } : args.plan;
}

export function insertManualScheduleBlock(args: {
  plan: GeneratedSchedulePlan;
  timelineRow: number;
  startMinute: number;
  taskType: TaskTypeKey;
  durationMinutes?: number;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): { plan: GeneratedSchedulePlan; report: ShiftScheduleFeasibilityReport; blockId: string } | null {
  const duration = args.durationMinutes ?? MANUAL_BLOCK_DEFAULT_DURATION_MINUTES;
  const startMinute = clampScheduleMinute(args.startMinute);
  const endMinute = clampScheduleMinute(startMinute + duration);
  if (endMinute - startMinute < MIN_DURATION_MINUTES) return null;
  if (
    wouldManualBlockOverlap({
      plan: args.plan,
      timelineRow: args.timelineRow,
      startMinute,
      endMinute,
    })
  ) {
    return null;
  }

  const id = `manual-${args.timelineRow}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const block: GeneratedScheduleBlock = {
    id,
    timelineRow: args.timelineRow,
    taskType: args.taskType,
    label: resolveManualBlockLabel(args.taskType),
    anchorStartMinute: startMinute,
    plannedStartMinute: startMinute,
    plannedEndMinute: endMinute,
    travelSeconds: Math.round((endMinute - startMinute) * 60),
    dwellSeconds: 0,
    source: 'template_bar',
  };

  const nextPlan = withUpdatedTimelines(args.plan, args.timelineRow, [
    ...barsOnRow(args.plan, args.timelineRow),
    block,
  ]);
  return {
    plan: nextPlan,
    report: revalidateManualPlan(nextPlan),
    blockId: id,
  };
}

export function applyManualBlockTimeRange(args: {
  plan: GeneratedSchedulePlan;
  blockId: string;
  startMinute: number;
  endMinute: number;
}): { plan: GeneratedSchedulePlan; report: ShiftScheduleFeasibilityReport } | null {
  const found = findBlock(args.plan, args.blockId);
  if (!found || found.block.source !== 'template_bar') return null;
  const { block: target, timelineRow: targetRow } = found;

  // 起點繞回鐘面、時長保持不變，跨午夜就讓結束落在 1440 之後——
  // 既有的跨夜卡本來就是這個表示法，渲染端的 splitIntoDayCycleSegments
  // 吃得下。這裡若照舊把結束夾在 1440，往午夜方向拖就會被硬生生截短。
  const rawStart = snapScheduleMinuteUnbounded(args.startMinute);
  const rawEnd = snapScheduleMinuteUnbounded(args.endMinute);
  const duration = rawEnd - rawStart;
  const minDuration = resolveManualBlockMinDurationMinutes(target);
  if (duration < minDuration) return null;
  // 一張卡不可能長過一天：繞一圈之後頭尾會自己壓到自己
  if (duration > SCHEDULE_DAY_MINUTES) return null;
  const startMinute = wrapScheduleMinute(rawStart);
  const endMinute = startMinute + duration;
  if (
    wouldManualBlockOverlap({
      plan: args.plan,
      timelineRow: targetRow,
      startMinute,
      endMinute,
      excludeBlockId: args.blockId,
    })
  ) {
    return null;
  }

  const nextBars = barsOnRow(args.plan, targetRow).map((block) => {
    if (block.id !== args.blockId) return block;
    return {
      ...block,
      plannedStartMinute: startMinute,
      plannedEndMinute: endMinute,
      anchorStartMinute: startMinute,
      travelSeconds: Math.round((endMinute - startMinute) * 60),
    };
  });
  const nextPlan = withUpdatedTimelines(args.plan, targetRow, nextBars);
  return { plan: nextPlan, report: revalidateManualPlan(nextPlan) };
}

export function applyManualBlockRoute(args: {
  plan: GeneratedSchedulePlan;
  blockId: string;
  route: ShiftScheduleSelectedRoute | null;
}): { plan: GeneratedSchedulePlan; report: ShiftScheduleFeasibilityReport } | null {
  const found = findBlock(args.plan, args.blockId);
  if (!found) return null;
  const { timelineRow: targetRow } = found;

  const nextBars = barsOnRow(args.plan, targetRow).map((block) => {
    if (block.id !== args.blockId) return block;
    if (block.taskType !== 'passenger') return block;
    if (!args.route) {
      return {
        ...block,
        routeId: undefined,
        routeName: undefined,
        routeCode: undefined,
        stationDwells: undefined,
        dwellSlackSeconds: undefined,
        dwellSeconds: 0,
      };
    }
    const stationDwells = cloneStationDwells(args.route.stationDwells);
    const dwellSlackSeconds = normalizeDwellSlackSeconds(args.route.dwellSlackSeconds);
    const dwellSeconds = resolveManualBlockDwellTotalSeconds({
      stationDwells,
      dwellSlackSeconds,
      dwellSeconds: 0,
    });
    const minDuration = Math.max(MIN_DURATION_MINUTES, dwellSeconds / 60);
    let plannedEndMinute = block.plannedEndMinute;
    if (plannedEndMinute - block.plannedStartMinute < minDuration) {
      plannedEndMinute = clampScheduleMinute(block.plannedStartMinute + minDuration);
    }
    return {
      ...block,
      routeId: args.route.routeId,
      routeName: args.route.routeName,
      routeCode: args.route.routeCode?.trim().toUpperCase() || undefined,
      stationDwells,
      dwellSlackSeconds,
      dwellSeconds,
      plannedEndMinute,
      travelSeconds: Math.round((plannedEndMinute - block.plannedStartMinute) * 60),
    };
  });

  const updated = nextBars.find((block) => block.id === args.blockId);
  if (
    updated
    && wouldManualBlockOverlap({
      plan: args.plan,
      timelineRow: targetRow,
      startMinute: updated.plannedStartMinute,
      endMinute: updated.plannedEndMinute,
      excludeBlockId: args.blockId,
    })
  ) {
    // 路線展開後若撞到鄰卡，仍寫入路線但維持原結束時間
    const fallbackBars = barsOnRow(args.plan, targetRow).map((block) => {
      if (block.id !== args.blockId) return block;
      if (!args.route) return block;
      return {
        ...block,
        routeId: args.route.routeId,
        routeName: args.route.routeName,
        routeCode: args.route.routeCode?.trim().toUpperCase() || undefined,
        stationDwells: cloneStationDwells(args.route.stationDwells),
        dwellSlackSeconds: normalizeDwellSlackSeconds(args.route.dwellSlackSeconds),
        dwellSeconds: resolveManualBlockDwellTotalSeconds({
          stationDwells: cloneStationDwells(args.route.stationDwells),
          dwellSlackSeconds: normalizeDwellSlackSeconds(args.route.dwellSlackSeconds),
          dwellSeconds: 0,
        }),
      };
    });
    const nextPlan = withUpdatedTimelines(args.plan, targetRow, fallbackBars);
    return { plan: nextPlan, report: revalidateManualPlan(nextPlan) };
  }

  const nextPlan = withUpdatedTimelines(args.plan, targetRow, nextBars);
  return { plan: nextPlan, report: revalidateManualPlan(nextPlan) };
}

export function applyManualBlockDwells(args: {
  plan: GeneratedSchedulePlan;
  blockId: string;
  stationDwells: ShiftScheduleStationDwell[];
  dwellSlackSeconds: number;
}): { plan: GeneratedSchedulePlan; report: ShiftScheduleFeasibilityReport } | null {
  const found = findBlock(args.plan, args.blockId);
  if (!found || found.block.source !== 'template_bar') return null;
  const { block: target, timelineRow: targetRow } = found;

  const stationDwells = cloneStationDwells(args.stationDwells);
  const dwellSlackSeconds = normalizeDwellSlackSeconds(args.dwellSlackSeconds);
  const dwellSeconds = resolveManualBlockDwellTotalSeconds({
    stationDwells,
    dwellSlackSeconds,
    dwellSeconds: 0,
  });
  const minDuration = Math.max(MIN_DURATION_MINUTES, dwellSeconds / 60);
  let plannedEndMinute = target.plannedEndMinute;
  if (plannedEndMinute - target.plannedStartMinute < minDuration) {
    plannedEndMinute = clampScheduleMinute(target.plannedStartMinute + minDuration);
  }
  if (
    wouldManualBlockOverlap({
      plan: args.plan,
      timelineRow: targetRow,
      startMinute: target.plannedStartMinute,
      endMinute: plannedEndMinute,
      excludeBlockId: args.blockId,
    })
  ) {
    // 無法延長時仍寫入靠站參數，但不強制延長（縮短限制仍由 resize 擋）
    plannedEndMinute = target.plannedEndMinute;
  }

  const nextBars = barsOnRow(args.plan, targetRow).map((block) => {
    if (block.id !== args.blockId) return block;
    return {
      ...block,
      stationDwells,
      dwellSlackSeconds,
      dwellSeconds,
      plannedEndMinute,
      travelSeconds: Math.round((plannedEndMinute - block.plannedStartMinute) * 60),
    };
  });
  const nextPlan = withUpdatedTimelines(args.plan, targetRow, nextBars);
  return { plan: nextPlan, report: revalidateManualPlan(nextPlan) };
}

export function deleteManualScheduleBlock(args: {
  plan: GeneratedSchedulePlan;
  blockId: string;
}): { plan: GeneratedSchedulePlan; report: ShiftScheduleFeasibilityReport } | null {
  const found = findBlock(args.plan, args.blockId);
  if (!found) return null;
  const nextBars = barsOnRow(args.plan, found.timelineRow).filter(
    (block) => block.id !== args.blockId,
  );
  const nextPlan = withUpdatedTimelines(args.plan, found.timelineRow, nextBars);
  return { plan: nextPlan, report: revalidateManualPlan(nextPlan) };
}

/**
 * 增生：在原卡結束時刻起，複製一張相同參數、預設長度 10 分鐘的班次卡。
 * 空間不足（超出當日或與鄰卡重疊）時回傳 ok:false。
 */
export function duplicateManualScheduleBlock(args: {
  plan: GeneratedSchedulePlan;
  blockId: string;
  durationMinutes?: number;
}):
  | {
      ok: true;
      plan: GeneratedSchedulePlan;
      report: ShiftScheduleFeasibilityReport;
      blockId: string;
    }
  | { ok: false; reason: string } {
  const found = findBlock(args.plan, args.blockId);
  if (!found || found.block.source !== 'template_bar') {
    return { ok: false, reason: '找不到可增生的班次卡' };
  }
  const { block: source, timelineRow } = found;
  const duration = args.durationMinutes ?? MANUAL_BLOCK_DEFAULT_DURATION_MINUTES;
  const startMinute = clampScheduleMinute(source.plannedEndMinute);
  const endMinute = clampScheduleMinute(startMinute + duration);
  if (endMinute <= startMinute || endMinute > SCHEDULE_DAY_MINUTES) {
    return { ok: false, reason: '沒有足夠的空間可以增生' };
  }
  if (
    wouldManualBlockOverlap({
      plan: args.plan,
      timelineRow,
      startMinute,
      endMinute,
    })
  ) {
    return { ok: false, reason: '沒有足夠的空間可以增生' };
  }

  const id = `manual-${timelineRow}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cloned: GeneratedScheduleBlock = {
    ...source,
    id,
    timelineRow,
    anchorStartMinute: startMinute,
    plannedStartMinute: startMinute,
    plannedEndMinute: endMinute,
    travelSeconds: Math.round((endMinute - startMinute) * 60),
    stationDwells: source.stationDwells
      ? cloneStationDwells(source.stationDwells)
      : undefined,
    dwellSlackSeconds: source.dwellSlackSeconds,
  };

  const nextPlan = withUpdatedTimelines(args.plan, timelineRow, [
    ...barsOnRow(args.plan, timelineRow),
    cloned,
  ]);
  return {
    ok: true,
    plan: nextPlan,
    report: revalidateManualPlan(nextPlan),
    blockId: id,
  };
}

/** 游標 X → 分鐘（對齊 10 秒格） */
export function minuteFromClientX(args: {
  clientX: number;
  trackLeft: number;
  slotWidthPx: number;
  slotMinutes: number;
}): number {
  const offsetPx = Math.max(0, args.clientX - args.trackLeft);
  const rawMinute = (offsetPx / args.slotWidthPx) * args.slotMinutes;
  return clampScheduleMinute(rawMinute);
}

/**
 * 游標 X → 分鐘（對齊 10 秒格），<strong>不夾在 [0, 一天]</strong>。
 *
 * 格線是無限捲動的，左右各接一份同樣的一天。拖曳中游標很容易跑到相鄰的
 * 日拷貝上，此時相對於本份拷貝的分鐘數本來就會是負的或超過 1440。
 * {@link minuteFromClientX} 會夾住，拿它算位移就永遠拖不過午夜——
 * 拖曳位移一律用這一支，要落回鐘面由呼叫端自己 wrap。
 */
export function minuteFromClientXUnbounded(args: {
  clientX: number;
  trackLeft: number;
  slotWidthPx: number;
  slotMinutes: number;
}): number {
  const offsetPx = args.clientX - args.trackLeft;
  const rawMinute = (offsetPx / args.slotWidthPx) * args.slotMinutes;
  return snapScheduleMinuteUnbounded(rawMinute);
}
