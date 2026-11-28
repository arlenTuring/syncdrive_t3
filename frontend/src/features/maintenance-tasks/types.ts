import type { BadgeTone } from '../../components/ui';

export type UsageStatusKey = 'idle' | 'in_use';

export type MaintenanceTaskListItem = {
  task_id: string;
  name: string;
  usage_status: UsageStatusKey;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

export const USAGE_STATUS_OPTIONS: Array<{ value: UsageStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '選擇使用狀態' },
  { value: 'in_use', label: '使用中' },
  { value: 'idle', label: '未使用' },
];

/** 狀態標籤的語意（顏色由設計系統決定，見 components/ui 的 BadgeTone） */
export const USAGE_TAG_TONE: Record<UsageStatusKey, BadgeTone> = {
  in_use: 'success',
  idle: 'inactive',
};

