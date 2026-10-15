import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 一般運行歷史：後端實際收到的資料，一筆一則（運行管理紀錄回放、降級回放共用）。
 *
 * <h3>欄位</h3>
 * - payload：收到的原始內容（進入任何正規化或加工之前的副本），不修改
 * - derived：後端衍生的資訊（例如由座標判斷的位置標籤），跟原始資料分開存
 * - received_at：後端收到的實際時刻；operating_at／clock_run：當時的營運時間與營運時鐘身分
 * - vehicle_ts：車端原始 timestamp
 * - seq：資料庫序號，同一毫秒的穩定先後
 *
 * 訂單與站點動作的變更由資料庫觸發器寫入（source='db'，沒有營運時間）；其餘來自 MQTT。
 * 回放時間軸用 received_at（實際時間，跨模擬輪次也不會重疊），降級回放用 operating_at。
 */
@Entity('vehicle_history_frames')
@Index('IDX_VEHICLE_HISTORY_TIME', ['receivedAt', 'seq'])
@Index('IDX_VEHICLE_HISTORY_KEY_TIME', ['streamKey', 'receivedAt', 'seq'])
@Index('IDX_VEHICLE_HISTORY_RUN_OPERATING', ['clockRun', 'operatingAt', 'seq'])
@Index('IDX_VEHICLE_HISTORY_VEHICLE_TIME', ['vehicleCode', 'receivedAt', 'seq'])
export class VehicleHistoryFrame {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  seq: string;

  /** telemetry／operation／health／event／command_ack／facility／order／order_action／map／model */
  @Column({ type: 'varchar', length: 16 })
  stream: string;

  /** 同一個狀態來源的鍵（telemetry|PMS01、facility|syncdrive/Gate/141、order|訂單號…） */
  @Column({ type: 'varchar', length: 260, name: 'stream_key' })
  streamKey: string;

  @Column({ type: 'varchar', length: 64, name: 'vehicle_code', nullable: true })
  vehicleCode: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  topic: string | null;

  @Index('IDX_VEHICLE_HISTORY_ORDER')
  @Column({ type: 'varchar', length: 120, name: 'order_id', nullable: true })
  orderId: string | null;

  @Column({ type: 'bigint', name: 'received_at' })
  receivedAt: string;

  @Column({ type: 'bigint', name: 'operating_at', nullable: true })
  operatingAt: string | null;

  @Column({ type: 'varchar', length: 120, name: 'clock_run', nullable: true })
  clockRun: string | null;

  @Column({ type: 'bigint', name: 'vehicle_ts', nullable: true })
  vehicleTs: string | null;

  /** mqtt：MQTT 原始訊息；db：訂單／站點動作變更（觸發器）；system：地圖／模型版本 */
  @Column({ type: 'varchar', length: 8 })
  source: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  derived: Record<string, any> | null;
}

/**
 * 錄製區段：後端每次啟動開一段，持續更新最後寫入時刻。區段以外的時間就是「未錄製」
 * （功能上線前、後端停機），回放不拿現在的狀態或班表補。
 */
@Entity('vehicle_history_segments')
export class VehicleHistorySegment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'started_real' })
  startedReal: string;

  /** 最後一次確認仍在錄製（成功寫入或心跳）的實際時刻 */
  @Column({ type: 'bigint', name: 'last_alive_real' })
  lastAliveReal: string;

  @Column({ type: 'bigint', name: 'ended_real', nullable: true })
  endedReal: string | null;

  /** recording：錄製中；closed：正常關閉；interrupted：沒有正常關閉（例如程序被終止） */
  @Column({ type: 'varchar', length: 16 })
  status: string;

  /** 健康心跳的保存粒度（毫秒）：狀態沒變時至少隔多久留一筆 */
  @Column({ type: 'integer', name: 'health_keepalive_ms' })
  healthKeepaliveMs: number;

  @Column({ type: 'bigint', name: 'frame_count', default: 0 })
  frameCount: string;
}

/** 錄製中發生的缺段：寫入失敗、緩衝滿載丟棄等。時間是實際時間 */
@Entity('vehicle_history_gaps')
@Index('IDX_VEHICLE_HISTORY_GAP_TIME', ['fromReal', 'toReal'])
export class VehicleHistoryGap {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'segment_id', nullable: true })
  segmentId: string | null;

  /** null 表示全車隊；單車清理時只對指定車輛回報缺段。 */
  @Column({ type: 'varchar', length: 64, name: 'vehicle_code', nullable: true })
  vehicleCode: string | null;

  @Column({ type: 'bigint', name: 'from_real' })
  fromReal: string;

  @Column({ type: 'bigint', name: 'to_real' })
  toReal: string;

  @Column({ type: 'bigint', name: 'from_operating', nullable: true })
  fromOperating: string | null;

  @Column({ type: 'bigint', name: 'to_operating', nullable: true })
  toOperating: string | null;

  /** write_failed／backpressure */
  @Column({ type: 'varchar', length: 24 })
  reason: string;

  @Column({ type: 'integer', default: 0 })
  count: number;

  @Column({ type: 'text', nullable: true })
  detail: string | null;
}

/** 出現過的狀態來源：起點快照只對這些鍵各取「不晚於起點的最後一筆」，不必掃整段歷史 */
@Entity('vehicle_history_stream_keys')
export class VehicleHistoryStreamKey {
  @PrimaryColumn({ type: 'varchar', length: 260, name: 'stream_key' })
  streamKey: string;

  @Column({ type: 'varchar', length: 16 })
  stream: string;

  @Column({ type: 'varchar', length: 64, name: 'vehicle_code', nullable: true })
  vehicleCode: string | null;

  @Column({ type: 'bigint', name: 'first_real' })
  firstReal: string;

  @Column({ type: 'bigint', name: 'last_real' })
  lastReal: string;
}
