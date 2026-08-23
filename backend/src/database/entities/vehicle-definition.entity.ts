import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §資源配置層 · 載具管理模組 · 載具註冊管理
 *
 * 載具外觀定義。以載具編輯器繪製，供圖台與車輛監控畫面呈現車輛外觀、車門位置、
 * 座位配置與狀態指示等元件。
 *
 * <strong>為什麼要有這張表。</strong>載具定義原本存在瀏覽器 localStorage
 * （syncdrive_vehicle_definitions），一個人畫好的車輛外觀別人看不到，換一台電腦
 * 就沒了。載具定義是全系統共用的呈現資產（2026-08-21）。
 */
@Entity('vehicle_definitions')
@Index('IDX_VEHICLE_DEF_KEY', ['definitionKey'], { unique: true })
export class VehicleDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 前端引用的識別碼
  @Column({ name: 'definition_key' })
  definitionKey: string;

  @Column()
  name: string;

  // 適用車型或車輛代號；為空代表通用
  @Column({ name: 'vehicle_model', nullable: true })
  vehicleModel: string;

  // 畫布尺寸（像素）
  @Column({ type: 'int', nullable: true })
  width: number;

  @Column({ type: 'int', nullable: true })
  height: number;

  // 畫布背景色
  @Column({ name: 'background_color', nullable: true })
  backgroundColor: string;

  // 載具元件樹（車體、車門、座位、狀態指示等）
  @Column({ type: 'jsonb' })
  elements: any;

  /**
   * 編輯模式下沒有即時資料時，用來讓畫面有東西可看的預覽 payload。
   * 屬於定義的一部分（跟著載具走），不是營運資料，所以存在同一列。
   */
  @Column({ name: 'preview_data', type: 'jsonb', nullable: true })
  previewData: any;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
