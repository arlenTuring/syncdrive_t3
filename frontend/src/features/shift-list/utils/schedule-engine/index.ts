export type {
  ScheduleBlockSource,
  GeneratedScheduleBlock,
  FeasibilityViolationCode,
  FeasibilityIssueKind,
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
  SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
  STATION_ARRIVAL_MAX_AVG_STRETCH,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeCollisionProtectionSeconds,
  applyDwellSlackSeconds,
  resolveStationDwellMode,
  stationDwellSkipsSlack,
  applyStationDwellWithSlack,
  snapUpToClockAlignSeconds,
  snapDownToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  isStationDwellEntryComplete,
  isStationDwellRequired,
  resolveStationDwellListRole,
  formatStationDwellRoleLabel,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveInterTripGapSeconds,
  shouldIncludeRecoveryForRouteSwitch,
  resolvePassengerRouteOccupancy,
  resolveOccupancyClampedToTravelBounds,
  resolveFleetPhysicalHeadwayFloorSeconds,
  resolveRouteRotationMinSeconds,
  resolveRouteOriginStationId,
  resolveRouteTerminalStationId,
  routesShareTurnaroundStation,
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
} from './expand';

export {
  applyRotationCycleCompletion,
  buildRotationCompletionTasks,
  ROTATION_CYCLE_COMPLETION_ALGORITHM,
} from './completeRotationCycles';

export {
  assignPassengerRoutesConstraintGreedy,
  scoreRouteCandidate,
  ROUTE_ASSIGNMENT_ALGORITHM,
  type RouteAssignmentDecision,
  type RouteAssignmentAlgorithm,
} from './assignRoutes';

export {
  buildRouteSuccessorPolicy,
  resolveStartInstanceId,
  resolveNextInstanceId,
  listNextInstanceCandidates,
  estimatePolicyCycleSeconds,
  resolveLockedRotationMinSeconds,
  routeAssignmentAlgorithmId,
  rotationCompletionAlgorithmId,
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  ROUTE_SUCCESSOR_ALGORITHM_RING,
  type RouteSuccessorPolicy,
  type RouteSuccessorAlgorithm,
} from './routeSuccessorPolicy';

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
  enrichFeasibilityIssue,
  resolveFeasibilityIssueMeta,
  resolveFeasibilityIssueKind,
  type FeasibilityIssueMeta,
} from './feasibilityIssueMeta';

export {
  generateShiftSchedule,
  type GenerateShiftScheduleInput,
} from './generate';
