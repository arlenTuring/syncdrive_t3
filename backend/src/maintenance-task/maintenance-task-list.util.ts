import {
  MaintenanceTask,
  MaintenanceTaskPublishStatus,
  MaintenanceTaskUsageStatus,
} from '../database/entities/maintenance-task.entity';

export const UNTITLED_MAINTENANCE_TASK_NAME = '未完成的整備任務';

export type MaintenanceTaskListItem = {
  task_id: string;
  name: string;
  publish_status: MaintenanceTaskPublishStatus;
  publish_status_label: string;
  usage_status: MaintenanceTaskUsageStatus;
  usage_status_label: string;
  created_at: string;
  updated_at: string;
};

export function formatMaintenanceTaskTimestamp(ms: string | number | null | undefined): string {
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

export function maintenanceUsageStatusLabel(status: MaintenanceTaskUsageStatus): string {
  return status === MaintenanceTaskUsageStatus.IN_USE ? '使用中' : '閒置中';
}

export function maintenancePublishStatusLabel(status: MaintenanceTaskPublishStatus): string {
  return status === MaintenanceTaskPublishStatus.PUBLISHED ? '已發布' : '草稿區';
}

export function toMaintenanceTaskListItem(row: MaintenanceTask): MaintenanceTaskListItem {
  return {
    task_id: row.id,
    name: row.name,
    publish_status: row.publishStatus,
    publish_status_label: maintenancePublishStatusLabel(row.publishStatus),
    usage_status: row.usageStatus,
    usage_status_label: maintenanceUsageStatusLabel(row.usageStatus),
    created_at: formatMaintenanceTaskTimestamp(row.createdAt),
    updated_at: formatMaintenanceTaskTimestamp(row.updatedAt),
  };
}
