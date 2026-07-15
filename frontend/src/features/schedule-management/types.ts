export type ScheduleSubView =
  | 'shift-records'
  | 'time-templates'
  | 'shift-list'
  | 'maintenance-tasks';

export type ScheduleNavItem = {
  id: ScheduleSubView;
  label: string;
  enabled: boolean;
};

export const SCHEDULE_NAV_ITEMS: ScheduleNavItem[] = [
  { id: 'shift-records', label: '班次運行紀錄', enabled: true },
  { id: 'time-templates', label: '時間模板管理', enabled: true },
  { id: 'shift-list', label: '班表清單管理', enabled: true },
  { id: 'maintenance-tasks', label: '整備任務管理', enabled: true },
];

export type ScheduleModuleGroup = {
  id: string;
  label: string;
  enabled: boolean;
  items?: ScheduleNavItem[];
};

/** 側欄頂層模組（僅班表管理可操作，其餘對齊設計稿占位） */
export const SIDEBAR_MODULE_GROUPS: ScheduleModuleGroup[] = [
  { id: 'monitor', label: '資料監控模組', enabled: false },
  { id: 'schedule', label: '班表管理模組', enabled: true, items: SCHEDULE_NAV_ITEMS },
  { id: 'operations', label: '營運管理模組', enabled: false },
  { id: 'vehicle', label: '車輛管理模組', enabled: false },
  { id: 'site', label: '場域管理模組', enabled: false },
  { id: 'service', label: '服務管理模組', enabled: false },
  { id: 'media', label: '媒體管理模組', enabled: false },
];
