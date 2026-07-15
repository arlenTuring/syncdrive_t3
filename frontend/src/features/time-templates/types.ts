export type PublishStatusKey = 'draft' | 'published';

export type UsageStatusKey = 'idle' | 'in_use';

export type TimeTemplateListItem = {
  template_id: string;
  name: string;
  publish_status: PublishStatusKey;
  publish_status_label: string;
  usage_status: UsageStatusKey;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

export const PUBLISH_STATUS_OPTIONS: Array<{ value: PublishStatusKey | 'all'; label: string }> = [
  { value: 'all', label: '全部發布狀態' },
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
