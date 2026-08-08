/**
 * 排班引擎驗收閘門與問題展示分層（P0）。
 *
 * 硬閘（ok / gatePassed）：不可有任何 severity=error。
 * 品質目標（qualityPassed）：不阻擋 ok，但應用來判斷「是否還有可接受的殘留警告」。
 * 策略說明：正常求解日誌，預設摺疊、不計入失敗。
 */

import {
  resolveFeasibilityIssueMeta,
  type FeasibilityIssueKind,
} from './schedule-engine/feasibilityIssueMeta';
import type {
  FeasibilityIssue,
  FeasibilityViolationCode,
  ShiftScheduleFeasibilityReport,
} from './schedule-engine/types';

/** 展示層：硬錯誤 → 極限警告 → 可調警告 → 策略說明 */
export type IssueDisplayLayer = 'hard' | 'limit' | 'actionable' | 'policy';

export const ISSUE_DISPLAY_LAYER_ORDER: IssueDisplayLayer[] = [
  'hard',
  'limit',
  'actionable',
  'policy',
];

export const ISSUE_DISPLAY_LAYER_LABEL: Record<IssueDisplayLayer, string> = {
  hard: '硬錯誤（阻擋驗收）',
  limit: '演算法極限警告',
  actionable: '可調整警告',
  policy: '策略說明（不阻擋驗收）',
};

/**
 * 允許殘留、不擋硬閘的警告代號。
 * 肩段漏脈衝／班距略低屬品質目標，不是硬失敗。
 */
export const NON_BLOCKING_WARNING_CODES: ReadonlySet<FeasibilityViolationCode> =
  new Set([
    'STATION_BERTH_DELAYED',
    'STATION_BERTH_BACKUP_USED',
    'MAINTENANCE_DISPATCH_UNREACHABLE',
    'HEADWAY_BELOW_TARGET',
    'UNSERVED_SERVICE_PULSE',
    'INSUFFICIENT_TIMELINES',
    'ROUTE_ROTATION_OVER_TURNAROUND',
    'STATION_LEG_TRAVEL_INCOMPLETE',
  ]);

/** 策略噪音：預設摺疊 */
export const POLICY_NOISE_CODES: ReadonlySet<FeasibilityViolationCode> = new Set([
  'STATION_BERTH_DELAYED',
  'STATION_BERTH_BACKUP_USED',
  'MAINTENANCE_DISPATCH_UNREACHABLE',
]);

/** 品質目標不通過時要清零的警告 */
export const QUALITY_BLOCKING_WARNING_CODES: ReadonlySet<FeasibilityViolationCode> =
  new Set(['UNSERVED_SERVICE_PULSE', 'HEADWAY_BELOW_TARGET']);

/**
 * 安全閘：<strong>不擋生成、不擋編輯，但擋發布</strong>。
 *
 * 這一層放的是「物理上做不到／有行車安全疑慮」的問題，
 * 跟 <code>QUALITY_BLOCKING_WARNING_CODES</code>（服務品質沒達標）本質不同：
 * 班距差 40 秒是可以接受後再調的，
 * 但「一個停靠點同時停 3 台車」不是品質差，是<strong>做不到</strong>。
 *
 * 之所以不擋生成：班表產得出來使用者才看得到問題、才能手動改。
 * 擋在發布這一關，既不會讓人對著空白畫面，也不會讓不安全的班表上線。
 */
export const PUBLISH_BLOCKING_CODES: ReadonlySet<FeasibilityViolationCode> =
  new Set([
    'STATION_BERTH_COLLISION',
    'STATION_BERTH_PROTECTION_GAP',
  ]);

/** 常見硬錯誤代號（文件／報表用；實際硬閘以 severity=error 為準） */
export const DOCUMENTED_HARD_ERROR_CODES: readonly FeasibilityViolationCode[] = [
  'STATION_BERTH_COLLISION',
  'ROTATION_CYCLE_INCOMPLETE',
  'TIMELINE_OVERLAP',
  'ANCHOR_CONFLICT',
  'ROUTE_SUCCESSOR_MISMATCH',
  'ROUTE_STATION_DISCONTINUITY',
  'CLOCK_ALIGN_VIOLATION',
  'MISSING_TEMPLATE_TASKS',
  'NO_ROUTE_FOR_TASK_TYPE',
  'MISSING_TRAVEL_TIME',
  'STATION_TIMING_INFEASIBLE',
  'HEADWAY_PHYSICAL_IMPOSSIBLE',
  'RECOVERY_INSUFFICIENT',
  'ROUTE_SWITCH_BUFFER_INSUFFICIENT',
  'ROUTE_SUCCESSOR_POLICY_INVALID',
  'ROUTE_INSTANCE_AMBIGUOUS',
  'TURNAROUND_LIMIT_EXCEEDED',
];

export const ACCEPTANCE_CRITERIA_LINES = [
  '硬閘（ok=true）：errors 必須為 0（含站位碰撞、未跑完迴圈、時間線重疊等）。',
  '警告不阻擋硬閘：策略延後／改線、略過進場載客、班距低於目標、肩段未承接脈衝。',
  '品質目標（qualityPassed）：另要求 0×UNSERVED_SERVICE_PULSE 與 0×HEADWAY_BELOW_TARGET；未達標仍可 ok=true。',
  '策略說明預設摺疊，不計入「失敗體感」主列表。',
] as const;

export type ScheduleAcceptanceSummary = {
  /** 與 report.ok 語意對齊：無任何 error */
  gatePassed: boolean;
  hardErrorCount: number;
  hardErrorsByCode: Record<string, number>;
  /** 無未承接脈衝、無班距低於目標 */
  qualityPassed: boolean;
  qualityFailByCode: Record<string, number>;
  /**
   * 安全閘：沒有任何站位重疊／碰撞保護不足。
   * false 時班表仍可編輯、可儲存，但<strong>不建議發布</strong>。
   */
  publishSafe: boolean;
  publishBlockingCount: number;
  publishBlockingByCode: Record<string, number>;
  policyNoiseCount: number;
  limitWarningCount: number;
  actionableWarningCount: number;
  warningCount: number;
  criteria: readonly string[];
};

function countByCode(issues: FeasibilityIssue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const issue of issues) {
    out[issue.code] = (out[issue.code] ?? 0) + 1;
  }
  return out;
}

export function resolveIssueDisplayLayer(
  severity: 'error' | 'warning',
  kind: FeasibilityIssueKind,
  code: FeasibilityViolationCode,
): IssueDisplayLayer {
  if (severity === 'error') return 'hard';
  if (kind === 'policy' || POLICY_NOISE_CODES.has(code)) return 'policy';
  if (kind === 'limit') return 'limit';
  return 'actionable';
}

export function resolveIssueDisplayLayerFromIssue(
  issue: Pick<FeasibilityIssue, 'code' | 'severity' | 'kind'>,
): IssueDisplayLayer {
  const meta = resolveFeasibilityIssueMeta(issue);
  return resolveIssueDisplayLayer(issue.severity, meta.kind, issue.code);
}

export function layerSortKey(layer: IssueDisplayLayer): number {
  return ISSUE_DISPLAY_LAYER_ORDER.indexOf(layer);
}

/** 硬閘：與產生器／重驗證一致 */
export function computeScheduleGateOk(errors: FeasibilityIssue[]): boolean {
  return errors.length === 0;
}

export function evaluateScheduleAcceptance(
  report: Pick<ShiftScheduleFeasibilityReport, 'errors' | 'warnings' | 'ok'>,
): ScheduleAcceptanceSummary {
  const hardErrorsByCode = countByCode(report.errors);
  const qualityFailIssues = report.warnings.filter((issue) =>
    QUALITY_BLOCKING_WARNING_CODES.has(issue.code),
  );
  const qualityFailByCode = countByCode(qualityFailIssues);

  let policyNoiseCount = 0;
  let limitWarningCount = 0;
  let actionableWarningCount = 0;
  for (const issue of report.warnings) {
    const layer = resolveIssueDisplayLayerFromIssue(issue);
    if (layer === 'policy') policyNoiseCount += 1;
    else if (layer === 'limit') limitWarningCount += 1;
    else actionableWarningCount += 1;
  }

  const gatePassed = computeScheduleGateOk(report.errors);
  const publishBlockingIssues = [...report.errors, ...report.warnings].filter(
    (issue) => PUBLISH_BLOCKING_CODES.has(issue.code),
  );

  return {
    gatePassed,
    publishSafe: publishBlockingIssues.length === 0,
    publishBlockingCount: publishBlockingIssues.length,
    publishBlockingByCode: countByCode(publishBlockingIssues),
    hardErrorCount: report.errors.length,
    hardErrorsByCode,
    qualityPassed: qualityFailIssues.length === 0,
    qualityFailByCode,
    policyNoiseCount,
    limitWarningCount,
    actionableWarningCount,
    warningCount: report.warnings.length,
    criteria: ACCEPTANCE_CRITERIA_LINES,
  };
}
