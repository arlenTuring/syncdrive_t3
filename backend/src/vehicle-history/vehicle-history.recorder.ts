import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DegradedReplayMap } from '../database/entities/degraded-replay.entities';
import {
  VehicleHistoryFrame,
  VehicleHistoryGap,
  VehicleHistorySegment,
} from '../database/entities/vehicle-history.entities';
import { MapService } from '../map/map.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { MapVehicleSettingsService } from '../vehicle-definition/map-vehicle-settings.service';
import {
  saveActiveMapSnapshot,
  vehicleModelHash,
  vehicleModelSnapshot,
} from './history-snapshots';

export type HistoryStream =
  | 'telemetry'
  | 'operation'
  | 'health'
  | 'event'
  | 'command_ack'
  | 'facility';

/** 緩衝上限：超過就不收新資料並記成缺段（backpressure），不無限堆積 */
export const HISTORY_MAX_BUFFER = 50_000;
const FLUSH_INTERVAL_MS = 500;
const INSERT_CHUNK = 500;
/** 一批寫入失敗後的重試次數與間隔；都失敗才記成缺段 */
const MAX_WRITE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
/** 健康心跳的保存粒度：除了 timestamp 以外都沒變時，至少隔這麼久留一筆 */
export const HEALTH_KEEPALIVE_MS = 10_000;
/** 錄製區段心跳：沒有資料進來時也定期確認「仍在錄製」 */
const SEGMENT_HEARTBEAT_MS = 10_000;
/** 地圖／車輛模型版本檢查間隔 */
const VERSION_CHECK_MS = 30_000;
const STREAM_KEY_FLUSH_MS = 5_000;
/** 關閉時最多等多久把緩衝寫完 */
const SHUTDOWN_FLUSH_LIMIT_MS = 10_000;

type PendingFrame = {
  stream: string;
  streamKey: string;
  vehicleCode: string | null;
  topic: string | null;
  orderId: string | null;
  receivedAt: number;
  operatingAt: number | null;
  clockRun: string | null;
  vehicleTs: number | null;
  source: 'mqtt' | 'system';
  payload: Record<string, unknown>;
  derived: Record<string, unknown> | null;
  attempts: number;
};

type OpenGap = { fromReal: number; toReal: number; fromOperating: number | null; toOperating: number | null; count: number };

/**
 * 一般運行歷史錄製（運行管理紀錄回放的資料來源；降級回放也讀這裡）。
 *
 * <h3>收什麼</h3>
 * MQTT 入口收到的 telemetry／operation／health／event／command ack／場域設施訊息，存原始內容
 * （入口在任何正規化之前先複製一份），後端衍生的位置標籤另外放 derived。訂單與站點動作的
 * 變更由資料庫觸發器寫（migration 20261015-vehicle-run-history.sql）。地圖與車輛模型換版本時
 * 各記一筆參照。
 *
 * <h3>去重</h3>
 * 只有健康心跳會略過：除了 timestamp 以外內容完全相同、而且距上一筆不到 {@link HEALTH_KEEPALIVE_MS}。
 * 其餘一律逐筆保存（包括車端重送的同一筆）。保存粒度記在錄製區段上，回放畫面照實標示。
 *
 * <h3>失敗與背壓</h3>
 * 寫入採批次、有上限的緩衝。一批失敗會重試；重試完仍失敗、或緩衝滿了不再收的，記成缺段
 * （vehicle_history_gaps，含筆數與時間），回放時顯示，不補資料。
 *
 * <h3>錄製範圍</h3>
 * 每次後端啟動開一段錄製區段，定期心跳；沒有正常關閉的區段標成 interrupted。區段以外的時間
 * 就是未錄製（功能上線前、後端停機），不拿現在的狀態推算。
 */
@Injectable()
export class VehicleHistoryRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VehicleHistoryRecorder.name);
  private readonly configured = process.env.VEHICLE_HISTORY_RECORDING !== '0';
  private segmentId: string | null = null;
  private buffer: PendingFrame[] = [];
  private retry: PendingFrame[] = [];
  private retryAfter = 0;
  private flushing: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private writtenSinceHeartbeat = 0;
  private lastHeartbeat = 0;
  private lastVersionCheck = 0;
  private lastStreamKeyFlush = 0;
  private droppedGap: OpenGap | null = null;
  private readonly lastHealth = new Map<string, { key: string; at: number }>();
  private readonly streamKeys = new Map<string, { stream: string; vehicleCode: string | null; first: number; last: number; dirty: boolean }>();
  private mapHash: string | null = null;
  private modelHash: string | null = null;
  private lastClockRun: string | null = null;

  constructor(
    @InjectRepository(VehicleHistoryFrame)
    private readonly frames: Repository<VehicleHistoryFrame>,
    @InjectRepository(VehicleHistorySegment)
    private readonly segments: Repository<VehicleHistorySegment>,
    @InjectRepository(VehicleHistoryGap)
    private readonly gaps: Repository<VehicleHistoryGap>,
    @InjectRepository(DegradedReplayMap)
    private readonly maps: Repository<DegradedReplayMap>,
    private readonly dataSource: DataSource,
    private readonly clock: OperatingClockService,
    private readonly mapService: MapService,
    private readonly mapVehicles: MapVehicleSettingsService,
  ) {}

  /** 一般運行歷史有在錄製（降級回放據此決定不再自己重複保存同一份 MQTT） */
  enabled(): boolean {
    return this.configured && this.segmentId != null && !this.stopping;
  }

  async onModuleInit(): Promise<void> {
    if (!this.configured) {
      this.logger.warn('一般運行歷史錄製已關閉（VEHICLE_HISTORY_RECORDING=0）');
      return;
    }
    try {
      const now = Date.now();
      // 上次沒有正常關閉的區段：結束時刻記成最後一次確認仍在錄製的時刻，之後到現在是未錄製
      await this.dataSource.query(
        `UPDATE vehicle_history_segments SET status = 'interrupted', ended_real = last_alive_real
          WHERE status = 'recording'`,
      );
      const segment = await this.segments.save(
        this.segments.create({
          startedReal: String(now),
          lastAliveReal: String(now),
          endedReal: null,
          status: 'recording',
          healthKeepaliveMs: HEALTH_KEEPALIVE_MS,
          frameCount: '0',
        }),
      );
      this.segmentId = segment.id;
      this.lastHeartbeat = now;
      this.checkClockRun(true);
      await this.checkVersions(true);
    } catch (error) {
      this.segmentId = null;
      this.logger.error(`一般運行歷史錄製無法啟動：${(error as Error).message}`);
    }
    this.timer = setInterval(() => void this.tick(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (!this.segmentId) return;
    this.stopping = true;
    const deadline = Date.now() + SHUTDOWN_FLUSH_LIMIT_MS;
    while ((this.buffer.length > 0 || this.retry.length > 0 || this.flushing) && Date.now() < deadline) {
      this.retryAfter = 0;
      await this.flush();
    }
    const left = this.buffer.length + this.retry.length;
    if (left > 0) this.recordLostOnShutdown([...this.retry, ...this.buffer]);
    await this.flushStreamKeys().catch(() => undefined);
    await this.closeDroppedGap();
    await this.segments
      .update(
        { id: this.segmentId },
        { status: 'closed', endedReal: String(Date.now()), lastAliveReal: String(Date.now()) },
      )
      .catch((error: Error) => this.logger.error(`錄製區段收尾失敗：${error.message}`));
  }

  /**
   * MQTT 入口呼叫：只做記憶體內的判斷與排隊，寫庫在背景批次進行。
   * payload 必須是入口在任何修改之前複製的原始內容。
   */
  capture(
    stream: HistoryStream,
    input: {
      vehicleCode: string | null;
      topic: string | null;
      payload: unknown;
      derived?: Record<string, unknown> | null;
      receivedAt?: number;
    },
  ): void {
    if (!this.enabled()) return;
    if (!input.payload || typeof input.payload !== 'object') return;
    const body = input.payload as Record<string, unknown>;
    const receivedAt = input.receivedAt ?? Date.now();
    const vehicleCode = input.vehicleCode;
    const streamKey =
      stream === 'facility'
        ? `facility|${input.topic ?? ''}`
        : `${stream}|${vehicleCode ?? input.topic ?? ''}`;

    if (stream === 'health') {
      const key = healthContentKey(body);
      const last = this.lastHealth.get(streamKey);
      if (last && last.key === key && receivedAt - last.at < HEALTH_KEEPALIVE_MS) return;
      this.lastHealth.set(streamKey, { key, at: receivedAt });
    }
    const orderId = typeof body.order_id === 'string' && body.order_id.trim() ? body.order_id.trim() : null;
    this.enqueue({
      stream,
      streamKey,
      vehicleCode,
      topic: input.topic,
      orderId,
      receivedAt,
      operatingAt: this.clock.now(receivedAt),
      clockRun: this.clockRun(),
      vehicleTs: numberOrNull(body.timestamp),
      source: 'mqtt',
      payload: body,
      derived: input.derived ?? null,
      attempts: 0,
    });
  }

  /**
   * 後端自己產生、回放需要的資料（例如降級開始時各訂單的站序快照）：跟 MQTT 原始資料同一張表、
   * 同一個序號空間，排序與分頁游標才一致。source＝system，不會被誤認成車端資料。
   */
  captureSystem(input: {
    stream: string;
    streamKey: string;
    vehicleCode: string | null;
    orderId: string | null;
    payload: Record<string, unknown>;
    receivedAt?: number;
    operatingAt?: number;
  }): boolean {
    if (!this.enabled()) return false;
    const receivedAt = input.receivedAt ?? Date.now();
    this.enqueue({
      stream: input.stream,
      streamKey: input.streamKey,
      vehicleCode: input.vehicleCode,
      topic: null,
      orderId: input.orderId,
      receivedAt,
      operatingAt: input.operatingAt ?? this.clock.now(receivedAt),
      clockRun: this.clockRun(),
      vehicleTs: null,
      source: 'system',
      payload: input.payload,
      derived: null,
      attempts: 0,
    });
    return true;
  }

  private enqueue(frame: PendingFrame) {
    if (this.buffer.length + this.retry.length >= HISTORY_MAX_BUFFER) {
      // 背壓：寫庫跟不上。不收這一筆，累計成一段缺段（筆數、起訖時間）
      const gap = (this.droppedGap ??= {
        fromReal: frame.receivedAt,
        toReal: frame.receivedAt,
        fromOperating: frame.operatingAt,
        toOperating: frame.operatingAt,
        count: 0,
      });
      gap.toReal = frame.receivedAt;
      gap.toOperating = frame.operatingAt;
      gap.count += 1;
      return;
    }
    this.buffer.push(frame);
    const known = this.streamKeys.get(frame.streamKey);
    if (known) {
      known.last = frame.receivedAt;
      known.dirty = true;
    } else {
      this.streamKeys.set(frame.streamKey, {
        stream: frame.stream,
        vehicleCode: frame.vehicleCode,
        first: frame.receivedAt,
        last: frame.receivedAt,
        dirty: true,
      });
    }
  }

  private async tick(): Promise<void> {
    if (!this.segmentId || this.stopping) return;
    const now = Date.now();
    if (this.droppedGap && this.buffer.length + this.retry.length < HISTORY_MAX_BUFFER / 2) {
      await this.closeDroppedGap();
    }
    await this.flush();
    if (now - this.lastStreamKeyFlush >= STREAM_KEY_FLUSH_MS) {
      this.lastStreamKeyFlush = now;
      await this.flushStreamKeys().catch((error: Error) =>
        this.logger.warn(`歷史串流索引更新失敗：${error.message}`),
      );
    }
    if (now - this.lastHeartbeat >= SEGMENT_HEARTBEAT_MS) {
      this.lastHeartbeat = now;
      const written = this.writtenSinceHeartbeat;
      this.writtenSinceHeartbeat = 0;
      await this.dataSource
        .query(
          `UPDATE vehicle_history_segments SET last_alive_real = $2, frame_count = frame_count + $3 WHERE id = $1`,
          [this.segmentId, now, written],
        )
        .catch((error: Error) => {
          this.writtenSinceHeartbeat += written;
          this.logger.warn(`錄製區段心跳失敗：${error.message}`);
        });
    }
    if (now - this.lastVersionCheck >= VERSION_CHECK_MS) await this.checkVersions(false);
    this.checkClockRun(false);
  }

  /** 營運時鐘換了模式或輪次：記一筆，回放畫面據此標出每一段屬於哪一輪 */
  private checkClockRun(force: boolean) {
    const snapshot = this.clock.snapshot();
    const run = `${snapshot.mode}:${snapshot.run_id ?? ''}`;
    if (!force && run === this.lastClockRun) return;
    this.lastClockRun = run;
    this.pushSystemFrame('clock', 'clock|run', {
      clock_run: run,
      mode: snapshot.mode,
      run_id: snapshot.run_id ?? null,
      operating_day: snapshot.operating_day ?? null,
      rate: snapshot.rate ?? null,
    });
  }

  /** 把排隊的資料寫進資料庫；失敗的批次稍後重試，重試完仍失敗記成缺段 */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const retryReady = this.retry.length > 0 && Date.now() >= this.retryAfter;
    if (this.buffer.length === 0 && !retryReady) return;
    this.flushing = (async () => {
      const batch = [...(retryReady ? this.retry.splice(0) : []), ...this.buffer.splice(0)];
      for (let index = 0; index < batch.length; index += INSERT_CHUNK) {
        const chunk = batch.slice(index, index + INSERT_CHUNK);
        try {
          await this.frames.insert(chunk.map(toRow));
          this.writtenSinceHeartbeat += chunk.length;
        } catch (error) {
          this.onWriteFailed(chunk, error);
        }
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private onWriteFailed(chunk: PendingFrame[], error: unknown) {
    const message = (error as Error)?.message ?? String(error);
    const retryable = chunk.filter((frame) => frame.attempts + 1 < MAX_WRITE_ATTEMPTS);
    const lost = chunk.filter((frame) => frame.attempts + 1 >= MAX_WRITE_ATTEMPTS);
    retryable.forEach((frame) => {
      frame.attempts += 1;
    });
    // 重試的放回最前面，保持先後
    this.retry.unshift(...retryable);
    this.retryAfter = Date.now() + RETRY_DELAY_MS * 2 ** Math.max(0, (retryable[0]?.attempts ?? 1) - 1);
    if (lost.length === 0) {
      this.logger.warn(`歷史資料寫入失敗（${chunk.length} 筆），稍後重試：${message}`);
      return;
    }
    this.logger.error(`歷史資料寫入失敗、重試已用完（${lost.length} 筆），記為缺段：${message}`);
    void this.recordGap('write_failed', lost, message);
  }

  private recordLostOnShutdown(lost: PendingFrame[]) {
    this.logger.error(`關閉時仍有 ${lost.length} 筆歷史資料沒寫進去，記為缺段`);
    void this.recordGap('write_failed', lost, '後端關閉時未能寫完');
  }

  private async recordGap(reason: string, frames: PendingFrame[], detail: string | null) {
    const real = frames.map((frame) => frame.receivedAt);
    const operating = frames.map((frame) => frame.operatingAt).filter((value): value is number => value != null);
    await this.gaps
      .insert({
        segmentId: this.segmentId,
        fromReal: String(Math.min(...real)),
        toReal: String(Math.max(...real)),
        fromOperating: operating.length ? String(Math.min(...operating)) : null,
        toOperating: operating.length ? String(Math.max(...operating)) : null,
        reason,
        count: frames.length,
        detail: detail?.slice(0, 500) ?? null,
      })
      .catch((error: Error) => this.logger.error(`缺段紀錄也寫不進去：${error.message}`));
  }

  private async closeDroppedGap() {
    const gap = this.droppedGap;
    if (!gap) return;
    this.droppedGap = null;
    this.logger.error(`歷史錄製緩衝滿載，丟棄 ${gap.count} 筆，記為缺段`);
    await this.gaps
      .insert({
        segmentId: this.segmentId,
        fromReal: String(gap.fromReal),
        toReal: String(gap.toReal),
        fromOperating: gap.fromOperating == null ? null : String(gap.fromOperating),
        toOperating: gap.toOperating == null ? null : String(gap.toOperating),
        reason: 'backpressure',
        count: gap.count,
        detail: `緩衝上限 ${HISTORY_MAX_BUFFER} 筆`,
      })
      .catch((error: Error) => this.logger.error(`缺段紀錄寫入失敗：${error.message}`));
  }

  private async flushStreamKeys() {
    const dirty = [...this.streamKeys.entries()].filter(([, value]) => value.dirty);
    if (dirty.length === 0) return;
    const values: unknown[] = [];
    const rows = dirty.map(([key, value], index) => {
      values.push(key, value.stream, value.vehicleCode, value.first, value.last);
      const base = index * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await this.dataSource.query(
      `INSERT INTO vehicle_history_stream_keys (stream_key, stream, vehicle_code, first_real, last_real)
       VALUES ${rows.join(', ')}
       ON CONFLICT (stream_key) DO UPDATE SET
         last_real = GREATEST(vehicle_history_stream_keys.last_real, EXCLUDED.last_real),
         first_real = LEAST(vehicle_history_stream_keys.first_real, EXCLUDED.first_real)`,
      values,
    );
    dirty.forEach(([, value]) => {
      value.dirty = false;
    });
  }

  /** 地圖或車輛模型換了版本：記一筆參照，回放時依游標取當時那一版 */
  private async checkVersions(force: boolean) {
    this.lastVersionCheck = Date.now();
    try {
      const map = await saveActiveMapSnapshot(this.mapService, this.maps);
      if (map && (force || map.hash !== this.mapHash)) {
        this.mapHash = map.hash;
        this.pushSystemFrame('map', 'map|active', {
          map_id: map.mapId,
          map_hash: map.hash,
          version: map.version,
          display_name: map.displayName,
        });
      }
      if (map) {
        const model = await vehicleModelSnapshot(this.mapVehicles, map.mapId);
        const hash = vehicleModelHash(model);
        if (force || hash !== this.modelHash) {
          this.modelHash = hash;
          this.pushSystemFrame('model', 'model|active', { map_id: map.mapId, model_hash: hash, snapshot: model });
        }
      }
    } catch (error) {
      this.logger.warn(`地圖／車輛模型版本檢查失敗：${(error as Error).message}`);
    }
  }

  private pushSystemFrame(stream: string, streamKey: string, payload: Record<string, unknown>) {
    const receivedAt = Date.now();
    this.enqueue({
      stream,
      streamKey,
      vehicleCode: null,
      topic: null,
      orderId: null,
      receivedAt,
      operatingAt: this.clock.now(receivedAt),
      clockRun: this.clockRun(),
      vehicleTs: null,
      source: 'system',
      payload,
      derived: null,
      attempts: 0,
    });
  }

  private clockRun(): string {
    const snapshot = this.clock.snapshot();
    return `${snapshot.mode}:${snapshot.run_id ?? ''}`;
  }
}

function toRow(frame: PendingFrame) {
  return {
    stream: frame.stream,
    streamKey: frame.streamKey,
    vehicleCode: frame.vehicleCode,
    topic: frame.topic,
    orderId: frame.orderId,
    receivedAt: String(frame.receivedAt),
    operatingAt: frame.operatingAt == null ? null : String(frame.operatingAt),
    clockRun: frame.clockRun,
    vehicleTs: frame.vehicleTs == null ? null : String(frame.vehicleTs),
    source: frame.source,
    payload: frame.payload as VehicleHistoryFrame['payload'],
    derived: frame.derived as VehicleHistoryFrame['derived'],
  };
}

/** 健康心跳的比較鍵：除了 timestamp 以外的全部內容（錯誤碼、子系統等任何變化都會留下） */
export function healthContentKey(payload: Record<string, unknown>): string {
  const { timestamp: _ignored, ...rest } = payload;
  void _ignored;
  return stableStringify(rest);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
