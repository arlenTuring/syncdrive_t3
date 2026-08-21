import type { StatusTagStyle } from '../../components/StatusTag';

export type DispatchPriorityKey = 'emergency' | 'maintenance' | 'general';

export type DispatchStatusKey =
  | 'running'
  | 'pending'
  | 'pending_approval'
  | 'completed'
  | 'rejected'
  | 'withdrawn';

export type DispatchStationStop = {
  id: string;
  stationId: string;
  name: string;
  taskLabels: string[];
};

export type DispatchCreateInput = {
  dispatch_id?: string;
  dispatch_code: string;
  priority: DispatchPriorityKey;
  location: string;
  vehicle_code: string;
  exec_time: string;
  trip_minutes: number;
  stations: DispatchStationStop[];
};

export type DispatchListItem = {
  dispatch_id: string;
  dispatch_code: string;
  priority: DispatchPriorityKey;
  priority_label: string;
  location: string;
  vehicle_code: string;
  status: DispatchStatusKey;
  status_label: string;
  created_at: string;
  exec_time?: string;
  trip_minutes?: number;
  stations?: DispatchStationStop[];
};

export const PRIORITY_LABEL: Record<DispatchPriorityKey, string> = {
  emergency: '緊急派遣',
  maintenance: '維修派遣',
  general: '一般調度',
};

export const STATUS_LABEL: Record<DispatchStatusKey, string> = {
  running: '執行中',
  pending: '待執行',
  pending_approval: '待核准',
  completed: '已完成',
  rejected: '已駁回',
  withdrawn: '已撤銷',
};

export const PRIORITY_OPTIONS: Array<{ value: DispatchPriorityKey | 'all'; label: string }> = [
  { value: 'all', label: '選擇優先等級' },
  { value: 'emergency', label: PRIORITY_LABEL.emergency },
  { value: 'maintenance', label: PRIORITY_LABEL.maintenance },
  { value: 'general', label: PRIORITY_LABEL.general },
];

export const STATUS_OPTIONS: Array<{ value: DispatchStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '選擇派遣狀態' },
  { value: 'running', label: STATUS_LABEL.running },
  { value: 'pending', label: STATUS_LABEL.pending },
  { value: 'pending_approval', label: STATUS_LABEL.pending_approval },
  { value: 'completed', label: STATUS_LABEL.completed },
  { value: 'rejected', label: STATUS_LABEL.rejected },
  { value: 'withdrawn', label: STATUS_LABEL.withdrawn },
];

export const DISPATCH_STATUS_TAG_STYLE: Record<DispatchStatusKey, StatusTagStyle> = {
  running: {
    container: 'bg-[rgba(43,127,255,0.2)]',
    dot: 'bg-[#2B7FFF]',
  },
  pending: {
    container: 'bg-[rgba(153,161,175,0.2)]',
    dot: 'bg-[#99A1AF]',
  },
  pending_approval: {
    container: 'bg-[rgba(251,146,60,0.2)]',
    dot: 'bg-[#FB923C]',
  },
  completed: {
    container: 'bg-[rgba(0,212,146,0.2)]',
    dot: 'bg-[#00D492]',
  },
  rejected: {
    container: 'bg-[rgba(239,68,68,0.2)]',
    dot: 'bg-[#EF4444]',
  },
  withdrawn: {
    container: 'bg-[rgba(153,161,175,0.2)]',
    dot: 'bg-[#99A1AF]',
  },
};

export const PRIORITY_SORT_ORDER: Record<DispatchPriorityKey, number> = {
  emergency: 0,
  maintenance: 1,
  general: 2,
};

export const STATUS_SORT_ORDER: Record<DispatchStatusKey, number> = {
  running: 0,
  pending: 1,
  pending_approval: 2,
  completed: 3,
  rejected: 4,
  withdrawn: 5,
};

/** 可撤銷：待核准、待執行 */
export function isDispatchRevocable(status: DispatchStatusKey): boolean {
  return status === 'pending_approval' || status === 'pending';
}
