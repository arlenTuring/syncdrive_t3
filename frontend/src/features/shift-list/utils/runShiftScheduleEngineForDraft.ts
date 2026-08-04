import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import {
  fetchTimeTemplateDetail,
  resolveTimeTemplatesBackendUrl,
} from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { resolveStrictestTurnaroundLimitSeconds } from '../../time-templates/utils/turnaroundLimitSegments';
import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleCreateDraft } from '../types/create';
import { buildMaintenanceFirstTripOriginsFromTopology } from './maintenanceFirstTripOrigins';
import {
  buildScheduleEngineLogPayload,
  postScheduleEngineLog,
} from './scheduleEngineLog';
import {
  generateShiftSchedule,
  type GenerateShiftScheduleResult,
} from './shiftScheduleEngine';
import { enrichFeasibilityIssue } from './schedule-engine/feasibilityIssueMeta';

export type RunShiftScheduleEngineOptions = {
  shiftId?: string;
  backendUrl?: string;
};

/**
 * 依班表草稿拉取時間模板／整備任務 body，並使用「目前班表地圖／DB 啟用地圖」
 * 的點位拓樸抽出首班起點站後執行排班引擎。
 * 不寫入 DB；呼叫端自行決定是否將結果存入班表 body。
 *
 * 地圖相關模組採動態 import，避免 Node 單元測試經 create→output 靜態鏈結到 Vite env。
 */
export async function runShiftScheduleEngineForDraft(
  draft: ShiftScheduleCreateDraft,
  options: RunShiftScheduleEngineOptions = {},
): Promise<GenerateShiftScheduleResult> {
  const { shiftId, backendUrl } = options;

  if (!draft.timeTemplate.templateId.trim()) {
    return {
      plan: null,
      report: {
        ok: false,
        errors: [
          enrichFeasibilityIssue({
            code: 'MISSING_TEMPLATE_TASKS',
            severity: 'error',
            message: '尚未選擇時間模板',
          }),
        ],
        warnings: [],
      },
    };
  }

  const templateDetail = await fetchTimeTemplateDetail(
    draft.timeTemplate.templateId,
    backendUrl,
  );

  const templateBody = templateDetail.body ?? {};
  const parsed = parseStoredTemplateBody(templateBody);
  const turnaroundLimitSeconds = resolveStrictestTurnaroundLimitSeconds(
    parsed.tasks,
    parsed.intervals,
    parsed.attributes,
  );

  let maintenanceTaskBody: Record<string, unknown> | null = null;
  if (!draft.maintenanceTask.skipped && draft.maintenanceTask.taskId.trim()) {
    const maintenanceDetail = await fetchMaintenanceTaskDetail(
      draft.maintenanceTask.taskId,
      backendUrl,
    );
    maintenanceTaskBody = maintenanceDetail.body ?? {};
  }

  const [{ resolveMapId }, { fetchMapLibraryBackendStatus }, { resolveParsedMapForPlatform }] =
    await Promise.all([
      import('../../map-editor/constants/builtinMaps'),
      import('../../map-editor/api/mapLibraryApi'),
      import('../../map-editor/utils/mapLibraryStorage'),
    ]);

  const fromDraft = draft.routeGroups.mapId?.trim();
  let mapId = fromDraft ? resolveMapId(fromDraft) : '';
  if (!mapId) {
    const status = await fetchMapLibraryBackendStatus();
    mapId = status?.activeMapId
      ? resolveMapId(status.activeMapId)
      : 't3-main-version';
  }

  const mapDocument = await resolveParsedMapForPlatform(mapId);
  const firstTripOrigins = buildMaintenanceFirstTripOriginsFromTopology(
    mapDocument?.pointTopology ?? emptyPointTopology(),
  );

  const result = generateShiftSchedule({
    shiftId,
    draft,
    templateBody,
    maintenanceTaskBody,
    turnaroundLimitSeconds,
    passengerTimetableMode: 'template',
    firstTripOrigins,
  });

  // 開發輔助：每次生成把輸入摘要與完整報錯寫成 log 檔（fire-and-forget）。
  void postScheduleEngineLog({
    label: shiftId || 'draft',
    payload: buildScheduleEngineLogPayload({
      draft,
      result,
      firstTripOrigins,
      maintenanceBody: maintenanceTaskBody,
      mapId,
      shiftId,
    }),
    backendUrl: backendUrl ?? resolveTimeTemplatesBackendUrl(),
  });

  return result;
}
