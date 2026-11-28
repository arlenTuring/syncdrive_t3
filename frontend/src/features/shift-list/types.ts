export type UsageStatusKey = 'idle' | 'in_use';

export type CreationModeKey = 'parametric' | 'manual';

export type OperationShiftListItem = {
  shift_id: string;
  name: string;
  time_template_name: string;
  version: string;
  creation_mode: CreationModeKey;
  creation_mode_label: string;
  usage_status: UsageStatusKey;
  usage_status_label: string;
  /** 部署前檢查狀態（站位重疊／碰撞保護） */
  publish_check_state?: PublishCheckStateKey;
  publish_check_label?: string;
  created_at: string;
  updated_at: string;
};

export type PublishCheckStateKey = 'unchecked' | 'blocked' | 'ready';

/** 檢查狀態標籤樣式：禁止部署用紅、可部署用綠、未檢查用灰 */
export const PUBLISH_CHECK_TAG_STYLE: Record<PublishCheckStateKey, StatusTagStyle> = {
  unchecked: {
    container: 'bg-surface-secondary',
    dot: 'bg-status-inactive',
  },
  blocked: {
    container: 'bg-status-error-light',
    dot: 'bg-status-error',
  },
  ready: {
    container: 'bg-status-success-light',
    dot: 'bg-status-success',
  },
};

export const PUBLISH_CHECK_LABEL: Record<PublishCheckStateKey, string> = {
  unchecked: '未檢查',
  blocked: '禁止部署',
  ready: '可部署',
};

export const CREATION_MODE_LABEL: Record<CreationModeKey, string> = {
  parametric: '參數生成',
  manual: '手動製作',
};

export const USAGE_STATUS_OPTIONS: Array<{ value: UsageStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '選擇使用狀態' },
  { value: 'in_use', label: '使用中' },
  { value: 'idle', label: '未使用' },
];

export type StatusTagStyle = {
  container: string;
  dot: string;
};

export const USAGE_TAG_STYLE: Record<UsageStatusKey, StatusTagStyle> = {
  in_use: {
    container: 'bg-status-success-light',
    dot: 'bg-status-success',
  },
  idle: {
    container: 'bg-surface-secondary',
    dot: 'bg-status-inactive',
  },
};

export const CREATION_MODE_TAG_STYLE: Record<CreationModeKey, StatusTagStyle> = {
  parametric: {
    container: 'bg-link-tonal',
    dot: 'bg-link-theme-filled',
  },
  manual: {
    container: 'bg-[rgba(245,158,11,0.2)]',
    dot: 'bg-[#F59E0B]',
  },
};
