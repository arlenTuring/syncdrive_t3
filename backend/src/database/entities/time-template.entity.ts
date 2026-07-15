import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export enum TimeTemplatePublishStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export enum TimeTemplateUsageStatus {
  IDLE = 'idle',
  IN_USE = 'in_use',
}

@Entity('time_templates')
@Index('IDX_TIME_TEMPLATE_PUBLISH', ['publishStatus'])
export class TimeTemplate {
  @PrimaryColumn({ type: 'varchar', name: 'template_id' })
  id: string;

  @Column({ name: 'name' })
  name: string;

  @Column({
    type: 'varchar',
    name: 'publish_status',
    default: TimeTemplatePublishStatus.DRAFT,
  })
  publishStatus: TimeTemplatePublishStatus;

  @Column({
    type: 'varchar',
    name: 'usage_status',
    default: TimeTemplateUsageStatus.IDLE,
  })
  usageStatus: TimeTemplateUsageStatus;

  @Column({ type: 'jsonb', default: {} })
  body: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
