export type UsageStatusKey = 'idle' | 'in_use';

export type TimeTemplateListItem = {
  template_id: string;
  name: string;
  usage_status: UsageStatusKey;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

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

