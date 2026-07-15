export type {
  ScheduleBlockSource,
  GeneratedScheduleBlock,
  FeasibilityViolationCode,
  FeasibilityIssue,
  GeneratedScheduleTimeline,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
  GenerateShiftScheduleResult,
  SchedulingContext,
  ShiftScheduleMaintenanceTaskBinding,
  ShiftScheduleStoredOutput,
  ResolvedTemplateTask,
} from './types';

export {
  pushIssue,
  minuteToSecond,
  secondToMinute,
} from './types';

export {
  SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_PERCENT,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackPercent,
  normalizeMinimumRecoveryTimeSeconds,
  applyDwellSlackSeconds,
  snapUpToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveRouteRotationMinSeconds,
  buildRouteGroupsParamsFingerprint,
} from './physics';

export {
  normalizeEngineInput,
  type EngineInput,
  type NormalizeInputArgs,
  type PassengerTimetableMode,
} from './normalizeInput';

export {
  generateDeparturesFromHeadway,
  assignDeparturesToEarliestTimeline,
  buildIntervalEndSecondByDepartureStart,
  TIMETABLE_GENERATION_ALGORITHM,
  type HeadwayDeparture,
  type TimetableGenerationAlgorithm,
} from './generateDepartures';

export {
  sortTemplateTasks,
  groupTasksByRow,
  resolveTemplateTasks,
  expandRowBlocks,
  ROUTE_ASSIGNMENT_ALGORITHM,
} from './expand';

export {
  assignPassengerRoutesConstraintGreedy,
  scoreRouteCandidate,
  type RouteAssignmentDecision,
  type RouteAssignmentAlgorithm,
} from './assignRoutes';

export {
  validateTurnaroundLimits,
  validateTimelineOverlaps,
  validatePassengerHeadway,
  validateTimelineCapacity,
  validateRouteSwitchBuffers,
} from './validate';

export {
  generateShiftSchedule,
  type GenerateShiftScheduleInput,
} from './generate';
