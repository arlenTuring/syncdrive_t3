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
  | 'system-foundation';

export type ShellNavItem = {
  id: ShellView;
  label: string;
  enabled: boolean;
};

/** @deprecated use ShellView — kept for schedule subviews */
export type ScheduleSubView =
  | 'shift-records'
  | 'time-templates'
  | 'shift-list'
  | 'maintenance-tasks';

export type ScheduleNavItem = ShellNavItem;

export const OPERATIONS_NAV_ITEMS: ShellNavItem[] = [
  { id: 'shift-deployment', label: 'nav.items.shift-deployment', enabled: true },
  { id: 'degraded-operation', label: 'nav.items.degraded-operation', enabled: false },
  { id: 'dispatch-scheduling', label: 'nav.items.dispatch-scheduling', enabled: true },
  { id: 'psd-control', label: 'nav.items.psd-control', enabled: true },
];

export function isOperationsView(view: string): boolean {
  return OPERATIONS_NAV_ITEMS.some((item) => item.id === view);
}

/** 場域管理模組子選單（對齊 TP13C 場域管理） */
export const SITE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'map', label: 'nav.items.map', enabled: true },
  { id: 'virtual-fence', label: 'nav.items.virtual-fence', enabled: true },
];

export function isSiteView(view: string): boolean {
  return SITE_NAV_ITEMS.some((item) => item.id === view);
}

export const SCHEDULE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'shift-records', label: 'nav.items.shift-records', enabled: true },
  { id: 'time-templates', label: 'nav.items.time-templates', enabled: true },
  { id: 'shift-list', label: 'nav.items.shift-list', enabled: true },
  { id: 'maintenance-tasks', label: 'nav.items.maintenance-tasks', enabled: true },
];

export const VEHICLE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'trajectory', label: 'nav.items.trajectory', enabled: true },
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
  { id: 'permission', label: 'nav.modules.permission', enabled: false },
];

export function isScheduleSubView(view: ShellView): view is ScheduleSubView {
  return (
    view === 'shift-records'
    || view === 'time-templates'
    || view === 'shift-list'
    || view === 'maintenance-tasks'
  );
}
