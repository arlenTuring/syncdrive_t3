export type PermissionDefinition = {
  code: string;
  moduleKey: string;
  module: string;
  pageKey: string;
  page: string;
  action: string;
  name: string;
  sort: number;
  requires?: string;
  connected?: boolean;
};

const pageNames = new Map<string, string>();
const permission = (
  moduleKey: string, module: string, pageKey: string,
  ...args: [page: string, action: string, name: string, sort: number, connected?: boolean] | [action: string, name: string, sort: number, connected?: boolean]
): PermissionDefinition => {
  const full = typeof args[2] === 'string';
  const page = full ? args[0] : pageNames.get(`${moduleKey}.${pageKey}`)!;
  const action = full ? args[1] : args[0];
  const name = full ? args[2] as string : args[1];
  const sort = full ? args[3] as number : args[2] as number;
  const connected = (full ? args[4] : args[3]) as boolean | undefined ?? true;
  if (full) pageNames.set(`${moduleKey}.${pageKey}`, page);
  const code = `${moduleKey}.${pageKey}.${action}`;
  return { code, moduleKey, module, pageKey, page, action, name, sort, connected, requires: action === 'view' ? undefined : `${moduleKey}.${pageKey}.view` };
};

export const ACCESS_PERMISSIONS: readonly PermissionDefinition[] = [
  permission('dashboard', '數據監控模組', 'monitor', '數據監控頁面', 'view', '檢視', 100),
  permission('dashboard', '數據監控模組', 'dashboard', '儀表板', 'view', '檢視', 110),
  permission('dashboard', '數據監控模組', 'dashboard', '儀表板', 'edit', '編輯', 111),

  permission('operations', '營運管理模組', 'shift-deployment', '班表部署管理', 'view', '檢視', 200),
  permission('operations', '營運管理模組', 'shift-deployment', 'adjust', '調整申請', 201),
  permission('operations', '營運管理模組', 'shift-deployment', 'revoke', '撤銷申請', 202),
  permission('operations', '營運管理模組', 'shift-deployment', 'review', '審核駁回', 203),
  permission('operations', '營運管理模組', 'shift-deployment', 'deploy', '部署／啟用', 204),
  permission('operations', '營運管理模組', 'degraded', '降級運轉管理', 'view', '檢視', 210),
  permission('operations', '營運管理模組', 'degraded', 'execute', '執行降級', 211),
  permission('operations', '營運管理模組', 'degraded', 'create', '新增計劃', 212),
  permission('operations', '營運管理模組', 'degraded', 'edit', '編輯計劃', 213),
  permission('operations', '營運管理模組', 'degraded', 'delete', '刪除計劃', 214),
  permission('operations', '營運管理模組', 'virtual-fence', '虛擬圍籬管理', 'view', '檢視', 220, false),
  permission('operations', '營運管理模組', 'virtual-fence', 'create', '建立', 221, false),
  permission('operations', '營運管理模組', 'virtual-fence', 'edit', '編輯', 222, false),
  permission('operations', '營運管理模組', 'virtual-fence', 'delete', '刪除', 223, false),
  permission('operations', '營運管理模組', 'dispatch', '派遣調度管理', 'view', '檢視', 230),
  permission('operations', '營運管理模組', 'dispatch', 'create', '建立', 231),
  permission('operations', '營運管理模組', 'dispatch', 'edit', '編輯', 232),
  permission('operations', '營運管理模組', 'dispatch', 'delete', '刪除', 233),
  permission('operations', '營運管理模組', 'psd-control', '月台門控制', 'view', '檢視', 240),
  permission('operations', '營運管理模組', 'psd-control', 'control', '控制', 241),
  permission('operations', '營運管理模組', 'vehicle-control', '載具控制', 'view', '檢視', 250),
  permission('operations', '營運管理模組', 'vehicle-control', 'control', '控制', 251),

  permission('schedule', '班表管理模組', 'records', '班次運行紀錄', 'view', '檢視', 300),
  permission('schedule', '班表管理模組', 'time-template', '時間模板管理', 'view', '檢視', 310),
  permission('schedule', '班表管理模組', 'time-template', 'create', '建立', 311),
  permission('schedule', '班表管理模組', 'time-template', 'edit', '編輯', 312),
  permission('schedule', '班表管理模組', 'time-template', 'duplicate', '複製', 313),
  permission('schedule', '班表管理模組', 'time-template', 'delete', '刪除', 314),
  permission('schedule', '班表管理模組', 'time-template', 'export', '匯出', 315),
  permission('schedule', '班表管理模組', 'shift-list', '班表清單管理', 'view', '檢視', 320),
  permission('schedule', '班表管理模組', 'shift-list', 'create', '建立', 321),
  permission('schedule', '班表管理模組', 'shift-list', 'edit', '編輯', 322),
  permission('schedule', '班表管理模組', 'shift-list', 'duplicate', '複製', 323),
  permission('schedule', '班表管理模組', 'shift-list', 'delete', '刪除', 324),
  permission('schedule', '班表管理模組', 'shift-list', 'publish', '發布／撤回', 325),
  permission('schedule', '班表管理模組', 'maintenance', '整備任務管理', 'view', '檢視', 330),
  permission('schedule', '班表管理模組', 'maintenance', 'create', '建立', 331),
  permission('schedule', '班表管理模組', 'maintenance', 'edit', '編輯', 332),
  permission('schedule', '班表管理模組', 'maintenance', 'duplicate', '複製', 333, false),
  permission('schedule', '班表管理模組', 'maintenance', 'delete', '刪除', 334),
  permission('schedule', '班表管理模組', 'maintenance', 'publish', '發布／撤回', 335),

  permission('vehicle', '載具管理模組', 'realtime', '即時資訊清單', 'view', '檢視', 400),
  permission('vehicle', '載具管理模組', 'log', '運行管理日誌', 'view', '檢視', 410),
  permission('vehicle', '載具管理模組', 'log', 'download', '下載', 411),
  permission('vehicle', '載具管理模組', 'registry', '載具註冊管理', 'view', '檢視', 420),
  permission('vehicle', '載具管理模組', 'registry', 'create', '建立', 421),
  permission('vehicle', '載具管理模組', 'registry', 'edit', '編輯', 422),
  permission('vehicle', '載具管理模組', 'registry', 'service-scope', '設定服務範圍', 423),
  permission('vehicle', '載具管理模組', 'registry', 'delete', '刪除', 424),
  permission('vehicle', '載具管理模組', 'trajectory', '載具軌跡圖台', 'view', '檢視', 430),
  permission('vehicle', '載具管理模組', 'trajectory', 'export', '匯出', 431),

  permission('site', '場域管理模組', 'station', '站點資訊管理', 'view', '檢視', 500),
  permission('site', '場域管理模組', 'station', 'create', '建立', 501, false),
  permission('site', '場域管理模組', 'station', 'edit', '編輯', 502, false),
  permission('site', '場域管理模組', 'station', 'duplicate', '複製', 503, false),
  permission('site', '場域管理模組', 'station', 'delete', '刪除', 504, false),
  permission('site', '場域管理模組', 'equipment', '設備資訊管理', 'view', '檢視', 510),
  permission('site', '場域管理模組', 'equipment', 'create', '建立', 511, false),
  permission('site', '場域管理模組', 'equipment', 'edit', '編輯', 512, false),
  permission('site', '場域管理模組', 'equipment', 'duplicate', '複製', 513, false),
  permission('site', '場域管理模組', 'equipment', 'delete', '刪除', 514, false),
  permission('site', '場域管理模組', 'map', '圖資資料管理', 'view', '檢視', 520),
  permission('site', '場域管理模組', 'map', 'edit', '編輯／儲存', 521),
  permission('site', '場域管理模組', 'map', 'import', '匯入', 522),
  permission('site', '場域管理模組', 'map', 'export', '匯出', 523),
  permission('site', '場域管理模組', 'map', 'publish', '發布', 524),

  permission('service', '服務管理模組', 'route', '路線任務規劃', 'view', '檢視', 600, false),
  permission('service', '服務管理模組', 'route', 'create', '建立', 601, false),
  permission('service', '服務管理模組', 'route', 'edit', '編輯', 602, false),
  permission('service', '服務管理模組', 'route', 'delete', '刪除', 603, false),
  permission('service', '服務管理模組', 'scheduled-orders', '排程訂單管理', 'view', '檢視', 610, false),
  permission('service', '服務管理模組', 'scheduled-orders', 'create', '建立', 611, false),
  permission('service', '服務管理模組', 'scheduled-orders', 'edit', '編輯', 612, false),
  permission('service', '服務管理模組', 'scheduled-orders', 'delete', '刪除', 613, false),
  permission('service', '服務管理模組', 'order-records', '訂單紀錄清單', 'view', '檢視', 620, false),

  permission('media', '媒體管理模組', 'content', '媒體內容清單', 'view', '檢視', 700),
  permission('media', '媒體管理模組', 'content', 'create', '建立', 701, false),
  permission('media', '媒體管理模組', 'content', 'edit', '編輯', 702, false),
  permission('media', '媒體管理模組', 'content', 'delete', '刪除', 703, false),
  permission('media', '媒體管理模組', 'groups', '媒體分組清單', 'view', '檢視', 710, false),
  permission('media', '媒體管理模組', 'groups', 'create', '建立', 711, false),
  permission('media', '媒體管理模組', 'groups', 'edit', '編輯', 712, false),
  permission('media', '媒體管理模組', 'groups', 'delete', '刪除', 713, false),
  permission('media', '媒體管理模組', 'schedule', '媒體排程設定', 'view', '檢視', 720, false),
  permission('media', '媒體管理模組', 'schedule', 'create', '建立', 721, false),
  permission('media', '媒體管理模組', 'schedule', 'edit', '編輯', 722, false),
  permission('media', '媒體管理模組', 'schedule', 'delete', '刪除', 723, false),
  permission('media', '媒體管理模組', 'order-records', '訂單紀錄清單', 'view', '檢視', 730, false),

  permission('events', '事件管理模組', 'events', '事件管理', 'view', '檢視', 800, false),
  permission('events', '事件管理模組', 'events', 'manage', '處理', 801, false),
  permission('events', '事件管理模組', 'events', 'export', '匯出', 802, false),

  permission('system', '系統管理模組', 'health', '系統監測狀態', 'view', '檢視', 900),
  permission('system', '系統管理模組', 'foundation', '系統基礎設定', 'view', '檢視', 910),
  permission('system', '系統管理模組', 'foundation', 'edit', '編輯', 911),
  permission('system', '系統管理模組', 'datasource', '資料來源設定', 'view', '檢視', 920),
  permission('system', '系統管理模組', 'datasource', 'manage', '管理', 921),
  permission('system', '系統管理模組', 'data-admin', '資料管理', 'view', '檢視', 930),
  permission('system', '系統管理模組', 'data-admin', 'execute', '執行查詢／異動', 931),

  permission('access', '權限管理模組', 'accounts', '帳號管理中心', 'view', '檢視', 1000),
  permission('access', '權限管理模組', 'accounts', 'manage', '管理', 1001),
  permission('access', '權限管理模組', 'roles', '角色管理設定', 'view', '檢視', 1010),
  permission('access', '權限管理模組', 'roles', 'manage', '管理', 1011),
] as const;

export const PERMISSION_BY_CODE = new Map(ACCESS_PERMISSIONS.map((item) => [item.code, item]));
export const ADMIN_PERMISSIONS = ['access.accounts.manage', 'access.roles.manage'] as const;

// shortcut: fixed development administrator, replace with deployment-generated credentials before production.
export const FIXED_ADMIN_ACCOUNT = 'syncdrive';
export const FIXED_ADMIN_PASSWORD = 'LWvG658liN1dZ25Tto';
export const FIXED_ADMIN_DISPLAY_NAME = '系統管理員';

export const SESSION_COOKIE = 'syncdrive_session';
export const CSRF_COOKIE = 'syncdrive_csrf';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}
