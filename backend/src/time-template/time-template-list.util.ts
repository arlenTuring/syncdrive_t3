import {
  TimeTemplate,
  TimeTemplatePublishStatus,
  TimeTemplateUsageStatus,
} from '../database/entities/time-template.entity';

export type TimeTemplateListItem = {
  template_id: string;
  name: string;
  publish_status: TimeTemplatePublishStatus;
  publish_status_label: string;
  usage_status: TimeTemplateUsageStatus;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

export function formatTemplateTimestamp(ms: string | number | null | undefined): string {
  if (ms == null || ms === '') return '—';
  const n = Number(ms);
  if (!Number.isFinite(n)) return '—';
  const d = new Date(n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${hh}:${mm}`;
}

export function publishStatusLabel(status: TimeTemplatePublishStatus): string {
  return status === TimeTemplatePublishStatus.PUBLISHED ? '已發布' : '草稿區';
}

export function usageStatusLabel(status: TimeTemplateUsageStatus): string {
  return status === TimeTemplateUsageStatus.IN_USE ? '使用中' : '閒置中';
}

export function toTimeTemplateListItem(row: TimeTemplate): TimeTemplateListItem {
  return {
    template_id: row.id,
    name: row.name,
    publish_status: row.publishStatus,
    publish_status_label: publishStatusLabel(row.publishStatus),
    usage_status: row.usageStatus,
    usage_status_label: usageStatusLabel(row.usageStatus),
    created_at: formatTemplateTimestamp(row.createdAt),
    updated_at: formatTemplateTimestamp(row.updatedAt),
  };
}
