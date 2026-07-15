import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';

export const UNTITLED_OPERATION_SHIFT_NAME = '未完成的正線班表';

export type OperationShiftListItem = {
  shift_id: string;
  name: string;
  time_template_name: string;
  version: string;
  publish_status: OperationShiftPublishStatus;
  publish_status_label: string;
  usage_status: OperationShiftUsageStatus;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

export function formatOperationShiftTimestamp(ms: string | number | null | undefined): string {
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

export function operationShiftUsageStatusLabel(status: OperationShiftUsageStatus): string {
  return status === OperationShiftUsageStatus.IN_USE ? '使用中' : '閒置中';
}

export function operationShiftPublishStatusLabel(status: OperationShiftPublishStatus): string {
  return status === OperationShiftPublishStatus.PUBLISHED ? '已發布' : '草稿區';
}

function readBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function toOperationShiftListItem(row: OperationShift): OperationShiftListItem {
  const body = row.body ?? {};
  const timeTemplateName =
    readBodyString(body, 'timeTemplateName') || readBodyString(body, 'time_template_name');
  const version = readBodyString(body, 'version');

  return {
    shift_id: row.id,
    name: row.name,
    time_template_name: timeTemplateName || '—',
    version: version || '—',
    publish_status: row.publishStatus,
    publish_status_label: operationShiftPublishStatusLabel(row.publishStatus),
    usage_status: row.usageStatus,
    usage_status_label: operationShiftUsageStatusLabel(row.usageStatus),
    created_at: formatOperationShiftTimestamp(row.createdAt),
    updated_at: formatOperationShiftTimestamp(row.updatedAt),
  };
}
