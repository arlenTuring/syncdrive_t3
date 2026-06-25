import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum SpeedLimitType {
  TEMPORARY = 'TEMPORARY', // 臨時限速（中心端即時下達）
  SEGMENT = 'SEGMENT', // 區段固定速限（依路段設定）
  SCHEDULED = 'SCHEDULED', // 排程時段速限（依時間設定）
}

/**
 * 規格書 §臨時限速下達 & §區段/排程速限
 * 儲存所有速限設定的主表，區別於 command_logs（那是下發指令的紀錄）
 * 這是「設定本身」的來源，車端啟動時可查詢此表取得目前適用速限。
 */
@Entity('speed_limit_configs')
@Index('IDX_SPEEDLIMIT_ACTIVE_VEHICLE', ['targetVehicle', 'isActive'])
@Index('IDX_SPEEDLIMIT_SEGMENT', ['segmentId'])
export class SpeedLimitConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 速限類型（閉鎖式 Enum）
  @Column({ type: 'enum', enum: SpeedLimitType, name: 'config_type' })
  configType: SpeedLimitType;

  // 目標車輛（'all' 代表全車隊）
  @Column({ name: 'target_vehicle', default: 'all' })
  targetVehicle: string;

  // 路段識別碼（對應地圖節點 ID，SEGMENT/SCHEDULED 類型使用）
  @Column({ name: 'segment_id', nullable: true })
  segmentId: string;

  // 速限值 (km/h)
  @Column({ name: 'speed_limit_kmh', type: 'int' })
  speedLimitKmh: number;

  // 生效開始時間 (Epoch ms)，null 代表立即生效
  @Column({ name: 'effective_from', type: 'bigint', nullable: true })
  effectiveFrom: string;

  // 生效結束時間 (Epoch ms)，null 代表永久
  @Column({ name: 'effective_until', type: 'bigint', nullable: true })
  effectiveUntil: string;

  // 目前是否生效
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // 設定人員
  @Column({ name: 'operator_id', default: 'system' })
  operatorId: string;

  // 備註說明
  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({
    type: 'bigint',
    name: 'created_at',
    default: () => '(EXTRACT(EPOCH FROM NOW()) * 1000)',
  })
  createdAt: string;
}
