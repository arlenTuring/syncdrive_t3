import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum AccountStatus {
  ACTIVE = 'ACTIVE', // 啟用
  DISABLED = 'DISABLED', // 停用
  LOCKED = 'LOCKED', // 鎖定（連續登入失敗）
}

/**
 * 規格書 §後勤管理層 · 權限管理模組 · 帳號管理中心
 * 系統操作人員帳號主檔。密碼僅存雜湊值，不存明文。
 */
@Entity('accounts')
@Index('IDX_ACCOUNT_NAME', ['accountName'], { unique: true })
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 登入帳號
  @Column({ name: 'account_name' })
  accountName: string;

  // 顯示名稱
  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  // 密碼雜湊（bcrypt/argon2），不存明文
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status: AccountStatus;

  @Column({ name: 'failed_login_count', default: 0 })
  failedLoginCount: number;

  @Column({ name: 'locked_until', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  lockedUntil: number | null;

  @Column({ name: 'deleted_at', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  deletedAt: number | null;

  // 最後登入時間（Unix Epoch ms，13 位）
  @Column({ name: 'last_login_at', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  lastLoginAt: number | null;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
