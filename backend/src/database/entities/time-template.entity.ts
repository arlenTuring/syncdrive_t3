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

  /**
   * 舊欄位，已不使用（2026-11-28 使用者：時間模板只是一份規劃，沒有草稿／發布之分）。
   * 留在資料表裡只為了不動資料庫結構（本機 synchronize 會刪掉沒對應的欄位、正式環境由 migrate.sh 管）；
   * 程式不讀也不寫，畫面與 API 都不出現。
   */
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
