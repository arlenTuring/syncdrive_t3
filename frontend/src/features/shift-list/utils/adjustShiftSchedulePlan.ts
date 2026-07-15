import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  clampScheduleMinute,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import {
  validatePassengerHeadway,
  validateRouteSwitchBuffers,
  validateTimelineCapacity,
  validateTimelineOverlaps,
} from './schedule-engine/validate';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
} from './schedule-engine/types';
import { minuteToSecond, secondToMinute, pushIssue } from './schedule-engine/types';
import { isClockAlignedSeconds, SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS } from './schedule-engine/physics';

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
    const startSecond = minuteToSecond(current.plannedEndMinute);
    const endSecond = minuteToSecond(next.plannedStartMinute);
    if (endSecond > startSecond) {
      result.push({
        id: `transition-${timelineRow}-${startSecond}`,
        timelineRow,
        taskType: 'idle',
        label: '過渡',
        anchorStartMinute: secondToMinute(startSecond),
        plannedStartMinute: secondToMinute(startSecond),
        plannedEndMinute: secondToMinute(endSecond),
        travelSeconds: 0,
        dwellSeconds: 0,
        source: 'transition',
      });
    }
  }
  return result;
}

function validateManualRecovery(
  timelines: GeneratedSchedulePlan['timelines'],
  minimumRecoveryTimeSeconds: number,
  errors: FeasibilityIssue[],
): void {
  if (minimumRecoveryTimeSeconds <= 0) return;
  for (const timeline of timelines) {
    const bars = [...timeline.blocks]
      .filter((block) => block.source === 'template_bar')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    for (let i = 0; i < bars.length - 1; i += 1) {
      const current = bars[i]!;
      const next = bars[i + 1]!;
      const gapSeconds = Math.round(
        (next.plannedStartMinute - current.plannedEndMinute) * 60,
      );
      if (gapSeconds < 0) continue;
      if (gapSeconds < minimumRecoveryTimeSeconds) {
        pushIssue(errors, {
          code: 'RECOVERY_INSUFFICIENT',
          severity: 'error',
          message: `時間線 ${timeline.row}：${current.label} 與下一班之間的空檔不足恢復時間（需至少 ${minimumRecoveryTimeSeconds} 秒）`,
          detail: {
            timelineRow: timeline.row,
            blockId: current.id,
            gapSeconds,
            minimumRecoveryTimeSeconds,
          },
        });
      }
    }
  }
}

function validateManualClockAlign(
  timelines: GeneratedSchedulePlan['timelines'],
  errors: FeasibilityIssue[],
): void {
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.source !== 'template_bar') continue;
      const startSecond = minuteToSecond(block.plannedStartMinute);
      if (!isClockAlignedSeconds(startSecond)) {
        pushIssue(errors, {
          code: 'CLOCK_ALIGN_VIOLATION',
          severity: 'error',
          message: `時間線 ${timeline.row}：${block.label} 計畫發車未對齊 ${SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS} 秒格位`,
          detail: {
            timelineRow: timeline.row,
            blockId: block.id,
            startSecond,
          },
        });
      }
    }
  }
}

export function revalidateAdjustedPlan(args: {
  plan: GeneratedSchedulePlan;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
}): ShiftScheduleFeasibilityReport {
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];
  const routeById = new Map(
    args.selectedRoutes.map((route) => [route.routeId, route] as const),
  );
  const allBlocks = args.plan.timelines.flatMap((timeline) => timeline.blocks);

  validateManualClockAlign(args.plan.timelines, errors);
  validateManualRecovery(
    args.plan.timelines,
    args.minimumRecoveryTimeSeconds,
    errors,
  );
  validateTimelineOverlaps(args.plan.timelines, errors);
  validateRouteSwitchBuffers(args.plan.timelines, routeById, errors);
  validatePassengerHeadway(
    allBlocks,
    args.intervals,
    args.attributes,
    routeById,
    errors,
    warnings,
    args.plan.scheduleRowCount,
  );
  validateTimelineCapacity(
    allBlocks.filter((block) => block.taskType === 'passenger' && block.source === 'template_bar'),
    args.plan.scheduleRowCount,
    args.intervals,
    args.attributes,
    routeById,
    warnings,
  );

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Step 5 手動調整：移動正線（或其他 template_bar）區塊的計畫發車時刻，
 * 占用長度不變，重算該列過渡區塊並重跑可行性。
 */
export function applyManualBlockStartAdjustment(args: {
  plan: GeneratedSchedulePlan;
  blockId: string;
  newStartMinute: number;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
}): {
  plan: GeneratedSchedulePlan;
  report: ShiftScheduleFeasibilityReport;
} | null {
  const { plan, blockId } = args;
  let target: GeneratedScheduleBlock | null = null;
  let targetRow: number | null = null;

  for (const timeline of plan.timelines) {
    const found = timeline.blocks.find((block) => block.id === blockId);
    if (found) {
      target = found;
      targetRow = timeline.row;
      break;
    }
  }

  if (!target || targetRow == null || target.source !== 'template_bar') {
    return null;
  }

  const occupancySeconds = Math.max(
    0,
    Math.round((target.plannedEndMinute - target.plannedStartMinute) * 60),
  );
  const newStart = clampScheduleMinute(args.newStartMinute);
  const newEnd = newStart + occupancySeconds / 60;

  const nextTimelines = plan.timelines.map((timeline) => {
    if (timeline.row !== targetRow) return timeline;
    const bars = timeline.blocks
      .filter((block) => block.source === 'template_bar')
      .map((block) => {
        if (block.id !== blockId) return block;
        return {
          ...block,
          plannedStartMinute: newStart,
          plannedEndMinute: newEnd,
        };
      });
    return {
      row: timeline.row,
      blocks: rebuildRowTransitions(bars, timeline.row),
    };
  });

  const nextPlan: GeneratedSchedulePlan = {
    ...plan,
    generatedAt: new Date().toISOString(),
    timelines: nextTimelines,
  };

  const report = revalidateAdjustedPlan({
    plan: nextPlan,
    selectedRoutes: args.selectedRoutes,
    minimumRecoveryTimeSeconds: args.minimumRecoveryTimeSeconds,
    intervals: args.intervals,
    attributes: args.attributes,
  });

  return { plan: nextPlan, report };
}
