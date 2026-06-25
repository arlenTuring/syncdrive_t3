import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export enum EquipmentType {
  TRAFFIC_SIGNAL = 'TRAFFIC_SIGNAL', // 交通號誌控制器
  RSU = 'RSU', // 路側單元 (Roadside Unit)
  LANE_DETECTOR = 'LANE_DETECTOR', // 車道偵測設備
  SCADA_NODE = 'SCADA_NODE', // SCADA 節點
}

export enum EquipmentHealthStatus {
  OK = 'OK',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  OFFLINE = 'OFFLINE', // 超過心跳閾值，視為離線
}

/**
 * 規格書 §場態採集模組 (Field Equipment Status)
 * 儲存路側基礎設施的健康狀態，用於前端圖台顯示場域設備告警。
 * 注意：此表是「設備登錄主表 + 最新狀態」，歷史狀態由 TimescaleDB telemetry 類似機制擴充。
 */
@Entity('field_equipment_status')
@Index('IDX_EQUIPMENT_TYPE', ['equipmentType'])
@Index('IDX_EQUIPMENT_STATUS', ['currentStatus'])
export class FieldEquipmentStatus {
  // 設備識別碼（如 RSU-T3-01, SIGNAL-J-01）
  @PrimaryColumn({ type: 'varchar', name: 'equipment_id' })
  equipmentId: string;

  // 設備類型
  @Column({ type: 'enum', enum: EquipmentType, name: 'equipment_type' })
  equipmentType: EquipmentType;

  // 設備顯示名稱
  @Column({ name: 'display_name', nullable: true })
  displayName: string;

  // 設備安裝座標 {lat, lng}
  @Column({ type: 'jsonb', nullable: true })
  location: any;

  // 關聯的路口 ID（如果是號誌控制器或 RSU）
  @Column({ name: 'junction_id', nullable: true })
  junctionId: string;

  // 目前是否在系統中啟用（並非線上狀態）
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // 最後收到心跳的時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'last_seen_at', nullable: true })
  lastSeenAt: string;

  // 目前健康狀態
  @Column({
    type: 'enum',
    enum: EquipmentHealthStatus,
    name: 'current_status',
    default: EquipmentHealthStatus.OFFLINE,
  })
  currentStatus: EquipmentHealthStatus;

  // 當前故障碼陣列 (JSON Array of strings)
  @Column({ type: 'jsonb', name: 'fault_codes', nullable: true })
  faultCodes: string[];

  // 最後狀態更新時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'updated_at', nullable: true })
  updatedAt: string;
}
