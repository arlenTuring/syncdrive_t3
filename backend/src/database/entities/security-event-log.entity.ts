import { Check, Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

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

export type EventSourceType = 'VEHICLE' | 'FACILITY' | 'SYSTEM';

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
@Index('IDX_EVENT_TIME_ID', ['createdAt', 'id'])
@Index('IDX_EVENT_SOURCE_TIME', ['sourceType', 'sourceId', 'createdAt'])
@Index('IDX_EVENT_CODE_TIME', ['eventCode', 'createdAt'])
// 事件管理工作集合：待確認依發生時間、已確認依確認時間（20261025-live-event-indexes）
@Index('IDX_EVENT_PENDING_TIME', ['createdAt', 'id'], { where: 'is_acknowledged = false' })
@Index('IDX_EVENT_ACK_TIME', ['acknowledgedAt', 'id'], { where: 'is_acknowledged = true' })
// 與 migration 20261020 相同的約束（開發環境 synchronize 也保留）
@Check('CHK_EVENT_SOURCE_TYPE', `source_type IN ('VEHICLE', 'FACILITY', 'SYSTEM')`)
@Check('CHK_EVENT_ORIGIN', `origin IN ('REPORTED', 'CENTER')`)
@Check('CHK_EVENT_VEHICLE_SOURCE', `source_type <> 'VEHICLE' OR vehicle_code IS NOT NULL`)
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

  /** 載具事件的車號；設施／系統事件沒有車號（不偽造） */
  @Column({ name: 'vehicle_code', type: 'varchar', nullable: true })
  vehicleCode: string | null;

  /** 事件來源：VEHICLE（車端）、FACILITY（設施／SCADA）、SYSTEM（中心端系統） */
  @Column({ name: 'source_type', type: 'varchar', length: 16, default: 'VEHICLE' })
  sourceType: EventSourceType;

  /** 來源識別：車號、設施 ID 或系統元件名稱 */
  @Column({ name: 'source_id', type: 'varchar', length: 64, nullable: true })
  sourceId: string | null;

  /** 接收當下的來源名稱（之後改名仍可理解）；舊資料為空，不追溯 */
  @Column({ name: 'source_name_snapshot', type: 'varchar', length: 120, nullable: true })
  sourceNameSnapshot: string | null;

  /** REPORTED＝來源端回報；CENTER＝中心端依其他資料衍生（例如健康劣化） */
  @Column({ type: 'varchar', length: 16, default: 'REPORTED' })
  origin: 'REPORTED' | 'CENTER';

  /** created_at 是否為來源提供的有效發生時間；false＝來源缺時間、以接收時間代替；舊資料為 null（未知） */
  @Column({ name: 'occurred_at_valid', type: 'boolean', nullable: true })
  occurredAtValid: boolean | null;

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

  /** 人工確認（中心端閱覽確認，不代表故障解除或設備恢復） */
  @Column({ name: 'is_acknowledged', default: false })
  isAcknowledged: boolean;

  @Column({ name: 'acknowledged_by', type: 'varchar', length: 64, nullable: true })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_by_name', type: 'varchar', length: 120, nullable: true })
  acknowledgedByName: string | null;

  @Column({ name: 'acknowledged_at', type: 'bigint', nullable: true })
  acknowledgedAt: string | null;

  @Column({ name: 'acknowledgement_note', type: 'varchar', length: 500, nullable: true })
  acknowledgementNote: string | null;
}
