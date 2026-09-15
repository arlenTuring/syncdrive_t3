import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

// §四 規格書定義之合法事件代碼（閉鎖式管理）
export enum EventCode {
  UNSCHEDULED_DOOR_OPEN = 'UNSCHEDULED_DOOR_OPEN',
  OBSTACLE_DETECTED     = 'OBSTACLE_DETECTED',
  PATH_BLOCKED          = 'PATH_BLOCKED',
  DIRECTION_VIOLATION   = 'DIRECTION_VIOLATION',
  INTERLOCK_REQ         = 'INTERLOCK_REQ',
  // 預留：由 Health Monitor 連動產生的內部告警標記（僅記錄，不觸發 MRM）
  SYSTEM_HEALTH_DEGRADED = 'SYSTEM_HEALTH_DEGRADED',
}

export enum Severity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

@Entity('security_event_logs')
@Index('IDX_EVENT_VEHICLE_TIME', ['vehicleCode', 'createdAt']) // 快速依時間軸拉取單車事件
@Index('IDX_EVENT_SEVERITY', ['severity']) // 快速撈取所有 CRITICAL 警報
export class SecurityEventLog {
  @PrimaryColumn({ type: 'varchar', name: 'event_id' })
  eventId: string;

  @Column({ name: 'vehicle_code' })
  vehicleCode: string;

  @Column({ type: 'enum', enum: EventCode, name: 'event_code' })
  eventCode: EventCode;

  @Column({
    type: 'enum',
    enum: Severity,
  })
  severity: Severity;

  @Column({ type: 'jsonb', nullable: true })
  location: any;

  @Column({ type: 'text', nullable: true })
  detail: string;

  @Column({ type: 'jsonb', nullable: true })
  params: any;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  /** 儀表板展示：分類標籤（如 線控） */
  @Column({ name: 'category_label', nullable: true, length: 32 })
  categoryLabel: string;

  /** 儀表板展示：主標題訊息 */
  @Column({ name: 'display_message', type: 'text', nullable: true })
  displayMessage: string;

  /** 儀表板展示：副標（如 PMS02） */
  @Column({ name: 'sub_label', nullable: true, length: 32 })
  subLabel: string;

  @Column({ name: 'is_acknowledged', default: false })
  isAcknowledged: boolean;
}
