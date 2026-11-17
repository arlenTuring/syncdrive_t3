import type { BadgeTone } from '../../components/ui';

export type PublishStatusKey = 'draft' | 'published';

export type UsageStatusKey = 'idle' | 'in_use';

export type MaintenanceTaskListItem = {
  task_id: string;
  name: string;
  publish_status: PublishStatusKey;
  publish_status_label: string;
  usage_status: UsageStatusKey;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

export const USAGE_STATUS_OPTIONS: Array<{ value: UsageStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '選擇使用狀態' },
  { value: 'in_use', label: '使用中' },
  { value: 'idle', label: '閒置中' },
];

export const PUBLISH_STATUS_OPTIONS: Array<{ value: PublishStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'published', label: '已發布' },
  { value: 'draft', label: '草稿區' },
];

/** 狀態標籤的語意（顏色由設計系統決定，見 components/ui 的 BadgeTone） */
export const USAGE_TAG_TONE: Record<UsageStatusKey, BadgeTone> = {
  in_use: 'success',
  idle: 'inactive',
};

export const PUBLISH_TAG_TONE: Record<PublishStatusKey, BadgeTone> = {
  published: 'theme',
  draft: 'inactive',
};
