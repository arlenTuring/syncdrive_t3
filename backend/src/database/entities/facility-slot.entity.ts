import {
  Entity,
  Column,
  PrimaryColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum FacilityType {
  CHARGING_STATION = 'CHARGING_STATION', // 充電格
  PARKING = 'PARKING', // 停車格
  GENERAL = 'GENERAL', // 一般場域格位
}

/**
 * 場域設施格位主表（靜態定義）
 * 描述場域中各個實體格位（如充電樁格位 E1~E4），
 * 供前端 SlotGrid 元件進行可視化。
 * 即時狀態由 SlotStatus 表維護。
 */
@Entity('facility_slots')
@Index('IDX_FACILITY_ZONE', ['zone'])
@Index('IDX_FACILITY_TYPE', ['facilityType'])
export class FacilitySlot {
  // 格位識別碼（如 'E1', 'E2', 'CS-01'）
  @PrimaryColumn({ type: 'varchar', name: 'slot_id', length: 32 })
  slotId: string;

  // 設施類型
  @Column({
    type: 'enum',
    enum: FacilityType,
    name: 'facility_type',
    default: FacilityType.GENERAL,
  })
  facilityType: FacilityType;

  // 所在區域（如 'Zone-A', 'B2F', '東側充電區'）
  @Column({ name: 'zone', nullable: true, length: 64 })
  zone: string;

  // 顯示名稱（用於前端標籤，如 'E1 充電格'）
  @Column({ name: 'display_name', nullable: true, length: 128 })
  displayName: string;

  // 格位容量（通常為 1，特殊場合可能 > 1）
  @Column({ name: 'capacity', type: 'int', default: 1 })
  capacity: number;

  // 是否在系統中啟用
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // 說明文字（如設備規格、注意事項）
  @Column({ type: 'text', nullable: true })
  description: string;

  // 建立時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'created_at', nullable: true })
  createdAt: string;

  // 最後更新時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'updated_at', nullable: true })
  updatedAt: string;
}
