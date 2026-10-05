import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

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

/**
 * 事件的去重鍵：同一台車、同一個車端 event_id、同一個車端 timestamp ＝同一則事件。
 *
 * 協議（動態控制與特殊事件協議 §四）的 event_id 是 EVT-YYYYMMDD-NNNN「每日重置的四位數流水號」，
 * 只在同一台車、同一天內有意義：不同車會用到同一個號碼，不能單獨當唯一鍵。event/report 是
 * QoS 1，同一則可能重送，重送的內容（含 timestamp）相同。所以：
 * - 不同車、相同流水號：車號不同，各自保存。
 * - 跨日相同流水號：event_id 裡的日期是車端給的，不同日期就是不同鍵——不看中心端接收日期。
 * - 同一則重送或延遲到達：三者都相同，不重複新增。
 * - 同車同號、但 timestamp 不同（例如車端重啟後流水號從頭算）：當成不同事件保存，並記錄警告，
 *   因為協議沒有規定流水號跨重啟要延續，這時中心端無法判斷是不是同一件事。
 * 沒有 timestamp 的訊息（違反協議）退回只看車號＋event_id。
 */
export function securityEventDedupKey(vehicleCode: string, eventId: string, timestamp: unknown): string {
  const ts = typeof timestamp === 'number' && Number.isFinite(timestamp) ? String(Math.trunc(timestamp)) : 'no-ts';
  return `${vehicleCode}|${eventId}|${ts}`;
}

@Entity('security_event_logs')
@Index('IDX_EVENT_VEHICLE_TIME', ['vehicleCode', 'createdAt']) // 快速依時間軸拉取單車事件
@Index('IDX_EVENT_SEVERITY', ['severity']) // 快速撈取所有 CRITICAL 警報
@Index('IDX_EVENT_VEHICLE_EVENT_ID', ['vehicleCode', 'eventId'])
@Index('UQ_EVENT_DEDUP_KEY', ['dedupKey'], { unique: true })
export class SecurityEventLog {
  /** 中心端內部識別（2026-10-05 起）；車端原始 event_id 另存，不改寫 */
  @PrimaryGeneratedColumn({ type: 'bigint', name: 'id' })
  id: string;

  /** 車端傳來的原始 event_id（不唯一：不同車、不同日可以相同） */
  @Column({ type: 'varchar', name: 'event_id' })
  eventId: string;

  /** 去重鍵（見 securityEventDedupKey）；migration 之前的舊資料已回填 */
  @Column({ type: 'varchar', name: 'dedup_key', nullable: true })
  dedupKey: string | null;

  /** 中心端收到的時間（只供稽核延遲，不參與去重） */
  @Column({ type: 'bigint', name: 'received_at', nullable: true })
  receivedAt: string | null;

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
