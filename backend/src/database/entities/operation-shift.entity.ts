import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export enum OperationShiftPublishStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export enum OperationShiftUsageStatus {
  IDLE = 'idle',
  IN_USE = 'in_use',
}

@Entity('operation_shifts')
@Index('IDX_OPERATION_SHIFT_USAGE', ['usageStatus'])
@Index('IDX_OPERATION_SHIFT_PUBLISH', ['publishStatus'])
export class OperationShift {
  @PrimaryColumn({ type: 'varchar', name: 'shift_id' })
  id: string;

  @Column({ name: 'name' })
  name: string;

  @Column({
    type: 'varchar',
    name: 'publish_status',
    default: OperationShiftPublishStatus.DRAFT,
  })
  publishStatus: OperationShiftPublishStatus;

  @Column({
    type: 'varchar',
    name: 'usage_status',
    default: OperationShiftUsageStatus.IDLE,
  })
  usageStatus: OperationShiftUsageStatus;

  @Column({ type: 'jsonb', default: {} })
  body: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
