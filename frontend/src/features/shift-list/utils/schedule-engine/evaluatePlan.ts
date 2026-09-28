import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { TimeSlotAttribute, TimeSlotInterval } from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
} from '../stationBerthOccupancy';
import type { RouteSuccessorPolicy } from './routeSuccessorPolicy';
import type { FeasibilityIssue, GeneratedSchedulePlan } from './types';
import {
  validateFacilityOccupancy,
  validateMoveJunctionConflicts,
  validatePassengerHeadway,
  validateRotationCyclesComplete,
  validateRouteSwitchBuffers,
  validateStationTimingsWithinBlocks,
  validateTimelineOverlaps,
  validateVehicleLocationContinuity,
  validateYardExitContinuity,
} from './validate';

/**
 * 候選評估與最終驗證共用的限制檢查
 * ==============================
 *
 * 候選版面要跟最終班表用<strong>同一套</strong>限制比較，不能只比錯誤總數——修掉一筆
 * 卻在別處新增一筆，總數一樣但班表並沒有變好。這裡把每一種違反轉成一個「簽章」：
 * 代號＋資源＋牽涉的卡片，比較兩份版面時看的是「多了哪些簽章、少了哪些」。
 *
 * 全部走既有驗證器（站位直接取未截斷的配對清單），不另寫一套規則。
 */

export type ViolationSeverity =
  /** 物理上做不到：時間線重疊、站位／設施實體重疊、缺移動、換線不足、逐站時間塞不下… */
  | 'hard'
  /** 安全間隔不足：碰撞保護、設施交接、轉折點間隔 */
  | 'safety'
  /** 服務品質：班距低於目標 */
  | 'quality';

export type PlanViolation = {
  /** 代號＋資源＋牽涉卡片；兩份版面用它比對「同一個問題」 */
  key: string;
  code: string;
  severity: ViolationSeverity;
  /** 資源（站、設施、轉折點、時間線） */
  resource: string;
  /** 牽涉的卡片 id（排序後） */
  blockIds: string[];
  /** 嚴重程度（重疊秒數、差多少秒）；越大越糟 */
  magnitude: number;
};

export type PlanEvaluationContext = {
  selectedRoutes: ShiftScheduleSelectedRoute[];
  routeById: Map<string, ShiftScheduleSelectedRoute>;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  successorPolicy?: RouteSuccessorPolicy;
  minimumRecoveryTimeSeconds: number;
  collisionProtectionSeconds: number;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  scheduleRowCount: number;
  topology?: PointTopology | null;
  /** 整備類型 → 車可能停的出場站；給了才檢查整備出場站接續 */
  yardExitStationOptionsByTaskType?: Partial<Record<string, string[]>>;
};

const SAFETY_CODES = new Set(['FACILITY_HANDOVER_GAP', 'MOVE_JUNCTION_CONFLICT']);

function issueBlockIds(issue: FeasibilityIssue): string[] {
  const detail = (issue.detail ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  for (const field of ['blockId', 'earlierBlockId', 'laterBlockId', 'fromBlockId', 'previousBlockId', 'nextBlockId']) {
    const value = detail[field];
    if (typeof value === 'string' && value) ids.add(value);
  }
  return [...ids].sort();
}

function issueResource(issue: FeasibilityIssue): string {
  const detail = (issue.detail ?? {}) as Record<string, unknown>;
  for (const field of ['facilityNodeId', 'nodeId', 'stationId', 'routeId']) {
    const value = detail[field];
    if (typeof value === 'string' && value) return value;
  }
  const row = detail.timelineRow;
  return typeof row === 'number' ? `row-${row}` : '';
}

function issueMagnitude(issue: FeasibilityIssue): number {
  const detail = (issue.detail ?? {}) as Record<string, unknown>;
  for (const field of ['deficitSeconds', 'shortfallSeconds', 'protectionShortfallSeconds', 'worstShortfallSeconds', 'overlapSeconds']) {
    const value = detail[field];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  }
  const gap = detail.gapSeconds;
  return typeof gap === 'number' ? Math.max(0, -gap) : 1;
}

/** 將報告中的同一筆問題按資源與班次比對，不能只比較總筆數。 */
export function violationFromIssue(issue: FeasibilityIssue, severity: ViolationSeverity): PlanViolation {
  const blockIds = issueBlockIds(issue);
  const resource = issueResource(issue);
  return { key: `${issue.code}|${resource}|${blockIds.join('+')}`, code: issue.code,
    severity, resource, blockIds, magnitude: issueMagnitude(issue) };
}

export function collectPlanViolations(
  ctx: PlanEvaluationContext,
  timelines: GeneratedSchedulePlan['timelines'],
): PlanViolation[] {
  const out: PlanViolation[] = [];
  const push = (issue: FeasibilityIssue, severity: ViolationSeverity) => {
    out.push(violationFromIssue(issue, severity));
  };
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];

  validateTimelineOverlaps(timelines, errors);
  validateStationTimingsWithinBlocks(timelines, ctx.selectedRoutes, errors);
  validateFacilityOccupancy(timelines, errors, {
    collisionProtectionSeconds: ctx.collisionProtectionSeconds,
    warnings,
  });
  validateVehicleLocationContinuity({ timelines, selectedRoutes: ctx.selectedRoutes, errors });
  validateMoveJunctionConflicts({
    timelines,
    topology: ctx.topology,
    collisionProtectionSeconds: ctx.collisionProtectionSeconds,
    warnings,
  });
  validateRouteSwitchBuffers(
    timelines,
    ctx.routeById,
    errors,
    ctx.minimumRecoveryTimeSeconds,
    ctx.passengerRoutes,
    ctx.successorPolicy,
  );
  validateRotationCyclesComplete(timelines, ctx.passengerRoutes.length, errors);
  if (ctx.yardExitStationOptionsByTaskType) {
    validateYardExitContinuity({
      timelines,
      selectedRoutes: ctx.selectedRoutes,
      yardExitStationOptionsByTaskType: ctx.yardExitStationOptionsByTaskType,
      errors,
    });
  }
  validatePassengerHeadway(
    timelines.flatMap((timeline) => timeline.blocks),
    ctx.intervals,
    ctx.attributes,
    ctx.routeById,
    errors,
    warnings,
    ctx.scheduleRowCount,
  );

  // 驗證器記成 error 的一律是硬限制
  for (const issue of errors) push(issue, 'hard');
  for (const issue of warnings) {
    if (SAFETY_CODES.has(issue.code)) push(issue, 'safety');
    else if (issue.code === 'HEADWAY_BELOW_TARGET') push(issue, 'quality');
  }

  // 站位：直接取未截斷、逐對的清單（報告器會彙總成一站一則，拿來比對會失真）
  const occupancies = collectStationBerthOccupancies(timelines, ctx.selectedRoutes, {
    collisionProtectionSeconds: ctx.collisionProtectionSeconds,
  });
  for (const hit of findStationBerthCollisions(occupancies, ctx.selectedRoutes)) {
    const blockIds = [hit.earlier.blockId, hit.later.blockId].sort();
    const code = hit.kind === 'overlap' ? 'STATION_BERTH_COLLISION' : 'STATION_BERTH_PROTECTION_GAP';
    out.push({
      key: `${code}|${hit.stationId}|${blockIds.join('+')}`,
      code,
      severity: hit.kind === 'overlap' ? 'hard' : 'safety',
      resource: hit.stationId,
      blockIds,
      magnitude: hit.kind === 'overlap' ? hit.overlapSeconds : hit.protectionShortfallSeconds,
    });
  }
  return out;
}

const SEVERITY_RANK: Record<ViolationSeverity, number> = { hard: 0, safety: 1, quality: 2 };

export type ViolationComparison = {
  /** 候選比原本好（硬限制與安全都沒有新增、至少少了一筆或變輕） */
  better: boolean;
  /** 候選新增的硬錯誤／安全問題（非空就不能採用） */
  introduced: PlanViolation[];
  /** 同一筆硬錯誤／安全問題比原本更嚴重。 */
  worsened: PlanViolation[];
  /** 可保留原有問題，但不能增加或惡化安全問題。 */
  safeToAdopt: boolean;
  resolved: PlanViolation[];
  /** 依嚴重度的數量：[硬, 安全, 品質] */
  countsBefore: [number, number, number];
  countsAfter: [number, number, number];
};

function counts(list: PlanViolation[]): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (const item of list) result[SEVERITY_RANK[item.severity]] += 1;
  return result;
}

/**
 * 候選 vs 原本：不能修一筆、在別處生一筆。
 *
 * 採用條件：沒有新增任何硬錯誤或安全簽章；硬錯誤、安全問題的數量都不增加；
 * 至少解掉一筆或同一筆變輕。品質（班距）只在安全層打平時才拿來比。
 */
export function compareViolations(
  before: PlanViolation[],
  after: PlanViolation[],
): ViolationComparison {
  const beforeKeys = new Map(before.map((item) => [item.key, item] as const));
  const afterKeys = new Map(after.map((item) => [item.key, item] as const));
  const introduced = after.filter(
    (item) => item.severity !== 'quality' && !beforeKeys.has(item.key),
  );
  const resolved = before.filter((item) => !afterKeys.has(item.key));
  const countsBefore = counts(before);
  const countsAfter = counts(after);
  const worsened = after.filter((item) => {
    if (item.severity === 'quality') return false;
    const previous = beforeKeys.get(item.key);
    return previous != null && (
      SEVERITY_RANK[item.severity] < SEVERITY_RANK[previous.severity]
      || item.magnitude > previous.magnitude + 1e-6
    );
  });
  const safeToAdopt = introduced.length === 0 && worsened.length === 0
    && countsAfter[0] <= countsBefore[0] && countsAfter[1] <= countsBefore[1];
  let better = false;
  if (safeToAdopt) {
    if (countsAfter[0] < countsBefore[0] || countsAfter[1] < countsBefore[1]) {
      better = true;
    } else {
      // 同數量：看同一筆有沒有變輕，再看品質
      let lighter = false;
      let heavier = false;
      for (const item of after) {
        if (item.severity === 'quality') continue;
        const previous = beforeKeys.get(item.key);
        if (!previous) continue;
        if (item.magnitude < previous.magnitude - 1e-6) lighter = true;
        if (item.magnitude > previous.magnitude + 1e-6) heavier = true;
      }
      better = (lighter && !heavier) || (!heavier && countsAfter[2] < countsBefore[2]);
    }
  }
  return { better, introduced, worsened, safeToAdopt, resolved, countsBefore, countsAfter };
}
