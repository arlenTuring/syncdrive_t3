export type ShellView =
  | 'dashboard'
  | 'shift-deployment'
  | 'degraded-operation'
  | 'dispatch-scheduling'
  | 'psd-control'
  | 'virtual-fence'
  | 'shift-records'
  | 'time-templates'
  | 'shift-list'
  | 'maintenance-tasks'
  | 'map'
  | 'vehicle-realtime'
  | 'vehicle-run-history'
  | 'vehicle-registry'
  | 'media-content'
  | 'media-groups'
  | 'media-schedule'
  | 'event-list'
  | 'event-history'
  | 'video-monitor'
  | 'video-resources'
  /** @deprecated 舊的歷史影像頁；現在導向影像資源管理 */
  | 'video-history'
  | 'log-system'
  | 'log-permissions'
  | 'log-operations'
  | 'log-authentication'
  | 'system-foundation'
  | 'account-management'
  | 'role-management';

export type ShellNavItem = {
  id: ShellView;
  label: string;
  enabled: boolean;
  /** 需要的權限；用 `|` 分隔表示「任一即可」 */
  requiredPermission?: string;
};

/** 權限需求是否滿足（`a|b` 表示任一即可） */
export const permissionSatisfied = (required: string, has: (permission: string) => boolean) => required.split('|').some((p) => has(p.trim()));

/** @deprecated use ShellView — kept for schedule subviews */
export type ScheduleSubView =
  | 'shift-records'
  | 'time-templates'
  | 'shift-list'
  | 'maintenance-tasks';

export type ScheduleNavItem = ShellNavItem;

export const OPERATIONS_NAV_ITEMS: ShellNavItem[] = [
  { id: 'shift-deployment', label: 'nav.items.shift-deployment', enabled: true, requiredPermission: 'operations.shift-deployment.view' },
  { id: 'degraded-operation', label: 'nav.items.degraded-operation', enabled: true, requiredPermission: 'operations.degraded.view' },
  { id: 'dispatch-scheduling', label: 'nav.items.dispatch-scheduling', enabled: true, requiredPermission: 'operations.dispatch.view' },
  { id: 'psd-control', label: 'nav.items.psd-control', enabled: true, requiredPermission: 'operations.psd-control.view' },
];

export function isOperationsView(view: string): boolean {
  return OPERATIONS_NAV_ITEMS.some((item) => item.id === view);
}

/** 場域管理模組子選單（對齊 TP13C 場域管理：虛擬圍籬管理、圖資資料管理） */
export const SITE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'virtual-fence', label: 'nav.items.virtual-fence', enabled: true, requiredPermission: 'site.virtual-fence.view' },
  { id: 'map', label: 'nav.items.map', enabled: true, requiredPermission: 'site.map.view' },
];

export function isSiteView(view: string): boolean {
  return SITE_NAV_ITEMS.some((item) => item.id === view);
}

export const SCHEDULE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'shift-records', label: 'nav.items.shift-records', enabled: true, requiredPermission: 'schedule.records.view' },
  { id: 'time-templates', label: 'nav.items.time-templates', enabled: true, requiredPermission: 'schedule.time-template.view' },
  { id: 'shift-list', label: 'nav.items.shift-list', enabled: true, requiredPermission: 'schedule.shift-list.view' },
  { id: 'maintenance-tasks', label: 'nav.items.maintenance-tasks', enabled: true, requiredPermission: 'schedule.maintenance.view' },
];

export const VEHICLE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'vehicle-realtime', label: '載具即時清單', enabled: true, requiredPermission: 'vehicle.realtime.view' },
  { id: 'vehicle-run-history', label: '運行管理紀錄', enabled: true, requiredPermission: 'vehicle.log.view' },
  { id: 'vehicle-registry', label: '載具註冊管理', enabled: true, requiredPermission: 'vehicle.registry.view' },
];

export const PERMISSION_NAV_ITEMS: ShellNavItem[] = [
  { id: 'account-management', label: '帳號管理中心', enabled: true, requiredPermission: 'access.accounts.view' },
  { id: 'role-management', label: '角色管理設定', enabled: true, requiredPermission: 'access.roles.view' },
];

export const MEDIA_NAV_ITEMS: ShellNavItem[] = [
  { id: 'media-content', label: 'nav.items.media-content', enabled: true, requiredPermission: 'media.content.view' },
  { id: 'media-groups', label: 'nav.items.media-groups', enabled: true, requiredPermission: 'media.groups.view' },
  { id: 'media-schedule', label: 'nav.items.media-schedule', enabled: true, requiredPermission: 'media.schedule.view' },
];

export const EVENTS_NAV_ITEMS: ShellNavItem[] = [
  { id: 'event-list', label: 'nav.items.event-list', enabled: true, requiredPermission: 'events.events.view' },
  { id: 'event-history', label: 'nav.items.event-history', enabled: true, requiredPermission: 'events.events.view' },
  { id: 'video-monitor', label: 'nav.items.video-monitor', enabled: true, requiredPermission: 'events.video.view' },
  // 來源設定、儲存錄影、歷史錄影都在這裡；只有歷史權限的人也看得到（只能進歷史）
  { id: 'video-resources', label: 'nav.items.video-resources', enabled: true, requiredPermission: 'events.video.configure|events.video.recording-manage|events.video-history.view' },
];

export const LOGS_NAV_ITEMS: ShellNavItem[] = [
  { id: 'log-system', label: 'nav.items.log-system', enabled: true, requiredPermission: 'logs.system.view' },
  { id: 'log-permissions', label: 'nav.items.log-permissions', enabled: true, requiredPermission: 'logs.permissions.view' },
  { id: 'log-operations', label: 'nav.items.log-operations', enabled: true, requiredPermission: 'logs.operations.view' },
  { id: 'log-authentication', label: 'nav.items.log-authentication', enabled: true, requiredPermission: 'logs.authentication.view' },
];

export function isEventsView(view: string): boolean {
  return EVENTS_NAV_ITEMS.some((item) => item.id === view);
}

export function isLogsView(view: string): boolean {
  return LOGS_NAV_ITEMS.some((item) => item.id === view);
}

export type ShellModuleGroup = {
  id: string;
  /** i18n key；使用者自訂別名不經由此欄 */
  label: string;
  enabled: boolean;
  /** 無子選單時，點擊頂層直接導向此畫面 */
  navigateTo?: ShellView;
  items?: ShellNavItem[];
};

/** @deprecated use ShellModuleGroup */
export type ScheduleModuleGroup = ShellModuleGroup;

/** VTMS 側欄模組 */
export const SIDEBAR_MODULE_GROUPS: ShellModuleGroup[] = [
  {
    id: 'monitor',
    label: 'nav.modules.monitor',
    enabled: false,
  },
  {
    id: 'schedule',
    label: 'nav.modules.schedule',
    enabled: true,
    items: SCHEDULE_NAV_ITEMS,
  },
  {
    id: 'operations',
    label: 'nav.modules.operations',
    enabled: true,
    items: OPERATIONS_NAV_ITEMS,
  },
  {
    id: 'vehicle',
    label: 'nav.modules.vehicle',
    enabled: true,
    items: VEHICLE_NAV_ITEMS,
  },
  {
    id: 'site',
    label: 'nav.modules.site',
    enabled: true,
    items: SITE_NAV_ITEMS,
  },
  { id: 'service', label: 'nav.modules.service', enabled: false },
  { id: 'media', label: 'nav.modules.media', enabled: true, items: MEDIA_NAV_ITEMS },
  { id: 'events', label: 'nav.modules.events', enabled: true, items: EVENTS_NAV_ITEMS },
  { id: 'logs', label: 'nav.modules.logs', enabled: true, items: LOGS_NAV_ITEMS },
  // 系統基礎模組只從右上角齒輪進入，側欄不另設入口
  { id: 'permission', label: 'nav.modules.permission', enabled: true, items: PERMISSION_NAV_ITEMS },
];

export function isScheduleSubView(view: ShellView): view is ScheduleSubView {
  return (
    view === 'shift-records'
    || view === 'time-templates'
    || view === 'shift-list'
    || view === 'maintenance-tasks'
  );
}

export const VIEW_PERMISSIONS: Partial<Record<ShellView, string>> = Object.fromEntries(
  [...OPERATIONS_NAV_ITEMS, ...SITE_NAV_ITEMS, ...SCHEDULE_NAV_ITEMS, ...VEHICLE_NAV_ITEMS, ...MEDIA_NAV_ITEMS, ...EVENTS_NAV_ITEMS, ...LOGS_NAV_ITEMS, ...PERMISSION_NAV_ITEMS]
    .filter((item) => item.requiredPermission).map((item) => [item.id, item.requiredPermission!]),
);
VIEW_PERMISSIONS.dashboard = 'dashboard.dashboard.view';
// 舊的歷史影像頁導向影像資源管理，權限沿用
VIEW_PERMISSIONS['video-history'] = VIEW_PERMISSIONS['video-resources'];
VIEW_PERMISSIONS['system-foundation'] = 'system.health.view';
