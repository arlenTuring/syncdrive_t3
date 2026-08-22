import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §後勤管理層 · 系統基礎模組 · 系統參數設定
 * 系統層級可調參數。以 key/value 保存，值型別記錄於 valueType 供前端渲染。
 */
@Entity('system_settings')
@Index('IDX_SETTING_KEY', ['settingKey'], { unique: true })
export class SystemSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 參數代號（如 map.active_id、schedule.collision_protection_seconds）
  @Column({ name: 'setting_key' })
  settingKey: string;

  @Column({ type: 'jsonb', name: 'setting_value' })
  settingValue: any;

  // 值型別（string／number／boolean／json），供介面決定輸入元件
  @Column({ name: 'value_type', default: 'string' })
  valueType: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
