import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 媒體排程設定（預約播放／定時播放）。
 *
 * 與舊的事件觸發排程（media_schedules：到站、開關門…）分開存放，兩者用途不同、互不轉換。
 * 時間一律保存「時區＋本地設定」，預約另存絕對時刻；next_run_at 是下一個尚未處理的時點，
 * 到期處理只看它，不預先展開無結束日期的所有未來時點。
 */
export type MediaPlayMode = 'reserved' | 'timed';
export type MediaPlayStatus = 'active' | 'completed' | 'deleted';

@Entity('media_play_schedules')
@Index('IDX_MEDIA_PLAY_DUE', ['status', 'nextRunAt'])
export class MediaPlaySchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  mode: MediaPlayMode;

  @Column({ type: 'varchar', name: 'time_zone', length: 64 })
  timeZone: string;

  /** 預約：本地日期時間（YYYY-MM-DDTHH:mm，依 time_zone）與換算後的絕對時刻 */
  @Column({ type: 'varchar', name: 'run_local', length: 16, nullable: true })
  runLocal: string | null;

  @Column({ type: 'bigint', name: 'run_at', nullable: true })
  runAt: string | null;

  /** 定時：有效日期（含首尾；結束可空白＝無結束日期）與每週時點 {'1':['08:00'],…} */
  @Column({ type: 'varchar', name: 'start_date', length: 10, nullable: true })
  startDate: string | null;

  @Column({ type: 'varchar', name: 'end_date', length: 10, nullable: true })
  endDate: string | null;

  @Column({ type: 'jsonb', nullable: true })
  weekly: Record<string, string[]> | null;

  /** all：每次到期時解析當下的註冊載具；vehicles：指定的 vehicles.id */
  @Column({ type: 'varchar', name: 'target_scope', length: 16 })
  targetScope: 'all' | 'vehicles';

  @Column({ type: 'jsonb', name: 'vehicle_ids', default: () => "'[]'::jsonb" })
  vehicleIds: string[];

  /** 套用過的來源分組（只供追溯，執行時不重新展開） */
  @Column({ type: 'jsonb', name: 'source_group', nullable: true })
  sourceGroup: { id: string; name: string; version: number; applied_at: number } | null;

  @Column({ type: 'bigint', name: 'next_run_at', nullable: true })
  nextRunAt: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: MediaPlayStatus;

  @Column({ type: 'int', name: 'row_version', default: 1 })
  version: number;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;

  @Column({ type: 'bigint', name: 'deleted_at', nullable: true })
  deletedAt: string | null;
}

/** 有序播放清單（單一媒體；可依 media_id 查詢被哪些排程引用） */
@Entity('media_play_schedule_items')
@Index('IDX_MEDIA_PLAY_ITEM_MEDIA', ['mediaId'])
export class MediaPlayScheduleItem {
  @PrimaryColumn({ type: 'uuid', name: 'schedule_id' })
  scheduleId: string;

  @PrimaryColumn({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', name: 'media_id' })
  mediaId: string;
}

/**
 * 一次到期（排程＋排定時刻唯一）：多個後端實例同時處理也只會有一筆。
 * status：awaiting_integration（已到期、待下發，車端播放介接尚未就緒）、missed（超過容許窗口未處理）、
 * content_invalid（到期時清單內容無效）、no_targets（沒有可用載具）。
 */
@Entity('media_play_batches')
@Index('UQ_MEDIA_PLAY_BATCH', ['scheduleId', 'scheduledAt'], { unique: true })
export class MediaPlayBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'schedule_id' })
  scheduleId: string;

  @Column({ type: 'bigint', name: 'scheduled_at' })
  scheduledAt: string;

  @Column({ type: 'int', name: 'schedule_version' })
  scheduleVersion: number;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  /** 當時的內容（媒體 ID、名稱、類型、檔案或文字的雜湊、更新時刻）與其他說明 */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  detail: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;
}

/** 一次到期對每台載具的處理結果（批次＋載具唯一；名單在到期當下固定） */
@Entity('media_play_deliveries')
@Index('UQ_MEDIA_PLAY_DELIVERY', ['batchId', 'vehicleId'], { unique: true })
export class MediaPlayDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'batch_id' })
  batchId: string;

  @Column({ type: 'varchar', name: 'vehicle_id' })
  vehicleId: string;

  @Column({ type: 'varchar', name: 'vehicle_code' })
  vehicleCode: string;

  @Column({ type: 'varchar', name: 'vehicle_name' })
  vehicleName: string;

  /** not_delivered（介接未就緒，未下發）、skipped_offline、skipped_removed、content_invalid */
  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;
}
