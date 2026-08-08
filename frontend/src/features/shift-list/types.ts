export type PublishStatusKey = 'draft' | 'published';

export type UsageStatusKey = 'idle' | 'in_use';

export type CreationModeKey = 'parametric' | 'manual';

export type OperationShiftListItem = {
  shift_id: string;
  name: string;
  time_template_name: string;
  version: string;
  creation_mode: CreationModeKey;
  creation_mode_label: string;
  publish_status: PublishStatusKey;
  publish_status_label: string;
  usage_status: UsageStatusKey;
  usage_status_label: string;
  /** 發布前檢查狀態（站位重疊／碰撞保護）；與 publish_status 的草稿／已發布是兩件事 */
  publish_check_state?: PublishCheckStateKey;
  publish_check_label?: string;
  created_at: string;
  updated_at: string;
};

export type PublishCheckStateKey = 'unchecked' | 'blocked' | 'ready';

/** 檢查狀態標籤樣式：不建議發布用紅、可發布用綠、未檢查用灰 */
export const PUBLISH_CHECK_TAG_STYLE: Record<PublishCheckStateKey, StatusTagStyle> = {
  unchecked: {
    container: 'bg-zinc-800/80',
    dot: 'bg-zinc-500',
  },
  blocked: {
    container: 'bg-[rgba(239,68,68,0.2)]',
    dot: 'bg-[#EF4444]',
  },
  ready: {
    container: 'bg-[rgba(0,212,146,0.2)]',
    dot: 'bg-[#00D492]',
  },
};

export const PUBLISH_CHECK_LABEL: Record<PublishCheckStateKey, string> = {
  unchecked: '未檢查',
  blocked: '不建議發布',
  ready: '可發布',
};

export const CREATION_MODE_LABEL: Record<CreationModeKey, string> = {
  parametric: '參數生成',
  manual: '手動製作',
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

export type StatusTagStyle = {
  container: string;
  dot: string;
};

export const USAGE_TAG_STYLE: Record<UsageStatusKey, StatusTagStyle> = {
  in_use: {
    container: 'bg-[rgba(0,212,146,0.2)]',
    dot: 'bg-[#00D492]',
  },
  idle: {
    container: 'bg-zinc-800/80',
    dot: 'bg-zinc-500',
  },
};

export const PUBLISH_TAG_STYLE: Record<PublishStatusKey, StatusTagStyle> = {
  published: {
    container: 'bg-[rgba(43,127,255,0.2)]',
    dot: 'bg-[#2B7FFF]',
  },
  draft: {
    container: 'bg-zinc-800/80',
    dot: 'bg-zinc-500',
  },
};

export const CREATION_MODE_TAG_STYLE: Record<CreationModeKey, StatusTagStyle> = {
  parametric: {
    container: 'bg-[rgba(43,127,255,0.2)]',
    dot: 'bg-[#2B7FFF]',
  },
  manual: {
    container: 'bg-[rgba(245,158,11,0.2)]',
    dot: 'bg-[#F59E0B]',
  },
};
