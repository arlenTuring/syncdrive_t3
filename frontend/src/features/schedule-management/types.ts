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
  | 'trajectory'
  | 'vehicle-realtime'
  | 'system-foundation'
  | 'account-management'
  | 'role-management';

export type ShellNavItem = {
  id: ShellView;
  label: string;
  enabled: boolean;
  requiredPermission?: string;
};

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
  { id: 'virtual-fence', label: 'nav.items.virtual-fence', enabled: true, requiredPermission: 'operations.virtual-fence.view' },
  { id: 'dispatch-scheduling', label: 'nav.items.dispatch-scheduling', enabled: true, requiredPermission: 'operations.dispatch.view' },
  { id: 'psd-control', label: 'nav.items.psd-control', enabled: true, requiredPermission: 'operations.psd-control.view' },
];

export function isOperationsView(view: string): boolean {
  return OPERATIONS_NAV_ITEMS.some((item) => item.id === view);
}

/** 場域管理模組子選單（對齊 TP13C 場域管理） */
export const SITE_NAV_ITEMS: ShellNavItem[] = [
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
  { id: 'trajectory', label: 'nav.items.trajectory', enabled: true, requiredPermission: 'vehicle.trajectory.view' },
];

export const PERMISSION_NAV_ITEMS: ShellNavItem[] = [
  { id: 'account-management', label: '帳號管理中心', enabled: true, requiredPermission: 'access.accounts.view' },
  { id: 'role-management', label: '角色管理設定', enabled: true, requiredPermission: 'access.roles.view' },
];

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
  { id: 'media', label: 'nav.modules.media', enabled: false },
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
  [...OPERATIONS_NAV_ITEMS, ...SITE_NAV_ITEMS, ...SCHEDULE_NAV_ITEMS, ...VEHICLE_NAV_ITEMS, ...PERMISSION_NAV_ITEMS]
    .filter((item) => item.requiredPermission).map((item) => [item.id, item.requiredPermission!]),
);
VIEW_PERMISSIONS.dashboard = 'dashboard.dashboard.view';
VIEW_PERMISSIONS['system-foundation'] = 'system.health.view';
