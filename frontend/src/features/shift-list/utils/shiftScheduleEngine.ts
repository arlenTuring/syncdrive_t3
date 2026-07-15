import type { GeneratedSchedulePlan } from './schedule-engine/types';

export function serializeGeneratedSchedulePlan(
  plan: GeneratedSchedulePlan,
): Record<string, unknown> {
  return {
    engineVersion: 1,
    shiftId: plan.shiftId,
    generatedAt: plan.generatedAt,
    scheduleRowCount: plan.scheduleRowCount,
    timelines: plan.timelines,
  };
}

export {
  generateShiftSchedule,
  type GenerateShiftScheduleInput,
} from './schedule-engine/generate';

export type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  GeneratedScheduleTimeline,
  GenerateShiftScheduleResult,
  FeasibilityIssue,
  FeasibilityViolationCode,
  ShiftScheduleFeasibilityReport,
  ShiftScheduleMaintenanceTaskBinding,
  ShiftScheduleStoredOutput,
  SchedulingContext,
} from './schedule-engine/types';
