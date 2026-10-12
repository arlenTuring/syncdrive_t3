import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §後勤管理層 · 權限管理模組 · 帳號角色綁定
 * 帳號與角色之綁定關係；一個帳號可綁定多個角色。
 */
@Entity('account_roles')
@Index('IDX_ACCOUNT_ROLE', ['accountId', 'roleId'], { unique: true })
export class AccountRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  // 綁定操作人員
  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy: string | null;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;
}
