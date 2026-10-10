import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 降級回放的保存範圍：一筆降級執行一筆。
 *
 * 記錄這段期間收了什麼、從哪一刻到哪一刻、用哪一版地圖、營運時鐘是哪一個 run，
 * 以及哪裡缺了（寫入失敗、後端重啟、營運時鐘換 run、超過上限）。前端靠它判斷
 * 「這段能不能回放、哪裡要標資料缺段」，不靠猜。
 */
@Entity('degraded_replay_sessions')
export class DegradedReplaySession {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'execution_id' })
  executionId: string;

  /** recording：保存中；complete：降級結束、已收尾；interrupted：沒有正常收尾 */
  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'varchar', length: 200, name: 'map_id', nullable: true })
  mapId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'map_hash', nullable: true })
  mapHash: string | null;

  @Column({ type: 'varchar', length: 80, name: 'map_version', nullable: true })
  mapVersion: string | null;

  @Column({
    type: 'varchar',
    length: 200,
    name: 'map_display_name',
    nullable: true,
  })
  mapDisplayName: string | null;

  /**
   * 開始時這張地圖用的車輛模型快照（模型內容＋顯示設定）。之後模型被改或刪掉，
   * 回放仍畫當時的外觀；舊紀錄沒有這一欄，前端會標示「暫用目前模型」。
   */
  @Column({ type: 'jsonb', name: 'vehicle_model', nullable: true })
  vehicleModel: Record<string, unknown> | null;

  /** 開始時營運時鐘的身分（mode:run_id）；之後換了 run 的資料不收，記成缺段 */
  @Column({ type: 'varchar', length: 120, name: 'clock_run', nullable: true })
  clockRun: string | null;

  @Column({ type: 'bigint', name: 'started_real' })
  startedReal: string;

  @Column({ type: 'bigint', name: 'started_operating' })
  startedOperating: string;

  @Column({ type: 'bigint', name: 'ended_real', nullable: true })
  endedReal: string | null;

  @Column({ type: 'bigint', name: 'ended_operating', nullable: true })
  endedOperating: string | null;

  /** 開始那一刻的完整初始狀態有沒有存到（舊紀錄、或功能上線前就開始的降級沒有） */
  @Column({ type: 'boolean', name: 'initial_captured', default: false })
  initialCaptured: boolean;

  @Column({ type: 'bigint', name: 'frame_count', default: 0 })
  frameCount: string;

  @Column({ type: 'bigint', name: 'dropped_count', default: 0 })
  droppedCount: string;

  /** [{ from_real, to_real, from_operating, to_operating, reason }] */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  gaps: ReplayGap[];

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  /** 最後一次成功寫入的實際時刻；後端重啟後用它算出中間缺了多久 */
  @Column({ type: 'bigint', name: 'last_written_real', nullable: true })
  lastWrittenReal: string | null;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}

export type ReplayGap = {
  from_real: number;
  to_real: number;
  from_operating: number | null;
  to_operating: number | null;
  reason:
    | 'write_failed'
    | 'backend_restart'
    | 'clock_run_changed'
    | 'frame_limit'
    | 'not_recorded'
    | 'clock_unsynced';
  count?: number;
};

/** 回放用的地圖快照：依內容雜湊去重。之後地圖被改、被蓋掉，歷史仍用當時那一份 */
@Entity('degraded_replay_maps')
export class DegradedReplayMap {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'map_hash' })
  mapHash: string;

  @Column({ type: 'varchar', length: 200, name: 'map_id' })
  mapId: string;

  @Column({ type: 'varchar', length: 80, name: 'map_version', nullable: true })
  mapVersion: string | null;

  @Column({ type: 'jsonb' })
  document: Record<string, any>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;
}

/**
 * 降級期間後端實際收到的資料，一筆一則。
 *
 * 三種時間分開存：received_at（後端收到的實際時刻）、operating_at（當時的營運時間，
 * 回放時間軸用它）、vehicle_ts（車端原始 timestamp，不改）。同一毫秒的先後看 seq。
 */
@Entity('degraded_replay_frames')
@Index('IDX_DEGRADED_REPLAY_FRAME_TIME', ['executionId', 'operatingAt', 'seq'])
export class DegradedReplayFrame {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  seq: string;

  @Column({ type: 'varchar', length: 36, name: 'execution_id' })
  executionId: string;

  /** telemetry／operation／health／facility／order */
  @Column({ type: 'varchar', length: 16 })
  stream: string;

  /** initial：開始時的初始狀態；live：之後收到的 */
  @Column({ type: 'varchar', length: 8 })
  kind: string;

  @Column({ type: 'varchar', length: 64, name: 'vehicle_code', nullable: true })
  vehicleCode: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  topic: string | null;

  @Column({ type: 'bigint', name: 'received_at' })
  receivedAt: string;

  @Column({ type: 'bigint', name: 'operating_at' })
  operatingAt: string;

  @Column({ type: 'bigint', name: 'vehicle_ts', nullable: true })
  vehicleTs: string | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;
}
