import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export enum MaintenanceTaskPublishStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export enum MaintenanceTaskUsageStatus {
  IDLE = 'idle',
  IN_USE = 'in_use',
}

@Entity('maintenance_tasks')
@Index('IDX_MAINTENANCE_TASK_USAGE', ['usageStatus'])
@Index('IDX_MAINTENANCE_TASK_PUBLISH', ['publishStatus'])
export class MaintenanceTask {
  @PrimaryColumn({ type: 'varchar', name: 'task_id' })
  id: string;

  @Column({ name: 'name' })
  name: string;

  @Column({
    type: 'varchar',
    name: 'publish_status',
    default: MaintenanceTaskPublishStatus.DRAFT,
  })
  publishStatus: MaintenanceTaskPublishStatus;

  @Column({
    type: 'varchar',
    name: 'usage_status',
    default: MaintenanceTaskUsageStatus.IDLE,
  })
  usageStatus: MaintenanceTaskUsageStatus;

  @Column({ type: 'jsonb', default: {} })
  body: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
