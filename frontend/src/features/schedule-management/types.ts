export type ShellView =
  | 'dashboard'
  | 'shift-records'
  | 'time-templates'
  | 'shift-list'
  | 'maintenance-tasks'
  | 'map'
  | 'trajectory';

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

export const SCHEDULE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'shift-records', label: '班次運行紀錄', enabled: true },
  { id: 'time-templates', label: '時間模板管理', enabled: true },
  { id: 'shift-list', label: '班表清單管理', enabled: true },
  { id: 'maintenance-tasks', label: '整備任務管理', enabled: true },
];

export const VEHICLE_NAV_ITEMS: ShellNavItem[] = [
  { id: 'trajectory', label: '載具軌跡圖台', enabled: true },
];

export type ShellModuleGroup = {
  id: string;
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
    label: '數據監控模組',
    /** 儀表板編輯器已移至側欄底部「儀表板管理」；此模組先留空待班表部署等工具 */
    enabled: false,
  },
  {
    id: 'schedule',
    label: '班表管理模組',
    enabled: true,
    items: SCHEDULE_NAV_ITEMS,
  },
  { id: 'operations', label: '營運管理模組', enabled: false },
  {
    id: 'vehicle',
    label: '載具管理模組',
    enabled: true,
    items: VEHICLE_NAV_ITEMS,
  },
  {
    id: 'site',
    label: '場域管理模組',
    enabled: true,
    navigateTo: 'map',
  },
  { id: 'service', label: '服務管理模組', enabled: false },
  { id: 'media', label: '媒體管理模組', enabled: false },
];

export function isScheduleSubView(view: ShellView): view is ScheduleSubView {
  return (
    view === 'shift-records'
    || view === 'time-templates'
    || view === 'shift-list'
    || view === 'maintenance-tasks'
  );
}
