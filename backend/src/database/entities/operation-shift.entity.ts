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

  /**
   * 舊欄位，已不使用（2026-11-28 使用者：班表只有使用中／未使用，沒有草稿／發布）。
   * 留在資料表裡只為了不動資料庫結構（本機 synchronize 會刪掉沒對應的欄位、正式環境由 migrate.sh 管）；
   * 程式不讀也不寫。部署前的排班安全檢查在 deployShift。
   */
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
