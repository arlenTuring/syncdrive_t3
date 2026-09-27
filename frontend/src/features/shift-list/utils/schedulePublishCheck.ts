import type { MaintenanceSectionCodeBySection } from './maintenanceSectionCode';
import { PUBLISH_BLOCKING_CODES } from './scheduleAcceptance';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  ShiftScheduleStoredOutput,
} from './schedule-engine/types';
import {
  validateFacilityOccupancy,
  validateMoveJunctionConflicts,
  validateStationBerthCollisions,
  validateVehicleLocationContinuity,
} from './schedule-engine/validate';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';

/**
 * 班表發布前檢查
 * ==============
 *
 * 為什麼要獨立成一個可重跑的動作，而不是只在生成時算一次：
 * <strong>班表是可以手動改的</strong>。使用者看到問題之後會自己去調班次，
 * 調完之後「生成當下的那份報告」就過期了。所以檢查必須能對<strong>任何一份
 * plan</strong>重跑，包含手改過的。
 *
 * 三種狀態：
 * <table>
 *   <tr><td>未檢查</td><td>沒檢查過，或檢查後班表又被改動</td></tr>
 *   <tr><td>不建議發布</td><td>檢查有發現擋發布的問題（站位重疊／碰撞保護不足）</td></tr>
 *   <tr><td>可發布</td><td>檢查通過</td></tr>
 * </table>
 *
 * 「已被改動」靠 plan 指紋判斷，不靠時間戳——時間戳只能說「檢查比較早」，
 * 說不出「內容有沒有變」；使用者拖了一張卡又拖回原位，內容其實沒變，
 * 不該因此被判成未檢查。
 */

export type SchedulePublishCheckResult = {
  /** 檢查當下的 plan 指紋 */
  planFingerprint: string;
  /** 沒有任何擋發布的問題 */
  publishSafe: boolean;
  publishBlockingCount: number;
  publishBlockingByCode: Record<string, number>;
  /** 擋發布的問題本身，供畫面直接列出來 */
  blockingIssues: FeasibilityIssue[];
};

export type SchedulePublishState =
  /** 沒檢查過，或檢查後班表又被改動 */
  | 'unchecked'
  /** 檢查有發現擋發布的問題 */
  | 'blocked'
  /** 檢查通過 */
  | 'ready';

/**
 * plan 內容指紋：只取「排班結果本身」——哪一列、哪一張卡、起訖時刻，以及會改變
 * 實體佔用的欄位（路線、停放格位／站位、移動卡端點、停靠與緩衝）。換格或改路線但時刻
 * 不變，佔用就不同了，不能沿用舊的通過結果。改個標籤不該讓檢查失效，所以不含
 * 顯示用文字。
 */
export function buildPlanFingerprint(
  plan: GeneratedSchedulePlan | null | undefined,
): string {
  if (!plan) return '';
  const parts: string[] = [];
  for (const timeline of plan.timelines) {
    for (const block of timeline.blocks) {
      parts.push(
        [
          timeline.row,
          block.id,
          block.plannedStartMinute,
          block.plannedEndMinute,
          block.taskType,
          block.source,
          block.routeId ?? '',
          block.routeInstanceId ?? '',
          block.yardFacilityNodeId ?? '',
          block.yardFacilityStationId ?? '',
          block.yardExitFacilityNodeId ?? '',
          block.yardExitStationId ?? '',
          (block as { yardEntryFacilityNodeId?: string }).yardEntryFacilityNodeId ?? '',
          // 站內佔用由停靠與緩衝決定：卡片起訖沒變、緩衝變了，逐站時刻也變了
          block.dwellSlackSeconds ?? '',
          block.dwellSlackAdjustment?.addedSeconds ?? '',
          (block.stationDwells ?? [])
            .map((dwell) => `${dwell.stationId}:${dwell.dwellSeconds ?? ''}:${dwell.dwellMode ?? ''}:${dwell.dwellRequired ?? ''}`)
            .join(','),
        ].join('|'),
      );
    }
  }
  parts.sort();
  return parts.join('\n');
}

/**
 * 跑一次發布前檢查。
 *
 * 檢查「物理上做不到／有行車安全疑慮」的全部幾類：站位重疊與碰撞保護、設施格
 * 重疊與交接間隔、車的位置連續性（缺移動）。班距、未承接脈衝那些屬服務品質，
 * 由分析報表與既有警告呈現，不擋發布。
 */
export function runSchedulePublishCheck(args: {
  plan: GeneratedSchedulePlan;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  collisionProtectionSeconds: number;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  /** 有給才檢查移動卡轉折點（經過時刻要沿拓樸行駛秒數推算） */
  topology?: PointTopology | null;
}): SchedulePublishCheckResult {
  const { plan, selectedRoutes, collisionProtectionSeconds, sectionCodes, topology } = args;
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];

  validateStationBerthCollisions(plan.timelines, selectedRoutes, errors, {
    collisionProtectionSeconds,
    warnings,
    sectionCodes,
  });
  validateFacilityOccupancy(plan.timelines, errors, {
    collisionProtectionSeconds,
    warnings,
  });
  validateVehicleLocationContinuity({ timelines: plan.timelines, selectedRoutes, errors });
  validateMoveJunctionConflicts({
    timelines: plan.timelines,
    topology,
    collisionProtectionSeconds,
    warnings,
  });

  const blockingIssues = [...errors, ...warnings].filter((issue) =>
    PUBLISH_BLOCKING_CODES.has(issue.code),
  );
  const publishBlockingByCode: Record<string, number> = {};
  for (const issue of blockingIssues) {
    publishBlockingByCode[issue.code] =
      (publishBlockingByCode[issue.code] ?? 0) + 1;
  }

  return {
    planFingerprint: buildPlanFingerprint(plan),
    publishSafe: blockingIssues.length === 0,
    publishBlockingCount: blockingIssues.length,
    publishBlockingByCode,
    blockingIssues,
  };
}

/** 寫進 stored output 的檢查紀錄 */
export type SchedulePublishCheckRecord = {
  checkedAt: string;
  planFingerprint: string;
  publishSafe: boolean;
  publishBlockingCount: number;
  publishBlockingByCode: Record<string, number>;
};

export function toPublishCheckRecord(
  result: SchedulePublishCheckResult,
  checkedAt: string,
): SchedulePublishCheckRecord {
  return {
    checkedAt,
    planFingerprint: result.planFingerprint,
    publishSafe: result.publishSafe,
    publishBlockingCount: result.publishBlockingCount,
    publishBlockingByCode: result.publishBlockingByCode,
  };
}

/**
 * 由已存的檢查紀錄與目前的 plan 推出狀態。
 * 指紋對不上＝檢查後又被改過，一律回 unchecked（不能拿舊結論替新內容背書）。
 */
export function resolveSchedulePublishState(
  record: SchedulePublishCheckRecord | null | undefined,
  plan: GeneratedSchedulePlan | null | undefined,
): SchedulePublishState {
  if (!record || !plan) return 'unchecked';
  if (record.planFingerprint !== buildPlanFingerprint(plan)) return 'unchecked';
  return record.publishSafe ? 'ready' : 'blocked';
}

/** 直接從一筆班表產出推出狀態（清單欄位用） */
export function resolveStoredOutputPublishState(
  output: ShiftScheduleStoredOutput | null | undefined,
): SchedulePublishState {
  if (!output) return 'unchecked';
  return resolveSchedulePublishState(output.publishCheck, output.plan);
}

export const PUBLISH_STATE_LABEL: Record<SchedulePublishState, string> = {
  unchecked: '未檢查',
  blocked: '不建議發布',
  ready: '可發布',
};
