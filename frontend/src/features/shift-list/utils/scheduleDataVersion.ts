import type { ScheduleDataCheckRecord, ShiftScheduleCreateDraft } from '../types/create';
import type { GenerateShiftScheduleInput } from './schedule-engine/generate';
import type { FeasibilityIssue } from './schedule-engine/types';

/**
 * 生成用的是「已檢查過的那一版資料」（白皮書 MAP-04）
 * ================================================
 *
 * 路線群組選地圖、改路線時，畫面立刻跑一次必要資料檢查（MAP-02／03），把結果連同
 * <strong>資料指紋</strong>存進草稿。正式生成前重新載入資料、重算指紋：跟檢查時不同
 * （地圖在地圖編輯被改過、路線或整備任務換了）就不生成，請使用者回路線群組重新檢查。
 *
 * 指紋涵蓋引擎真正會讀的資料：地圖路網拓樸與區域、選的路線（站序、停靠、站間行駛）、
 * 時間模板與整備任務內容。只比對結果，不信任任何「上次檢查過」的旗標。
 */

export type { ScheduleDataCheckRecord };

/** 草稿上決定「要檢查哪些資料」的選取內容（同步可算，不必載入地圖） */
export function resolveScheduleDataSelectionKey(draft: ShiftScheduleCreateDraft): string {
  return stableStringify({
    mapId: draft.routeGroups.mapId.trim(),
    templateId: draft.timeTemplate.templateId.trim(),
    maintenanceTaskId: draft.maintenanceTask.skipped ? null : draft.maintenanceTask.taskId.trim(),
    routes: draft.routeGroups.selectedRoutes.map((route) => routeDataOf(route)),
  });
}

/** 引擎輸入中「會被檢查的資料」的指紋 */
export function fingerprintScheduleEngineInput(input: GenerateShiftScheduleInput): string {
  return fnv1a64(stableStringify({
    mapId: input.draft.routeGroups.mapId.trim(),
    pointTopology: input.pointTopology ?? null,
    areas: input.areas ?? null,
    templateBody: input.templateBody ?? null,
    maintenanceTaskBody: input.maintenanceTaskBody ?? null,
    routes: input.draft.routeGroups.selectedRoutes.map((route) => routeDataOf(route)),
  }));
}

/**
 * 生成前的版本比對：沒有檢查紀錄、檢查沒過、選取內容換了、或資料指紋不同，都不生成。
 * 回傳 null 表示這份輸入正是檢查通過的那一版。
 */
export function verifyScheduleDataVersion(
  draft: ShiftScheduleCreateDraft,
  input: GenerateShiftScheduleInput,
): FeasibilityIssue | null {
  const record = draft.routeGroups.dataCheck ?? null;
  const issue = (message: string, reason: string): FeasibilityIssue => ({
    code: 'SCHEDULE_DATA_INCOMPLETE',
    severity: 'error',
    kind: 'actionable',
    message,
    detail: { scope: 'version', reason, mapId: draft.routeGroups.mapId },
  });
  if (!record) {
    return issue('這次選的地圖與路線還沒完成資料檢查：請回路線群組，等檢查完成且通過後再生成。', 'not-checked');
  }
  if (!record.ok) {
    return issue(
      `路線群組的資料檢查沒有通過（${record.issues.length} 項）：請依路線群組列出的項目補齊後再生成。`,
      'check-failed',
    );
  }
  if (record.selectionKey !== resolveScheduleDataSelectionKey(draft)) {
    return issue('檢查之後又換了地圖、時間模板、整備任務或路線：請回路線群組重新檢查後再生成。', 'selection-changed');
  }
  if (record.fingerprint !== fingerprintScheduleEngineInput(input)) {
    return issue(
      `地圖「${record.mapId}」或整備任務、時間模板在 ${record.checkedAt} 檢查之後被修改過，`
        + '生成用的不是檢查過的那一版：請回路線群組重新檢查後再生成。',
      'data-changed',
    );
  }
  return null;
}

function routeDataOf(route: ShiftScheduleCreateDraft['routeGroups']['selectedRoutes'][number]) {
  return {
    instanceId: route.instanceId,
    routeId: route.routeId,
    stationIds: route.stationIds,
    stationDwells: route.stationDwells,
    stationLegTravels: route.stationLegTravels,
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
  };
}

/** 物件鍵排序後序列化：同樣的資料不因鍵的順序不同而得到不同指紋 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** 64 位元 FNV-1a（兩個 32 位元半邊），只用來比對是否相同，不是安全雜湊 */
function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000193) >>> 0;
    h2 = (h2 + (h1 >>> 7)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}:${text.length}`;
}
