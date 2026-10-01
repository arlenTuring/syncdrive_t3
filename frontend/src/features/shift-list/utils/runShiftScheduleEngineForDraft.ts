import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import {
  fetchTimeTemplateDetail,
} from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { resolveStrictestTurnaroundLimitSeconds } from '../../time-templates/utils/turnaroundLimitSegments';
import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../map-editor/types/area';
import type { ScheduleDataCheckRecord, ShiftScheduleCreateDraft } from '../types/create';
import { buildMaintenanceFirstTripOriginsFromTopology } from './maintenanceFirstTripOrigins';
import {
  buildScheduleEngineLogPayload,
  postScheduleEngineLog,
} from './scheduleEngineLog';
import { buildScheduleEngineLastIssuesSnapshot } from './scheduleEngineLastIssues';
import { type GenerateShiftScheduleResult } from './shiftScheduleEngine';
import {
  runScheduleEngineInBackground,
  type ScheduleEngineProgress,
} from './schedule-engine/worker/runScheduleEngineInBackground';
import { enrichFeasibilityIssue } from './schedule-engine/feasibilityIssueMeta';
import { checkScheduleInputData } from './scheduleInputDataCheck';
import {
  fingerprintScheduleEngineInput,
  resolveScheduleDataSelectionKey,
  verifyScheduleDataVersion,
} from './scheduleDataVersion';
import type { GenerateShiftScheduleInput } from './schedule-engine/generate';
import type { FeasibilityIssue } from './schedule-engine/types';

export type RunShiftScheduleEngineOptions = {
  shiftId?: string;
  backendUrl?: string;
  /** 取消這次生成（換頁、按取消、開始了更新的生成） */
  signal?: AbortSignal;
  /** 生成進度（背景執行緒回報） */
  onProgress?: (progress: ScheduleEngineProgress) => void;
};

/**
 * 依班表草稿拉取時間模板／整備任務 body，並使用「目前班表地圖／DB 啟用地圖」
 * 的點位拓樸抽出首班起點站後執行排班引擎。
 * 不寫入 DB；呼叫端自行決定是否將結果存入班表 body。
 *
 * 地圖相關模組採動態 import，避免 Node 單元測試經 create→output 靜態鏈結到 Vite env。
 */
type EngineInputForDraft =
  | {
      ok: true;
      engineInput: GenerateShiftScheduleInput;
      mapId: string;
      firstTripOrigins: ReturnType<typeof buildMaintenanceFirstTripOriginsFromTopology>;
      maintenanceTaskBody: Record<string, unknown> | null;
      parsed: ReturnType<typeof parseStoredTemplateBody>;
    }
  | { ok: false; issue: FeasibilityIssue };

/**
 * 依草稿載入時間模板、整備任務與選定地圖，組成引擎輸入。正式生成與路線群組的即時檢查共用，
 * 兩邊看到的一定是同一份資料（白皮書 MAP-04「前端選單限制與正式生成入口的檢查必須一致」）。
 */
export async function buildScheduleEngineInputForDraft(
  draft: ShiftScheduleCreateDraft,
  options: { shiftId?: string; backendUrl?: string } = {},
): Promise<EngineInputForDraft> {
  const { shiftId, backendUrl } = options;
  const dataIssue = (message: string, code: FeasibilityIssue['code'] = 'SCHEDULE_DATA_INCOMPLETE'): EngineInputForDraft => ({
    ok: false,
    issue: { code, severity: 'error', kind: 'actionable', message, detail: { scope: code === 'SCHEDULE_DATA_INCOMPLETE' ? 'map' : 'selection' } },
  });

  if (!draft.timeTemplate.templateId.trim()) {
    return dataIssue('尚未選擇時間模板', 'MISSING_TEMPLATE_TASKS');
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

  const [{ resolveMapId }, { resolveParsedMapForPlatform }] =
    await Promise.all([
      import('../../map-editor/constants/builtinMaps'),
      import('../../map-editor/utils/mapLibraryStorage'),
    ]);

  /**
   * 只用使用者在路線群組選定的那一張地圖（白皮書 MAP-01）。
   *
   * 先前地圖欄位空白時會改用系統啟用地圖，再不行就退回某一張內建地圖；載入失敗則改用空路網繼續排。
   * 兩種退路都拿掉了：沒選、選的版本不存在、載入失敗，一律停在生成前講清楚，不換地圖、不用空路網。
   */
  const fromDraft = draft.routeGroups.mapId?.trim();
  if (!fromDraft) {
    return dataIssue('尚未在路線群組選擇地圖：請回路線群組選一張可用的地圖。系統不會自動改用其他地圖。');
  }
  const mapId = resolveMapId(fromDraft);
  let mapDocument: Awaited<ReturnType<typeof resolveParsedMapForPlatform>>;
  try {
    mapDocument = await resolveParsedMapForPlatform(mapId);
  } catch (mapError) {
    console.warn('[schedule-engine] 地圖載入失敗', mapError);
    return dataIssue(`路線群組選的地圖「${fromDraft}」載入失敗：請確認地圖仍存在並已發布，或回路線群組重新選擇。`);
  }
  if (!mapDocument) {
    return dataIssue(`路線群組選的地圖「${fromDraft}」找不到（可能已刪除或版本不存在）：請回路線群組重新選擇。`);
  }
  const pointTopology = mapDocument.pointTopology ?? emptyPointTopology();
  const areas: MapAreaObject[] = mapDocument.areas ?? [];
  const firstTripOrigins = buildMaintenanceFirstTripOriginsFromTopology(pointTopology);

  const engineInput: GenerateShiftScheduleInput = {
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
  return { ok: true, engineInput, mapId, firstTripOrigins, maintenanceTaskBody, parsed };
}

/**
 * 路線群組選圖／改路線當下的必要資料檢查（白皮書 MAP-02、MAP-03）。
 *
 * 跟正式生成用同一個輸入組裝與同一支 {@link checkScheduleInputData}；結果連同資料指紋存進草稿，
 * 生成前再比對一次指紋（MAP-04）。不生成、不寫 log。
 */
export async function checkDraftScheduleData(
  draft: ShiftScheduleCreateDraft,
  options: { backendUrl?: string } = {},
): Promise<ScheduleDataCheckRecord> {
  const selectionKey = resolveScheduleDataSelectionKey(draft);
  const checkedAt = new Date().toISOString();
  const built = await buildScheduleEngineInputForDraft(draft, options);
  if (!built.ok) {
    return {
      selectionKey,
      fingerprint: '',
      mapId: draft.routeGroups.mapId.trim(),
      checkedAt,
      ok: false,
      issues: [{ message: built.issue.message, scope: String(built.issue.detail?.scope ?? 'map') }],
    };
  }
  const issues = checkScheduleInputData(built.engineInput);
  return {
    selectionKey,
    fingerprint: fingerprintScheduleEngineInput(built.engineInput),
    mapId: built.mapId,
    checkedAt,
    ok: issues.length === 0,
    issues: issues.map((issue) => ({ message: issue.message, scope: String(issue.detail?.scope ?? '') })),
  };
}

export async function runShiftScheduleEngineForDraft(
  draft: ShiftScheduleCreateDraft,
  options: RunShiftScheduleEngineOptions = {},
): Promise<GenerateShiftScheduleResult> {
  const { shiftId, backendUrl } = options;

  const built = await buildScheduleEngineInputForDraft(draft, { shiftId, backendUrl });
  if (!built.ok) {
    return { plan: null, report: { ok: false, errors: [enrichFeasibilityIssue(built.issue)], warnings: [] } };
  }
  const { engineInput, mapId, firstTripOrigins, maintenanceTaskBody, parsed } = built;

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

  // 生成前的必要資料檢查（白皮書 MAP-02、MAP-03）：缺什麼就停在這裡講清楚，不帶著缺漏去排；
  // 資料齊全也要是路線群組檢查過的那一版（MAP-04），檢查後被改過就重查
  const versionIssue = verifyScheduleDataVersion(draft, engineInput);
  const dataIssues = [...checkScheduleInputData(engineInput), ...(versionIssue ? [versionIssue] : [])];
  const result: GenerateShiftScheduleResult = dataIssues.length > 0
    ? { plan: null, report: { ok: false, errors: dataIssues.map((issue) => enrichFeasibilityIssue(issue)), warnings: [] } }
    : await runScheduleEngineInBackground(engineInput, { signal: options.signal, onProgress: options.onProgress });

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
