import type { AuditCategory } from '../database/entities/operator-action-log.entity';

/**
 * 操作稽核的代碼對照表：每個代碼屬於哪一類日誌、畫面上的動作名稱與目標類型。
 *
 * - SYSTEM＝系統操作紀錄（系統設定、地圖／設施、載具、媒體、儀表板、資料管理等設定面修改）。
 * - OPERATIONS＝營運操作紀錄（班表、部署／調整、派遣、路線、降級、門控、速度、指令等營運面修改）。
 * - 帳號／角色／權限異動寫在 permission_change_logs，登入登出寫在 login_logs，不在這裡重複計數。
 *
 * 內容句型：「{操作者} 對 {目標} 進行了 {label}」。
 */
export type AuditActionInfo = { category: AuditCategory; label: string; targetType: string };

const op = (label: string, targetType: string): AuditActionInfo => ({ category: 'OPERATIONS', label, targetType });
const sys = (label: string, targetType: string): AuditActionInfo => ({ category: 'SYSTEM', label, targetType });

export const AUDIT_ACTIONS = {
  // ── 既有代碼（保留原值）──
  COMMAND_DISPATCH: op('下發控制指令', 'VEHICLE'),
  ORDER_CREATE: op('建立營運任務', 'ORDER'),
  ORDER_UPDATE: op('更新營運任務進度', 'ORDER'),
  ORDER_CANCEL: op('取消營運任務', 'ORDER'),
  SPEED_LIMIT_SET: op('設定速限', 'VEHICLE'),
  DIRECTION_CHANGE: op('切換行駛方向', 'VEHICLE'),
  VEHICLE_REGISTER: sys('註冊載具', 'VEHICLE'),
  VEHICLE_UPDATE: sys('修改載具資料', 'VEHICLE'),
  VEHICLE_SERVICE_SETTING: sys('設定載具服務範圍', 'VEHICLE'),
  VEHICLE_REMOVE: sys('移除載具', 'VEHICLE'),

  // ── 營運：班表、部署、調整、派遣、降級 ──
  SHIFT_CREATE: op('建立班表', 'SHIFT'),
  SHIFT_UPDATE: op('修改班表', 'SHIFT'),
  SHIFT_DELETE: op('刪除班表', 'SHIFT'),
  SHIFT_DUPLICATE: op('複製班表', 'SHIFT'),
  SHIFT_PUBLISH: op('發布／撤回班表', 'SHIFT'),
  SHIFT_DEPLOY: op('部署班表', 'SHIFT'),
  TIME_TEMPLATE_CREATE: op('建立時間模板', 'TIME_TEMPLATE'),
  TIME_TEMPLATE_UPDATE: op('修改時間模板', 'TIME_TEMPLATE'),
  TIME_TEMPLATE_DELETE: op('刪除時間模板', 'TIME_TEMPLATE'),
  TIME_TEMPLATE_DUPLICATE: op('複製時間模板', 'TIME_TEMPLATE'),
  TIME_TEMPLATE_EXPORT: op('匯出時間模板', 'TIME_TEMPLATE'),
  MAINTENANCE_TASK_CREATE: op('建立整備任務', 'MAINTENANCE_TASK'),
  MAINTENANCE_TASK_UPDATE: op('修改整備任務', 'MAINTENANCE_TASK'),
  MAINTENANCE_TASK_DELETE: op('刪除整備任務', 'MAINTENANCE_TASK'),
  SCHEDULE_ADJUST_APPLY: op('申請班表調整', 'SCHEDULE_ADJUST'),
  SCHEDULE_ADJUST_REVIEW: op('審核班表調整', 'SCHEDULE_ADJUST'),
  SCHEDULE_ADJUST_RESOLVE: op('處理待審班表調整', 'SCHEDULE_ADJUST'),
  DISPATCH_PLAN_ADOPT: op('採用派遣日計畫', 'DISPATCH_PLAN'),
  DISPATCH_CLOCK_SET: op('調整營運時鐘', 'DISPATCH'),
  DISPATCH_ENABLE: op('切換即時派遣', 'DISPATCH'),
  ORDER_ACTION_UPDATE: op('回報站點動作結果', 'ORDER_ACTION'),
  DEGRADED_PLAN_CREATE: op('建立降級計畫', 'DEGRADED_PLAN'),
  DEGRADED_PLAN_UPDATE: op('修改降級計畫', 'DEGRADED_PLAN'),
  DEGRADED_PLAN_DELETE: op('刪除降級計畫', 'DEGRADED_PLAN'),
  DEGRADED_EXECUTE: op('執行降級運轉', 'DEGRADED_EXECUTION'),
  DEGRADED_CANCEL: op('取消降級運轉', 'DEGRADED_EXECUTION'),
  DEGRADED_PARAMETERS: op('調整降級參數', 'DEGRADED_EXECUTION'),
  DEGRADED_CONTENT: op('修改降級內容', 'DEGRADED_EXECUTION'),
  DEGRADED_RESTORE: op('解除降級運轉', 'DEGRADED_EXECUTION'),
  EVENT_ACKNOWLEDGE: op('人工確認事件', 'EVENT'),

  // ── 系統：設定、地圖、載具模型、媒體、儀表板、資料管理 ──
  SYSTEM_SETTINGS_UPDATE: sys('修改系統基礎設定', 'SYSTEM_SETTINGS'),
  SYSTEM_SSL_UPDATE: sys('更新傳輸加密憑證', 'SYSTEM_SETTINGS'),
  SYSTEM_HEALTH_THRESHOLDS: sys('修改系統監測門檻', 'SYSTEM_SETTINGS'),
  MAP_SAVE: sys('儲存圖資', 'MAP'),
  MAP_DELETE: sys('刪除圖資', 'MAP'),
  MAP_SET_ACTIVE: sys('切換啟用圖資', 'MAP'),
  MAP_ACTIVATE: sys('發布圖資', 'MAP'),
  VEHICLE_MODEL_SAVE: sys('儲存載具模型', 'VEHICLE_MODEL'),
  VEHICLE_MODEL_DELETE: sys('刪除載具模型', 'VEHICLE_MODEL'),
  VEHICLE_MODEL_MIGRATE: sys('套用載具模型遷移', 'VEHICLE_MODEL'),
  VEHICLE_MODEL_ROLLBACK: sys('還原載具模型遷移', 'VEHICLE_MODEL'),
  MAP_VEHICLE_SETTINGS_SAVE: sys('儲存地圖載具設定', 'MAP'),
  MAP_VEHICLE_SETTINGS_DELETE: sys('刪除地圖載具設定', 'MAP'),
  MEDIA_CREATE: sys('新增媒體', 'MEDIA'),
  MEDIA_UPDATE: sys('修改媒體', 'MEDIA'),
  MEDIA_DELETE: sys('刪除媒體', 'MEDIA'),
  MEDIA_GROUP_CREATE: sys('建立媒體分組', 'MEDIA_GROUP'),
  MEDIA_GROUP_UPDATE: sys('修改媒體分組', 'MEDIA_GROUP'),
  MEDIA_GROUP_MEMBERS: sys('調整媒體分組成員', 'MEDIA_GROUP'),
  MEDIA_GROUP_DELETE: sys('刪除媒體分組', 'MEDIA_GROUP'),
  MEDIA_SCHEDULE_CREATE: sys('建立媒體排程', 'MEDIA_SCHEDULE'),
  MEDIA_SCHEDULE_UPDATE: sys('修改媒體排程', 'MEDIA_SCHEDULE'),
  MEDIA_SCHEDULE_DELETE: sys('刪除媒體排程', 'MEDIA_SCHEDULE'),
  DASHBOARD_UPDATE: sys('修改儀表板', 'DASHBOARD'),
  DATASOURCE_SAVE: sys('儲存資料來源', 'DATASOURCE'),
  DATASOURCE_DELETE: sys('刪除資料來源', 'DATASOURCE'),
  DATASOURCE_SEED: sys('重建示範資料', 'DATASOURCE'),
  DATA_QUERY_EXECUTE: sys('執行資料查詢／異動', 'DATABASE'),
  DATA_CLEANUP: sys('執行歷史資料清理', 'DATA_RETENTION'),
  DATA_RETENTION_POLICY: sys('修改資料保存政策', 'DATA_RETENTION'),
  DATA_LIVE_RESET: sys('重置即時資料', 'DATABASE'),
  EVENT_EXPORT: sys('匯出事件報表', 'EVENT'),
  VIDEO_TAB_CREATE: sys('建立監控標籤', 'VIDEO_TAB'),
  VIDEO_TAB_UPDATE: sys('修改監控標籤', 'VIDEO_TAB'),
  VIDEO_TAB_DELETE: sys('刪除監控標籤', 'VIDEO_TAB'),
  VIDEO_TAB_REORDER: sys('調整監控標籤順序', 'VIDEO_TAB'),
  VIDEO_TILES_SAVE: sys('儲存監控格子設定', 'VIDEO_TAB'),
  VIDEO_SOURCE_CREATE: sys('新增影像來源', 'VIDEO_SOURCE'),
  VIDEO_SOURCE_UPDATE: sys('修改影像來源', 'VIDEO_SOURCE'),
  VIDEO_SOURCE_DELETE: sys('移除影像來源', 'VIDEO_SOURCE'),
  VIDEO_DEFAULTS_UPDATE: sys('修改影像來源全域預設', 'VIDEO_SOURCE'),
  VIDEO_DEFAULTS_APPLY: sys('批次套用影像來源', 'VIDEO_TAB'),
  VIDEO_SETTINGS_UPDATE: sys('修改影像連線範圍', 'VIDEO_SETTINGS'),
  VIDEO_STORAGE_POLICY: sys('修改錄影儲存政策', 'VIDEO_SETTINGS'),
  VIDEO_RECORDING_DELETE: sys('刪除錄影', 'VIDEO_RECORDING'),
  VIDEO_RECORDING_PROTECT: sys('保護錄影片段', 'VIDEO_RECORDING'),
  VIDEO_EXPORT: sys('下載錄影片段', 'VIDEO_RECORDING'),
  LOG_EXPORT: sys('匯出日誌', 'LOG'),
} as const satisfies Record<string, AuditActionInfo>;

export type AuditActionCode = keyof typeof AUDIT_ACTIONS;

export function auditInfo(code: string): AuditActionInfo | null {
  return (AUDIT_ACTIONS as Record<string, AuditActionInfo>)[code] ?? null;
}

export const TARGET_TYPE_LABEL: Record<string, string> = {
  VEHICLE: '載具',
  ORDER: '營運任務',
  ORDER_ACTION: '站點動作',
  SHIFT: '班表',
  TIME_TEMPLATE: '時間模板',
  MAINTENANCE_TASK: '整備任務',
  SCHEDULE_ADJUST: '班表調整',
  DISPATCH_PLAN: '派遣日計畫',
  DISPATCH: '即時派遣',
  DEGRADED_PLAN: '降級計畫',
  DEGRADED_EXECUTION: '降級運轉',
  EVENT: '事件',
  SYSTEM_SETTINGS: '系統設定',
  MAP: '圖資',
  VEHICLE_MODEL: '載具模型',
  MEDIA: '媒體',
  MEDIA_GROUP: '媒體分組',
  MEDIA_SCHEDULE: '媒體排程',
  DASHBOARD: '儀表板',
  DATASOURCE: '資料來源',
  DATABASE: '資料庫',
  DATA_RETENTION: '資料保存',
  LOG: '日誌',
  VIDEO_TAB: '監控標籤',
  VIDEO_SOURCE: '影像來源',
  VIDEO_SETTINGS: '影像設定',
  VIDEO_RECORDING: '錄影',
};

/** 稽核內容不得保存的欄位（比對小寫、去掉 _ 與 -） */
const SENSITIVE_KEYS = ['password', 'passwordhash', 'hash', 'token', 'secret', 'apikey', 'xapikey', 'cookie', 'session', 'csrf', 'authorization', 'privatekey', 'keypem', 'credential', 'credentials'];

export function isSensitiveKey(key: string) {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEYS.some((s) => k === s || k.endsWith(s));
}

/** 遞迴遮蔽敏感欄位；長字串截斷；深度與陣列長度有上限，避免整包大內容進稽核 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…（共 ${value.length} 字）` : value;
  if (typeof value !== 'object') return value;
  if (depth >= 4) return '[略]';
  if (Array.isArray(value)) {
    const head = value.slice(0, 30).map((v) => redact(v, depth + 1));
    return value.length > 30 ? [...head, `…（共 ${value.length} 項）`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = isSensitiveKey(k) ? '[已遮蔽]' : redact(v, depth + 1);
  return out;
}
