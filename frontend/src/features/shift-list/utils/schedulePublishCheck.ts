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
  validateStationTimingsWithinBlocks,
  validateTimelineOverlaps,
  validateVehicleLocationContinuity,
} from './schedule-engine/validate';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { resolveRouteForBlock } from './buildBlockStationDepartures';

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
 *   <tr><td>禁止發布</td><td>有站位重疊或安全間隔不足等問題</td></tr>
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
  /** 檢查當下的安全設定指紋（路線停靠、保護時間、整備代號）；見 buildSafetySettingsFingerprint */
  settingsFingerprint: string;
  /** 檢查當下的路網指紋；見 buildTopologyFingerprint */
  topologyFingerprint: string;
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
 * 不變，佔用就不同了，不能沿用舊的通過結果。一般顯示標籤不列入；目前用來識別
 * 移動路徑的 yardMoveViaLabels 仍須列入。
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
          block.travelSeconds,
          block.dwellSeconds,
          (block.yardMoveViaLabels ?? []).join(','),
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
  return 'schedule-safety-v2\n' + parts.join('\n');
}

/**
 * 安全檢查用到的設定指紋
 * ======================
 *
 * 檢查結果只對「當時的班表＋當時的設定」成立。路線停靠秒數、站序、行駛時間、換線緩衝、
 * 碰撞保護時間改了，同一份班表的站位佔用就不一樣——舊的「可發布」不能沿用。
 * 所以紀錄除了班表指紋，還要記下這些設定的指紋；任一項對不上就回到未檢查。
 */
export function buildSafetySettingsFingerprint(args: {
  selectedRoutes: ShiftScheduleSelectedRoute[];
  collisionProtectionSeconds: number | null | undefined;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): string {
  const routes = [...args.selectedRoutes]
    .map((route) => [
      route.routeId,
      (route as { instanceId?: string }).instanceId ?? '',
      (route.stationIds ?? []).join('>'),
      route.avgTravelTimeSeconds ?? '',
      route.minTravelTimeSeconds ?? '',
      route.dwellSlackSeconds ?? '',
      route.switchBufferAfterSeconds ?? '',
      (route.stationDwells ?? [])
        .map((dwell) => `${dwell.stationId}:${dwell.dwellSeconds ?? ''}:${dwell.dwellMode ?? ''}:${dwell.dwellRequired ?? ''}`)
        .join(','),
      ((route as { stationLegTravels?: Array<Record<string, unknown>> }).stationLegTravels ?? [])
        .map((leg) => `${leg.fromStationId}>${leg.toStationId}:${leg.avgTravelTimeSeconds ?? ''}:${leg.minTravelTimeSeconds ?? ''}`)
        .join(','),
    ].join('|'))
    .sort();
  const codes = Object.entries(args.sectionCodes ?? {})
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .sort();
  return [
    'schedule-safety-settings-v1',
    `protection=${args.collisionProtectionSeconds ?? ''}`,
    `codes=${codes.join(',')}`,
    ...routes,
  ].join('\n');
}

/** 路網指紋：節點種類與站碼、邊的起訖與行駛秒數（移動卡經過轉折點的時刻由它推算） */
export function buildTopologyFingerprint(topology: PointTopology | null | undefined): string {
  if (!topology) return 'topology:none';
  const nodes = topology.nodes
    .map((node) => `${node.id}:${node.kind}:${node.stationId ?? ''}`)
    .sort();
  const edges = topology.edges
    .map((edge) => `${edge.fromNodeId}>${edge.toNodeId}:${edge.avgTravelTimeSeconds ?? ''}:${edge.minTravelTimeSeconds ?? ''}`)
    .sort();
  return ['topology-v1', ...nodes, '--', ...edges].join('\n');
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

  for (const timeline of plan.timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      const route = resolveRouteForBlock(block, selectedRoutes);
      if (!route || (route.stationIds?.length ?? 0) < 2) {
        errors.push({ code: 'NO_ROUTE_FOR_TASK_TYPE', severity: 'error',
          message: `時間線 ${timeline.row}：班次缺少完整路線，無法完成安全檢查。`,
          detail: { timelineRow: timeline.row, blockId: block.id, routeId: block.routeId } });
      }
    }
  }

  validateTimelineOverlaps(plan.timelines, errors);
  validateStationTimingsWithinBlocks(plan.timelines, selectedRoutes, errors);
  if (!topology?.nodes.length && plan.timelines.some((timeline) =>
    timeline.blocks.some((block) => block.taskType === 'dispatch' && block.travelSeconds > 0))) {
    errors.push({ code: 'MISSING_TRAVEL_TIME', severity: 'error', message: '無法取得路網，尚未完成移動路徑安全檢查。' });
  }

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
    issue.severity === 'error' || PUBLISH_BLOCKING_CODES.has(issue.code),
  );
  const publishBlockingByCode: Record<string, number> = {};
  for (const issue of blockingIssues) {
    publishBlockingByCode[issue.code] =
      (publishBlockingByCode[issue.code] ?? 0) + 1;
  }

  return {
    planFingerprint: buildPlanFingerprint(plan),
    settingsFingerprint: buildSafetySettingsFingerprint({ selectedRoutes, collisionProtectionSeconds, sectionCodes }),
    topologyFingerprint: buildTopologyFingerprint(topology),
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
  /** 舊紀錄沒有這兩項：一律視為未檢查（不知道當時用的是什麼設定） */
  settingsFingerprint?: string;
  topologyFingerprint?: string;
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
    settingsFingerprint: result.settingsFingerprint,
    topologyFingerprint: result.topologyFingerprint,
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
  /**
   * 目前的設定／路網指紋。有給就要對得上；紀錄裡沒有（舊紀錄）也當未檢查。
   * 路網要非同步載入，拿不到時可以只給設定。
   */
  current?: { settingsFingerprint?: string; topologyFingerprint?: string },
): SchedulePublishState {
  if (!record || !plan) return 'unchecked';
  if (record.planFingerprint !== buildPlanFingerprint(plan)) return 'unchecked';
  if (current?.settingsFingerprint !== undefined && record.settingsFingerprint !== current.settingsFingerprint) {
    return 'unchecked';
  }
  if (current?.topologyFingerprint !== undefined && record.topologyFingerprint !== current.topologyFingerprint) {
    return 'unchecked';
  }
  return record.publishSafe && record.publishBlockingCount === 0 ? 'ready' : 'blocked';
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
  blocked: '禁止發布',
  ready: '可發布',
};
