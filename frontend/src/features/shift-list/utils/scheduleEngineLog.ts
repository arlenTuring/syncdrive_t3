import type { ShiftScheduleCreateDraft } from '../types/create';
import type { MaintenanceFirstTripOrigin } from './maintenanceFirstTripOrigins';
import { buildYardRotationExitByTaskType } from './maintenancePostTaskPolicy';
import { resolveYardPostTaskPolicy } from './maintenancePostTaskPolicy';
import type {
  FeasibilityIssue,
  GenerateShiftScheduleResult,
  GeneratedScheduleBlock,
} from './schedule-engine/types';

/**
 * 排班引擎生成 log：每次按下「生成」後，把輸入摘要＋完整報錯＋各 timeline
 * 班次卡展開成 JSON，POST 給後端寫入 backend/logs/schedule-engine/。
 * 純開發輔助，寫檔失敗不影響生成流程。
 */

function formatMinuteAsClock(minute: number): string {
  const totalSeconds = Math.round(minute * 60);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function summarizeBlock(block: GeneratedScheduleBlock) {
  return {
    time: `${formatMinuteAsClock(block.plannedStartMinute)}~${formatMinuteAsClock(block.plannedEndMinute)}`,
    anchor: formatMinuteAsClock(block.anchorStartMinute),
    taskType: block.taskType,
    source: block.source,
    routeCode: block.routeCode ?? null,
    label: block.label,
    ...(block.entryServiceSectionCode
      ? { entryServiceSectionCode: block.entryServiceSectionCode }
      : {}),
    ...(block.firstTripOriginLabel
      ? { firstTripOrigin: block.firstTripOriginLabel }
      : {}),
    id: block.id,
  };
}

function groupIssuesByCode(issues: FeasibilityIssue[]) {
  const byCode: Record<string, number> = {};
  for (const issue of issues) {
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
  }
  return byCode;
}

export function buildScheduleEngineLogPayload(args: {
  draft: ShiftScheduleCreateDraft;
  result: GenerateShiftScheduleResult;
  firstTripOrigins: MaintenanceFirstTripOrigin[];
  maintenanceBody?: Record<string, unknown> | null;
  mapId: string;
  shiftId?: string;
}) {
  const {
    draft,
    result,
    firstTripOrigins,
    maintenanceBody = null,
    mapId,
    shiftId,
  } = args;
  const { plan, report } = result;
  const body = draft.maintenanceTask.skipped ? null : maintenanceBody;

  return {
    meta: {
      loggedAt: new Date().toISOString(),
      shiftId: shiftId ?? null,
      shiftName: draft.basic.name || null,
      creationMode: draft.creationMode,
      mapId,
      templateId: draft.timeTemplate.templateId,
      templateName: draft.timeTemplate.templateName,
      maintenanceTaskId: draft.maintenanceTask.skipped
        ? null
        : draft.maintenanceTask.taskId,
      maintenanceTaskName: draft.maintenanceTask.skipped
        ? null
        : draft.maintenanceTask.taskName,
      routeAssignmentAlgorithm: plan?.routeAssignmentAlgorithm ?? null,
      timetableGenerationAlgorithm: plan?.timetableGenerationAlgorithm ?? null,
    },
    input: {
      selectedRoutes: draft.routeGroups.selectedRoutes.map((route) => ({
        executionOrder: route.executionOrder,
        routeCode: route.routeCode ?? null,
        routeName: route.routeName,
        groupName: route.groupName,
        stationCount: route.stationIds.length,
        startStationId: route.stationIds[0] ?? null,
        endStationId: route.stationIds[route.stationIds.length - 1] ?? null,
        avgTravelTimeSeconds: route.avgTravelTimeSeconds,
        minTravelTimeSeconds: route.minTravelTimeSeconds,
        switchBufferAfterSeconds: route.switchBufferAfterSeconds,
        dwellSlackSeconds: route.dwellSlackSeconds,
      })),
      minimumRecoveryTimeSeconds: draft.routeGroups.minimumRecoveryTimeSeconds,
      throughAnchors: {
        startStationIds:
          draft.routeGroups.throughAnchors?.startStationIds ?? [],
        endStationIds: draft.routeGroups.throughAnchors?.endStationIds ?? [],
        verifiedPathCount:
          draft.routeGroups.throughAnchors?.verifiedPathCount ?? 0,
        preferredThroughCycleId:
          draft.routeGroups.throughAnchors?.preferredThroughCycleId ?? null,
        hasVerifiedFingerprint: Boolean(
          draft.routeGroups.throughAnchors?.verifiedFingerprint,
        ),
      },
      routeRelationGraph: {
        nodeCount: draft.routeGroups.routeRelationGraph?.nodes.length ?? 0,
        linkCount: draft.routeGroups.routeRelationGraph?.links.length ?? 0,
      },
      emptyIntervalMainlineSlackSeconds:
        draft.timeTemplate.emptyIntervalMainlineSlackSeconds ?? null,
      maintenanceEntrySlackBySection: draft.maintenanceTask.skipped
        ? null
        : draft.maintenanceTask.entrySlackBySection,
      maintenanceSectionCodeBySection: draft.maintenanceTask.skipped
        ? null
        : draft.maintenanceTask.sectionCodeBySection,
      firstTripOrigins: firstTripOrigins.map((origin) => ({
        stationId: origin.stationId,
        label: origin.label,
        facilityLabels: origin.facilityLabels,
      })),
      yardPostTaskPolicy: {
        rotationExitByTaskType: buildYardRotationExitByTaskType({
          origins: firstTripOrigins,
          maintenanceBody: body,
        }),
        servicing: resolveYardPostTaskPolicy({
          taskType: 'servicing',
          origins: firstTripOrigins,
          maintenanceBody: body,
        }),
      },
    },
    report: {
      ok: report.ok,
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      errorsByCode: groupIssuesByCode(report.errors),
      warningsByCode: groupIssuesByCode(report.warnings),
      errors: report.errors,
      warnings: report.warnings,
    },
    plan: plan
      ? {
          generatedAt: plan.generatedAt,
          scheduleRowCount: plan.scheduleRowCount,
          timelines: plan.timelines.map((timeline) => ({
            row: timeline.row,
            blockCount: timeline.blocks.length,
            blocks: [...timeline.blocks]
              .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
              .map(summarizeBlock),
          })),
        }
      : null,
  };
}

/** 寫檔失敗只 console.warn，不打斷生成流程。 */
export async function postScheduleEngineLog(args: {
  label: string;
  payload: unknown;
  backendUrl: string;
}): Promise<void> {
  const { label, payload, backendUrl } = args;
  try {
    const res = await fetch(`${backendUrl}/syncdrive-api/dev-log/schedule-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, payload }),
    });
    if (!res.ok) {
      console.warn(`[schedule-engine] 生成 log 寫檔失敗（HTTP ${res.status}）`);
      return;
    }
    const data = (await res.json()) as { file?: string };
    if (data.file) {
      console.info(`[schedule-engine] 生成 log 已寫入 backend/${data.file}`);
    }
  } catch (error) {
    console.warn('[schedule-engine] 生成 log 寫檔失敗', error);
  }
}
