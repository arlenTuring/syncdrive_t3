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

  /**
   * 舊欄位，已不使用（2026-11-28 使用者：整備任務只是一份規劃，沒有草稿／發布之分）。
   * 欄位留在資料表裡只為了不動資料庫結構（本機 synchronize 會刪掉沒對應的欄位、正式環境由 migrate.sh 管）；
   * 程式不讀也不寫，畫面與 API 都不出現。
   */
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
