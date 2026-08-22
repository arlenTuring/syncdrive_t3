import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum MediaTriggerType {
  ARRIVAL = 'ARRIVAL', // 到站
  DEPARTURE = 'DEPARTURE', // 發車
  DOOR_OPEN = 'DOOR_OPEN', // 開門
  DOOR_CLOSE = 'DOOR_CLOSE', // 關門
  TIME_WINDOW = 'TIME_WINDOW', // 指定時段
  MANUAL = 'MANUAL', // 人工觸發
}

export enum MediaScopeType {
  GLOBAL = 'GLOBAL', // 全場域
  ROUTE = 'ROUTE', // 指定路線
  STATION = 'STATION', // 指定站點
  VEHICLE = 'VEHICLE', // 指定車輛
}

/**
 * 規格書 §資源配置層 · 媒體管理模組 · 媒體排程設定
 *
 * 媒體（單一音檔或播放群組）的播放排程。
 * mediaId 指向 media_library_items，可為 kind='media' 或 kind='group'。
 *
 * 觸發分兩類：事件觸發（到站、發車、開關門）與時段觸發（TIME_WINDOW）；
 * 生效範圍可限定路線、站點或車輛，scopeType 為 GLOBAL 時 scopeId 為空。
 * 同一觸發條件命中多筆時，以 priority 小者優先。
 */
@Entity('media_schedules')
@Index('IDX_MEDIA_SCHEDULE_TRIGGER', ['triggerType', 'isActive'])
@Index('IDX_MEDIA_SCHEDULE_SCOPE', ['scopeType', 'scopeId'])
export class MediaSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name' })
  name: string;

  // 對應 media_library_items.media_id（單一媒體或播放群組）
  @Column({ name: 'media_id' })
  mediaId: string;

  @Column({ type: 'enum', enum: MediaTriggerType, name: 'trigger_type' })
  triggerType: MediaTriggerType;

  @Column({ type: 'enum', enum: MediaScopeType, name: 'scope_type', default: MediaScopeType.GLOBAL })
  scopeType: MediaScopeType;

  // 生效對象識別碼（路線／站點／車輛）；GLOBAL 時為空
  @Column({ name: 'scope_id', nullable: true })
  scopeId: string;

  // 時段觸發的起訖（當日分鐘數，0–1439）；非時段觸發時為空
  @Column({ name: 'start_minute', type: 'int', nullable: true })
  startMinute: number;

  @Column({ name: 'end_minute', type: 'int', nullable: true })
  endMinute: number;

  // 同一觸發條件命中多筆時的優先序，數字小者優先
  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // 其他觸發參數（如提前秒數、重複次數）
  @Column({ type: 'jsonb', nullable: true })
  options: any;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
