import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §後勤管理層 · 權限管理模組 · 功能權限設定
 * 功能權限項目字典。每一筆對應系統中一個可授權的功能點。
 */
@Entity('permissions')
@Index('IDX_PERMISSION_CODE', ['permissionCode'], { unique: true })
@Index('IDX_PERMISSION_MODULE', ['module'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 權限代號（如 schedule.deploy、vehicle.register）
  @Column({ name: 'permission_code' })
  permissionCode: string;

  // 所屬功能模組（對應軟體分層設計之模組名稱）
  @Column()
  module: string;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;
}
