import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum LoginEventType {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
}

/**
 * 規格書 §後勤管理層 · 日誌管理模組 · 登入登出紀錄
 * 記錄帳號登入、登出及登入失敗事件，供資安稽核使用。
 */
@Entity('login_logs')
@Index('IDX_LOGIN_ACCOUNT_TIME', ['accountName', 'createdAt'])
@Index('IDX_LOGIN_EVENT', ['eventType'])
export class LoginLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 登入失敗時帳號可能不存在，故 accountId 可為空
  @Column({ name: 'account_id', nullable: true })
  accountId: string;

  @Column({ name: 'account_name' })
  accountName: string;

  @Column({ type: 'enum', enum: LoginEventType, name: 'event_type' })
  eventType: LoginEventType;

  @Column({ name: 'source_ip', nullable: true })
  sourceIp: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string;

  // 失敗原因（密碼錯誤、帳號停用、帳號鎖定等）
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string;

  @Column({
    name: 'created_at',
    type: 'bigint',
    default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  createdAt: number;
}
