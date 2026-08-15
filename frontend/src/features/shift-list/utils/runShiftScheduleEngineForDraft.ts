import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import {
  fetchTimeTemplateDetail,
} from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { resolveStrictestTurnaroundLimitSeconds } from '../../time-templates/utils/turnaroundLimitSegments';
import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../map-editor/types/area';
import type { ShiftScheduleCreateDraft } from '../types/create';
import { buildMaintenanceFirstTripOriginsFromTopology } from './maintenanceFirstTripOrigins';
import {
  buildScheduleEngineLogPayload,
  postScheduleEngineLog,
} from './scheduleEngineLog';
import { buildScheduleEngineLastIssuesSnapshot } from './scheduleEngineLastIssues';
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
    try {
      const status = await fetchMapLibraryBackendStatus();
      mapId = status?.activeMapId
        ? resolveMapId(status.activeMapId)
        : 't3-main-version';
    } catch {
      mapId = 't3-main-version';
    }
  }

  let firstTripOrigins = buildMaintenanceFirstTripOriginsFromTopology(
    emptyPointTopology(),
  );
  let pointTopology = emptyPointTopology();
  let areas: MapAreaObject[] = [];
  try {
    const mapDocument = await resolveParsedMapForPlatform(mapId);
    pointTopology = mapDocument?.pointTopology ?? emptyPointTopology();
    areas = mapDocument?.areas ?? [];
    firstTripOrigins = buildMaintenanceFirstTripOriginsFromTopology(pointTopology);
  } catch (mapError) {
    console.warn('[schedule-engine] 地圖拓樸載入失敗，改用空首班起點', mapError);
  }

  const engineInput = {
    shiftId,
    draft,
    templateBody,
    maintenanceTaskBody,
    turnaroundLimitSeconds,
    passengerTimetableMode: 'template' as const,
    firstTripOrigins,
    // 這兩個先前漏掉——整備轉場卡（入廠/出廠/整備間轉場）全靠這兩個欄位才會
    // 動起來，漏傳等於這整套機制在正式產生班表時從來沒有真正跑過。
    pointTopology,
    areas,
  };

  /**
   * 開發輔助：把<strong>完整引擎輸入</strong>原封不動寫成 log 檔，供本機重放。
   *
   * 為什麼需要：排班引擎的問題幾乎都只在真實資料上才顯形，但過去只有「輸出」
   * （問題清單）留下來，沒有輸入。要查一個回歸就只能改一版、請使用者重新生成
   * 一次、看截圖再猜下一版——2026-08-15 追 ANCHOR_CONFLICT 時連續猜了三版都沒中，
   * 每一版都燒掉使用者一次手動生成。
   *
   * 有了這個檔就能在本機把同一份輸入重放任意次，開關功能、加 log、逐段比對，
   * 完全不必再麻煩使用者。寫檔失敗只 console.warn，不影響生成。
   *
   * 檔案落點：backend/logs/schedule-engine/{timestamp}-engine-input.json
   */
  void postScheduleEngineLog({
    label: 'engine-input',
    payload: engineInput,
    backendUrl: backendUrl ?? '',
    // 輸入被截成摘要就失去重放的意義，這裡放寬上限。
    // 對齊後端 main.ts 的 REQUEST_BODY_LIMIT（預設 10mb），超過會被 413 擋掉。
    maxBytes: 9_000_000,
  });

  const result = generateShiftSchedule(engineInput);

  // 開發輔助：每次生成把輸入摘要與完整報錯寫成 log 檔（fire-and-forget）。
  // lastIssues 另會覆寫 .dev JSON＋審核 HTML「最近一次生成」區塊。
  const lastIssues = buildScheduleEngineLastIssuesSnapshot({
    draft,
    result,
    shiftId,
  });
  void postScheduleEngineLog({
    label: shiftId || 'draft',
    payload: {
      ...buildScheduleEngineLogPayload({
        draft,
        result,
        firstTripOrigins,
        maintenanceBody: maintenanceTaskBody,
        mapId,
        shiftId,
        intervals: parsed.intervals,
        attributes: parsed.attributes,
      }),
      lastIssues,
    },
    backendUrl: backendUrl ?? '',
  });

  return result;
}
