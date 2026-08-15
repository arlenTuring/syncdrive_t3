import type { ShiftScheduleCreateDraft } from '../types/create';
import { resolveSelectedRouteInstanceId } from '../types/create';
import type { MaintenanceFirstTripOrigin } from './maintenanceFirstTripOrigins';
import { buildYardRotationExitByTaskType } from './maintenancePostTaskPolicy';
import { resolveYardPostTaskPolicy } from './maintenancePostTaskPolicy';
import { formatScheduleClockHms } from './scheduleDayCycle';
import { evaluateScheduleAcceptance } from './scheduleAcceptance';
import type {
  FeasibilityIssue,
  GenerateShiftScheduleResult,
  GeneratedScheduleBlock,
} from './schedule-engine/types';
import type { TimeSlotAttribute, TimeSlotInterval } from '../../time-templates/types/editor';

/**
 * 排班引擎生成 log：每次按下「生成」後，把輸入摘要＋完整報錯＋各 timeline
 * 班次卡展開成 JSON，POST 給後端寫入 backend/logs/schedule-engine/。
 * 純開發輔助，寫檔失敗不影響生成流程。
 */

function formatMinuteAsClock(minute: number): string {
  return formatScheduleClockHms(minute);
}

function summarizeBlock(block: GeneratedScheduleBlock) {
  return {
    time: `${formatMinuteAsClock(block.plannedStartMinute)}~${formatMinuteAsClock(block.plannedEndMinute)}`,
    anchor: formatMinuteAsClock(block.anchorStartMinute),
    taskType: block.taskType,
    source: block.source,
    routeCode: block.routeCode ?? null,
    // debug：班距後處理（repair）用 routeId/routeInstanceId 解析路線與分組，
    // 跟 routeCode 是兩回事——之前完全沒記錄，查不出解析失敗的案例。
    routeId: block.routeId ?? null,
    routeInstanceId: block.routeInstanceId ?? null,
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
  /** 時間模板時段／屬性班距——debug 用重播（repro）需要真實班距目標，先前 log 沒帶這塊 */
  intervals?: TimeSlotInterval[];
  attributes?: TimeSlotAttribute[];
}) {
  const {
    draft,
    result,
    firstTripOrigins,
    maintenanceBody = null,
    mapId,
    shiftId,
    intervals = [],
    attributes = [],
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
        // debug：resolveRouteForBlock 用這兩個 id 對應 block.routeId／routeInstanceId，
        // 之前完全沒記錄，查不出「後處理解析不到路線、整段靜默放棄」的案例。
        routeId: route.routeId,
        routeInstanceId: resolveSelectedRouteInstanceId(route),
        routeCode: route.routeCode ?? null,
        routeName: route.routeName,
        groupName: route.groupName,
        stationCount: route.stationIds.length,
        startStationId: route.stationIds[0] ?? null,
        endStationId: route.stationIds[route.stationIds.length - 1] ?? null,
        // 只記起訖不夠：要重播「這條路線經過哪些站、佔用多久」就得要整串。
        // 幾十條路線 × 十來個站，量級不大，但少了它就沒辦法離線重跑
        // （2026-08-11 就是因為缺這個，harness 一跑就炸）。
        stationIds: route.stationIds,
        stationDwells: route.stationDwells?.map((dwell) => ({
          stationId: dwell.stationId,
          stationName: dwell.stationName,
          dwellSeconds: dwell.dwellSeconds ?? null,
          dwellMode: dwell.dwellMode ?? null,
        })) ?? [],
        avgTravelTimeSeconds: route.avgTravelTimeSeconds,
        minTravelTimeSeconds: route.minTravelTimeSeconds,
        switchBufferAfterSeconds: route.switchBufferAfterSeconds,
        dwellSlackSeconds: route.dwellSlackSeconds,
      })),
      minimumRecoveryTimeSeconds: draft.routeGroups.minimumRecoveryTimeSeconds,
      intervals: intervals.map((interval) => ({
        id: interval.id,
        attributeId: interval.attributeId,
        name: interval.name,
        startTime: interval.startTime,
        endTime: interval.endTime,
      })),
      attributes: attributes.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        headwaySeconds: attribute.headwaySeconds,
        capacityPphpd: attribute.capacityPphpd,
      })),
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
      /**
       * 關聯圖要記<strong>實際的邊</strong>，不能只記數量。
       *
       * 「這一段跑完接得到哪幾條」是排班決策的核心輸入之一——車停在備用站位
       * 卻被指派主線路線、整備出不去，成因幾乎都在這張圖上。先前只記
       * nodeCount／linkCount，遇到這類問題就查不下去，只能請使用者自己去看圖
       * （2026-08-11 連續兩次卡在這裡）。
       *
       * 邊的數量跟路線數同級（幾十條），不是會把 log 撐爆的東西。
       * 順便把 instanceId 換成看得懂的路線代號，不然一串 uuid 對不出是哪一條。
       */
      routeRelationGraph: (() => {
        const graph = draft.routeGroups.routeRelationGraph;
        const codeByInstanceId = new Map(
          draft.routeGroups.selectedRoutes.map((route) => [
            route.instanceId ?? route.routeId,
            route.routeCode ?? route.routeName ?? route.routeId,
          ] as const),
        );
        const label = (instanceId: string) =>
          codeByInstanceId.get(instanceId) ?? instanceId;
        return {
          nodeCount: graph?.nodes.length ?? 0,
          linkCount: graph?.links.length ?? 0,
          links: (graph?.links ?? []).map((link) => ({
            from: label(link.fromInstanceId),
            to: label(link.toInstanceId),
            nextKind: link.nextKind === 'secondary' ? 'secondary' : 'priority',
            fromInstanceId: link.fromInstanceId,
            toInstanceId: link.toInstanceId,
          })),
        };
      })(),
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
      acceptance: evaluateScheduleAcceptance(report),
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
    // 與 Vite proxy 對齊：優先走相對路徑，避免 localhost / 127.0.0.1 交叉造成 Failed to fetch
    const endpoint = backendUrl?.trim()
      ? `${backendUrl.replace(/\/$/, '')}/syncdrive-api/dev-log/schedule-engine`
      : '/syncdrive-api/dev-log/schedule-engine';
    const body = JSON.stringify({ label, payload });
    // 過大的 body 容易讓瀏覽器 fetch 直接 Failed to fetch；截斷 timelines 細節
    const maxBytes = 2_000_000;
    const trimmedBody =
      body.length > maxBytes
        ? JSON.stringify({
            label,
            payload: {
              truncated: true,
              reason: `payload ${body.length} bytes exceeds ${maxBytes}`,
              summary:
                payload && typeof payload === 'object'
                  ? {
                      report: (payload as { report?: unknown }).report,
                      shiftId: (payload as { shiftId?: unknown }).shiftId,
                    }
                  : null,
            },
          })
        : body;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: trimmedBody,
    });
    if (!res.ok) {
      console.warn(`[schedule-engine] 生成 log 寫檔失敗（HTTP ${res.status}）`);
      return;
    }
    const data = (await res.json()) as {
      file?: string;
      lastIssues?: { jsonFile?: string; htmlFile?: string };
    };
    if (data.file) {
      console.info(`[schedule-engine] 生成 log 已寫入 backend/${data.file}`);
    }
    if (data.lastIssues?.jsonFile) {
      console.info(
        `[schedule-engine] 最近問題快照已覆寫 ${data.lastIssues.jsonFile}` +
          (data.lastIssues.htmlFile
            ? ` → ${data.lastIssues.htmlFile}`
            : ''),
      );
    }
  } catch (error) {
    console.warn('[schedule-engine] 生成 log 寫檔失敗', error);
  }
}
