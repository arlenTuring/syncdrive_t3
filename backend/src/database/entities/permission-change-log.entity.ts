import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum PermissionTargetType {
  ACCOUNT = 'ACCOUNT',
  ROLE = 'ROLE',
  PERMISSION = 'PERMISSION',
  ACCOUNT_ROLE = 'ACCOUNT_ROLE',
  ROLE_PERMISSION = 'ROLE_PERMISSION',
}

export enum PermissionChangeType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  GRANT = 'GRANT',
  REVOKE = 'REVOKE',
}

/**
 * 規格書 §後勤管理層 · 日誌管理模組 · 權限異動查詢
 * 記錄帳號、角色與功能權限之異動歷程，保留異動前後內容以供追溯。
 */
@Entity('permission_change_logs')
@Index('IDX_PERM_CHANGE_TARGET', ['targetType', 'targetId'])
@Index('IDX_PERM_CHANGE_TIME', ['createdAt'])
@Index('IDX_PERM_CHANGE_TIME_ID', ['createdAt', 'id'])
@Index('IDX_PERM_CHANGE_ACCOUNT_TIME', ['relatedAccountId', 'createdAt'])
@Index('IDX_PERM_CHANGE_OPERATOR_TIME', ['operatorId', 'createdAt'])
export class PermissionChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 執行異動的操作人員
  @Column({ name: 'operator_id', default: 'system' })
  operatorId: string;

  @Column({ type: 'enum', enum: PermissionTargetType, name: 'target_type' })
  targetType: PermissionTargetType;

  @Column({ name: 'target_id' })
  targetId: string;

  @Column({ type: 'enum', enum: PermissionChangeType, name: 'change_type' })
  changeType: PermissionChangeType;

  // 異動前內容（新增時為 null）
  @Column({ type: 'jsonb', name: 'before_value', nullable: true })
  beforeValue: any;

  // 異動後內容（刪除時為 null）
  @Column({ type: 'jsonb', name: 'after_value', nullable: true })
  afterValue: any;

  @Column({ name: 'source_ip', type: 'varchar', nullable: true })
  sourceIp: string | null;

  @Column({ name: 'operator_name_snapshot', type: 'varchar', length: 120, nullable: true })
  operatorNameSnapshot: string | null;

  @Column({ name: 'target_name_snapshot', type: 'varchar', length: 200, nullable: true })
  targetNameSnapshot: string | null;

  /** 被異動的帳號（帳號、帳號角色類）；操作者另記在 operator_id */
  @Column({ name: 'related_account_id', type: 'varchar', length: 64, nullable: true })
  relatedAccountId: string | null;

  /** 相關角色（角色、角色權限、帳號角色異動前後的角色） */
  @Column({ name: 'related_role_ids', type: 'varchar', length: 64, array: true, default: () => "'{}'" })
  relatedRoleIds: string[];

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;
}
