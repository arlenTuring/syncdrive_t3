import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum NotificationLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

/**
 * 規格書 §後勤管理層 · 系統基礎模組 · 全域通知提醒
 * 系統對操作人員發出的通知。targetAccountId 為空代表全域通知。
 */
@Entity('notifications')
@Index('IDX_NOTIFICATION_TIME', ['createdAt'])
@Index('IDX_NOTIFICATION_TARGET', ['targetAccountId'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationLevel, default: NotificationLevel.INFO })
  level: NotificationLevel;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  // 發出通知的模組
  @Column({ name: 'source_module', nullable: true })
  sourceModule: string;

  // 指定接收帳號；為空代表全域通知
  @Column({ name: 'target_account_id', nullable: true })
  targetAccountId: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  // 已讀時間；未讀為 null
  @Column({ name: 'read_at', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  readAt: number;

  // 到期時間；逾期不再顯示
  @Column({ name: 'expires_at', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  expiresAt: number;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;
}
