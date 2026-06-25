import {
  Entity,
  Column,
  PrimaryColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum SlotStatus {
  AVAILABLE = 'AVAILABLE', // 可用（空閒）
  OCCUPIED = 'OCCUPIED', // 已佔用（車輛停放，未充電）
  CHARGING = 'CHARGING', // 充電中
  ERROR = 'ERROR', // 設備異常
  OFFLINE = 'OFFLINE', // 離線（超過心跳閾值）
}

/**
 * 格位即時狀態表
 * 由 MQTT v1/vtms/{vehicle_code}/slot/status 或場域設備訊息更新。
 * 每個 slot_id 只有一筆最新狀態（Upsert 模式）。
 *
 * Topic 格式建議：
 *   v1/facility/{zone}/slot/{slot_id}/status
 *   Payload: { slot_id, status, vehicle_code?, timestamp, ... }
 */
@Entity('slot_statuses')
@Index('IDX_SLOT_STATUS_VALUE', ['status'])
@Index('IDX_SLOT_VEHICLE', ['vehicleCode'])
export class SlotStatus_ {
  // 對應 facility_slots.slot_id
  @PrimaryColumn({ type: 'varchar', name: 'slot_id', length: 32 })
  slotId: string;

  // 即時狀態
  @Column({
    type: 'enum',
    enum: SlotStatus,
    name: 'status',
    default: SlotStatus.OFFLINE,
  })
  status: SlotStatus;

  // 佔用此格位的車輛代碼（如有）
  @Column({ name: 'vehicle_code', nullable: true, length: 64 })
  vehicleCode: string;

  // 最後更新時間（由 MQTT 訊息帶入的 timestamp, Epoch ms）
  @Column({ type: 'bigint', name: 'last_updated', nullable: true })
  lastUpdated: string;

  // 完整 MQTT payload 備份（方便除錯與追溯）
  @Column({ type: 'jsonb', name: 'raw_payload', nullable: true })
  rawPayload: Record<string, unknown>;
}
