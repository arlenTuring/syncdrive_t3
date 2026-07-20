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
  SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_SECONDS,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS,
  STATION_ARRIVAL_MAX_AVG_STRETCH,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
  normalizeMinimumRecoveryTimeSeconds,
  applyDwellSlackSeconds,
  snapUpToClockAlignSeconds,
  snapDownToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveInterTripGapSeconds,
  resolveFleetPhysicalHeadwayFloorSeconds,
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
  generateDirectionalDeparturesFromHeadway,
  assignDeparturesToEarliestTimeline,
  buildIntervalEndSecondByDepartureStart,
  TIMETABLE_GENERATION_ALGORITHM,
  type HeadwayDeparture,
  type DirectionalHeadwayDeparture,
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
  applyRotationCycleCompletion,
  buildRotationCompletionTasks,
  ROTATION_CYCLE_COMPLETION_ALGORITHM,
} from './completeRotationCycles';

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
  validateRotationCyclesComplete,
  resolveHeadwaySecondsAtMinute,
  resolvePairHeadwaySeconds,
} from './validate';

export {
  generateShiftSchedule,
  type GenerateShiftScheduleInput,
} from './generate';
