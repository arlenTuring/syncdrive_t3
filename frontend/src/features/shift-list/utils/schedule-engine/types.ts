import type { ScheduleEngineTaskType, ScheduleTask } from '../../../time-templates/types/editor';
import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../../types/create';

export type ScheduleBlockSource = 'template_bar' | 'transition';

export type GeneratedScheduleBlock = {
  id: string;
  timelineRow: number;
  taskType: ScheduleEngineTaskType;
  label: string;
  templateTaskId?: string;
  routeId?: string;
  routeName?: string;
  routeCode?: string;
  /** 模板甘特上的發車錨點（分鐘，自 00:00 起） */
  anchorStartMinute: number;
  plannedStartMinute: number;
  plannedEndMinute: number;
  travelSeconds: number;
  dwellSeconds: number;
  source: ScheduleBlockSource;
  /** 手動製作：此班次卡各站靠站秒數（選定路線後可編輯） */
  stationDwells?: ShiftScheduleStationDwell[];
  /** 手動製作：此班次卡靠站緩衝秒數 */
  dwellSlackSeconds?: number;
};

export type FeasibilityViolationCode =
  | 'MISSING_TEMPLATE_TASKS'
  | 'NO_ROUTE_FOR_TASK_TYPE'
  | 'MISSING_TRAVEL_TIME'
  | 'STATION_LEG_TRAVEL_INCOMPLETE'
  | 'STATION_LEG_TRAVEL_INVALID'
  | 'ANCHOR_CONFLICT'
  | 'TIMELINE_OVERLAP'
  | 'HEADWAY_PHYSICAL_IMPOSSIBLE'
  | 'HEADWAY_BELOW_TARGET'
  | 'INSUFFICIENT_TIMELINES'
  | 'RECOVERY_INSUFFICIENT'
  | 'ROUTE_SWITCH_BUFFER_INSUFFICIENT'
  | 'CLOCK_ALIGN_VIOLATION'
  | 'TURNAROUND_LIMIT_EXCEEDED'
  | 'ROUTE_ROTATION_OVER_TURNAROUND'
  /** 時間線上正線未跑完路線群組一整輪（例：只跑下行未跑上行） */
  | 'ROTATION_CYCLE_INCOMPLETE';

export type FeasibilityIssue = {
  code: FeasibilityViolationCode;
  severity: 'error' | 'warning';
  message: string;
  detail?: Record<string, unknown>;
};

export type GeneratedScheduleTimeline = {
  row: number;
  blocks: GeneratedScheduleBlock[];
};

export type GeneratedSchedulePlan = {
  shiftId?: string;
  generatedAt: string;
  scheduleRowCount: number;
  timelines: GeneratedScheduleTimeline[];
  /** 路線指派算法識別碼 */
  routeAssignmentAlgorithm?: string;
  /** 時刻生成算法識別碼（headway 模式） */
  timetableGenerationAlgorithm?: string;
};

export type ShiftScheduleFeasibilityReport = {
  ok: boolean;
  errors: FeasibilityIssue[];
  warnings: FeasibilityIssue[];
};

/** Step 5 手動調整的還原／復原歷史（寫入草稿 scheduleOutput） */
export type PlanAdjustHistoryEntry = {
  plan: GeneratedSchedulePlan;
  feasibilityReport: ShiftScheduleFeasibilityReport;
};

export type GenerateShiftScheduleResult = {
  plan: GeneratedSchedulePlan | null;
  report: ShiftScheduleFeasibilityReport;
};

export type SchedulingContext = {
  shiftId?: string;
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
};

/** 班表產出時綁定的整備任務快照，供管理引擎引用 */
export type ShiftScheduleMaintenanceTaskBinding = {
  taskId: string;
  taskName: string;
  skipped: boolean;
  /** 整備任務完整 body（設施、途經點、觸發條件等） */
  body: Record<string, unknown> | null;
  /** 班表 Step 2 各整備區塊正線優先讓渡餘裕指紋，供新鮮度比對 */
  entrySlackFingerprint?: string;
  /** 班表 Step 2 各整備區塊代號指紋 */
  sectionCodeFingerprint?: string;
  publishStatus?: string;
  usageStatus?: string;
  sourceUpdatedAt?: string;
  boundAt: string;
};

/** 寫入 operation_shifts.body 的班表產出（Step 5 生成、Step 6 確認） */
export type ShiftScheduleStoredOutput = {
  outputVersion: 1;
  generatedAt: string;
  plan: GeneratedSchedulePlan | null;
  feasibilityReport: ShiftScheduleFeasibilityReport;
  maintenanceTaskBinding: ShiftScheduleMaintenanceTaskBinding;
  timeTemplateRef: {
    templateId: string;
    templateName: string;
    /** 空時段正線讓渡餘裕（秒），供新鮮度比對與引擎回放 */
    emptyIntervalMainlineSlackSeconds?: number;
  };
  routeGroupsRef: {
    mapId: string;
    selectedRouteIds: string[];
    /** 恢復時間、靠站緩衝、切換緩衝等參數指紋，供新鮮度比對 */
    paramsFingerprint?: string;
  };
  /** Step 5 還原／復原棧；與 plan 同步寫入草稿 */
  planAdjustHistory?: PlanAdjustHistoryEntry[];
  planAdjustHistoryIndex?: number;
};

export type ResolvedTemplateTask = {
  task: ScheduleTask;
  route: ShiftScheduleSelectedRoute | null;
  occupancySeconds: number;
  travelSeconds: number;
  dwellSeconds: number;
};

export function pushIssue(
  bucket: FeasibilityIssue[],
  issue: FeasibilityIssue,
): void {
  bucket.push(issue);
}

export function minuteToSecond(minute: number): number {
  return Math.round(minute * 60);
}

export function secondToMinute(second: number): number {
  return second / 60;
}
