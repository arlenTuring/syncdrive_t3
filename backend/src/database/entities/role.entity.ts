import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §後勤管理層 · 權限管理模組 · 角色管理設定
 * 角色主檔。系統內建角色（isSystem）不得刪除。
 */
@Entity('roles')
@Index('IDX_ROLE_CODE', ['roleCode'], { unique: true })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 角色代號（如 ADMIN、OPERATOR、VIEWER）
  @Column({ name: 'role_code' })
  roleCode: string;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // 系統內建角色，不可刪除
  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
