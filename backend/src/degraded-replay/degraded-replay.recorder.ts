import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DegradedOperationExecution } from '../database/entities/degraded-operation-execution.entity';
import {
  DegradedReplayFrame,
  DegradedReplayMap,
  DegradedReplaySession,
  type ReplayGap,
} from '../database/entities/degraded-replay.entities';
import { MapService } from '../map/map.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { RedisService } from '../redis/redis.service';
import { MapVehicleSettingsService } from '../vehicle-definition/map-vehicle-settings.service';
import { saveActiveMapSnapshot, vehicleModelSnapshot } from '../vehicle-history/history-snapshots';
import { healthContentKey, VehicleHistoryRecorder } from '../vehicle-history/vehicle-history.recorder';

export type ReplayStream = 'telemetry' | 'operation' | 'health' | 'facility';

/** 已經正式開始、還沒恢復完成的降級：這段期間要保存 */
export const REPLAY_RECORDING_STATUSES = ['activating', 'active', 'restoring'];

/** 單次降級最多保存幾筆；超過就停收並記成缺段，不無限制複製 MQTT */
export const MAX_FRAMES_PER_EXECUTION = 3_000_000;
const FLUSH_INTERVAL_MS = 500;
const INSERT_CHUNK = 500;
/** 健康心跳只在狀態變了、或距上一筆超過這麼久時保存 */
const HEALTH_KEEPALIVE_MS = 10_000;
/** 跟前端車隊即時資料的過期門檻（FLEET_MQTT_STALE_AFTER_MS）一致：超過就當作不在場 */
export const REPLAY_STALE_AFTER_MS = 5_000;

type PendingFrame = {
  executionId: string;
  stream: string;
  kind: 'initial' | 'live';
  vehicleCode: string | null;
  topic: string | null;
  receivedAt: number;
  operatingAt: number;
  vehicleTs: number | null;
  payload: Record<string, unknown>;
};

type ActiveSession = {
  executionId: string;
  clockRun: string;
  frameCount: number;
  droppedCount: number;
  gaps: ReplayGap[];
  /** 進行中、還沒結束的缺段（例如營運時鐘換了 run 之後一直沒回來） */
  openGap: ReplayGap | null;
  lastError: string | null;
  lastWrittenReal: number | null;
  limitReached: boolean;
  /** 已收資料中最大的營運時間；營運時間倒退（時鐘還沒接回來）時不收 */
  lastOperatingAt: number;
  /**
   * history：遙測／營運／健康／場域資料由一般運行歷史保存（VehicleHistoryRecorder），這裡不再
   * 重複寫同一份；訂單站序快照寫進一般歷史（同一序號空間）。degraded：舊做法，全部自己存。
   */
  framesSource: 'history' | 'degraded';
};

/** 營運時間倒退超過這麼多才算時鐘沒接上（同一毫秒、心跳微調不算） */
const CLOCK_REGRESSION_TOLERANCE_MS = 1_000;

/**
 * 降級期間的回放保存。
 *
 * <h3>為什麼要另外存</h3>
 * 既有的 telemetry_logs 不收車隊（shouldPersistTelemetry 排除 PMS01～PMS11），
 * operation／health 只有 Redis 最新一筆，訂單只有目前狀態——都還原不了「降級那半小時
 * 地圖上長什麼樣」。這裡只在降級進行中、只存地圖會用到的串流：
 *
 * - 開始那一刻：當時地圖（內容雜湊）、各車最新遙測／營運／健康、未結案訂單的站序
 * - 期間：後端實際收到的遙測、營運、健康、場域設施訊息，原樣保存
 *
 * 不向車端要資料、不補資料。收到什麼存什麼，存不進去的記成缺段。
 *
 * <h3>時間</h3>
 * received_at 是後端收到的實際時刻，operating_at 是當時的營運時間（回放時間軸），
 * vehicle_ts 是車端原始 timestamp。營運時鐘換了 run（另一輪模擬）之後的資料不收，
 * 記成缺段——不同 run 的營運時間不在同一條時間軸上。
 */
@Injectable()
export class DegradedReplayRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DegradedReplayRecorder.name);
  private session: ActiveSession | null = null;
  private buffer: PendingFrame[] = [];
  private flushing: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  private readonly lastPayloadKey = new Map<string, string>();
  private readonly lastHealthAt = new Map<string, number>();
  private readonly capturedOrders = new Set<string>();
  /** 各車最後一次收到遙測的實際時刻（不論有沒有在保存），判斷開始時哪些車在場 */
  private readonly lastTelemetrySeen = new Map<string, number>();

  constructor(
    @InjectRepository(DegradedReplaySession)
    private readonly sessions: Repository<DegradedReplaySession>,
    @InjectRepository(DegradedReplayMap)
    private readonly maps: Repository<DegradedReplayMap>,
    @InjectRepository(DegradedReplayFrame)
    private readonly frames: Repository<DegradedReplayFrame>,
    @InjectRepository(DegradedOperationExecution)
    private readonly executions: Repository<DegradedOperationExecution>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly mapService: MapService,
    private readonly clock: OperatingClockService,
    private readonly mapVehicles: MapVehicleSettingsService,
    private readonly history: VehicleHistoryRecorder,
  ) {}

  async onModuleInit(): Promise<void> {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
    try {
      await this.resumeAfterRestart();
    } catch (error) {
      this.logger.error(`降級回放保存無法接續：${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
    await this.persistSession();
  }

  /** 目前正在保存哪一筆降級（沒有就是 null） */
  activeExecutionId(): string | null {
    return this.session?.executionId ?? null;
  }

  /**
   * 降級正式開始：保存當時地圖與初始狀態，之後收到的資料開始入庫。
   * 失敗只記錄，不影響降級本身——保存是為了事後回放，不能擋住營運操作。
   */
  async start(execution: {
    id: string;
    startedAtReal: number;
    startedAtOperating: number;
  }): Promise<void> {
    try {
      if (this.session && this.session.executionId !== execution.id) {
        await this.stop(this.session.executionId, null, 'interrupted');
      }
      if (this.session?.executionId === execution.id) return;
      const map = await this.saveActiveMap();
      const vehicleModel = map
        ? await this.snapshotVehicleModel(map.mapId)
        : null;
      const clockRun = this.clockRun();
      const now = Date.now();
      const framesSource = this.history.enabled() ? 'history' : 'degraded';
      await this.sessions.save(
        this.sessions.create({
          executionId: execution.id,
          status: 'recording',
          mapId: map?.mapId ?? null,
          mapHash: map?.hash ?? null,
          mapVersion: map?.version ?? null,
          mapDisplayName: map?.displayName ?? null,
          vehicleModel,
          clockRun,
          startedReal: String(execution.startedAtReal),
          startedOperating: String(execution.startedAtOperating),
          endedReal: null,
          endedOperating: null,
          initialCaptured: false,
          frameCount: '0',
          droppedCount: '0',
          gaps: [],
          lastError: map ? null : '開始時讀不到使用中的地圖',
          lastWrittenReal: String(now),
          updatedAt: String(now),
          framesSource,
        }),
      );
      this.activate({
        executionId: execution.id,
        framesSource,
        clockRun,
        frameCount: 0,
        droppedCount: 0,
        gaps: [],
        openGap: null,
        lastError: map ? null : '開始時讀不到使用中的地圖',
        lastWrittenReal: now,
        limitReached: false,
        lastOperatingAt: execution.startedAtOperating,
      });
      await this.captureInitialState(
        execution.id,
        execution.startedAtOperating,
      );
    } catch (error) {
      this.logger.error(
        `降級 ${execution.id} 的回放保存沒有啟動：${(error as Error).message}`,
      );
      if (this.session?.executionId === execution.id)
        this.session.lastError = `啟動失敗：${(error as Error).message}`;
    }
  }

  /** 降級結束（或被另一筆取代）：把剩下的寫完、記下結束時刻 */
  async stop(
    executionId: string,
    ended: { real: number; operating: number } | null,
    status: 'complete' | 'interrupted' = 'complete',
  ): Promise<void> {
    if (this.session?.executionId !== executionId) {
      // 沒在保存（例如功能上線前開始的降級）：有 session 就補上結束時刻
      if (ended)
        await this.sessions
          .update(
            { executionId },
            {
              status,
              endedReal: String(ended.real),
              endedOperating: String(ended.operating),
              updatedAt: String(Date.now()),
            },
          )
          .catch(() => undefined);
      return;
    }
    // 收尾前把排隊的全部寫完（進行中的那一批寫完後，可能又有新的排進來）
    while (this.buffer.length > 0 || this.flushing) await this.flush();
    const session = this.session;
    if (!session) return;
    if (session.openGap) {
      session.openGap.to_real = Date.now();
      session.openGap.to_operating = ended?.operating ?? this.clock.now();
      session.gaps.push(session.openGap);
      session.openGap = null;
    }
    this.session = null;
    this.lastPayloadKey.clear();
    this.lastHealthAt.clear();
    this.capturedOrders.clear();
    try {
      await this.sessions.update(
        { executionId },
        {
          status,
          endedReal: ended ? String(ended.real) : null,
          endedOperating: ended ? String(ended.operating) : null,
          frameCount: String(session.frameCount),
          droppedCount: String(session.droppedCount),
          gaps: session.gaps,
          lastError: session.lastError,
          lastWrittenReal:
            session.lastWrittenReal == null
              ? null
              : String(session.lastWrittenReal),
          updatedAt: String(Date.now()),
        },
      );
    } catch (error) {
      this.logger.error(
        `降級 ${executionId} 的回放保存收尾失敗：${(error as Error).message}`,
      );
    }
  }

  /**
   * MQTT 入口呼叫：沒有降級進行中時立刻返回。
   * 只做記憶體內的判斷與排隊，寫庫在背景批次進行，不拖慢 MQTT 處理。
   */
  capture(
    stream: ReplayStream,
    vehicleCode: string | null,
    topic: string | null,
    payload: unknown,
  ): void {
    const receivedAt = Date.now();
    if (stream === 'telemetry' && vehicleCode)
      this.lastTelemetrySeen.set(vehicleCode, receivedAt);
    const session = this.session;
    if (!session || !payload || typeof payload !== 'object') return;
    if (session.limitReached) return;
    const operatingAt = this.clock.now(receivedAt);

    if (this.clockRun() !== session.clockRun) {
      session.openGap ??= {
        from_real: receivedAt,
        to_real: receivedAt,
        from_operating: operatingAt,
        to_operating: operatingAt,
        reason: 'clock_run_changed',
      };
      session.openGap.to_real = receivedAt;
      return;
    }
    /*
     * 營運時間倒退：後端剛重啟、執行端的下一次心跳還沒到時，營運時鐘先停在上次保存的時刻
     * （實測倒退數小時）。這段時間收到的資料標不出正確的營運時間，不收，記成缺段；
     * 時鐘接回來（不再早於已收資料）才關閉缺段、恢復保存。
     */
    if (operatingAt < session.lastOperatingAt - CLOCK_REGRESSION_TOLERANCE_MS) {
      session.openGap ??= {
        from_real: receivedAt,
        to_real: receivedAt,
        from_operating: session.lastOperatingAt,
        to_operating: null,
        reason: 'clock_unsynced',
      };
      session.openGap.to_real = receivedAt;
      return;
    }
    if (session.openGap && session.openGap.reason !== 'frame_limit') {
      session.openGap.to_real = receivedAt;
      session.openGap.to_operating = operatingAt;
      session.gaps.push(session.openGap);
      session.openGap = null;
    }
    session.lastOperatingAt = Math.max(session.lastOperatingAt, operatingAt);

    const body = payload as Record<string, unknown>;
    if (session.framesSource === 'history') {
      // 一般運行歷史已逐筆保存這則訊息；這裡只補降級回放要的訂單站序快照
      this.captureNewOrder(session, stream, body);
      return;
    }
    const dedupKey = `${stream}|${vehicleCode ?? ''}|${topic ?? ''}`;
    // 健康心跳只略過「除了 timestamp 以外完全相同」的；錯誤碼等任何變化都會留下
    const contentKey =
      stream === 'health' ? healthContentKey(body) : JSON.stringify(body);
    if (this.lastPayloadKey.get(dedupKey) === contentKey) {
      // 內容完全一樣：retain 重送或停住的心跳。健康心跳仍定期留一筆，證明那段時間有收到
      if (stream !== 'health') return;
      if (
        receivedAt - (this.lastHealthAt.get(dedupKey) ?? 0) <
        HEALTH_KEEPALIVE_MS
      )
        return;
    }
    this.lastPayloadKey.set(dedupKey, contentKey);
    if (stream === 'health') this.lastHealthAt.set(dedupKey, receivedAt);

    if (session.frameCount + this.buffer.length >= MAX_FRAMES_PER_EXECUTION) {
      session.limitReached = true;
      session.openGap = {
        from_real: receivedAt,
        to_real: receivedAt,
        from_operating: operatingAt,
        to_operating: null,
        reason: 'frame_limit',
      };
      return;
    }

    this.buffer.push({
      executionId: session.executionId,
      stream,
      kind: 'live',
      vehicleCode,
      topic,
      receivedAt,
      operatingAt,
      vehicleTs: numberOrNull(body.timestamp),
      payload: body,
    });

    this.captureNewOrder(session, stream, body);
  }

  /** 新出現的訂單：記下它當時的站序與用途（判位要用），之後訂單再被改也不影響回放 */
  private captureNewOrder(session: ActiveSession, stream: ReplayStream, body: Record<string, unknown>) {
    const orderId =
      stream === 'operation' && typeof body.order_id === 'string'
        ? body.order_id.trim()
        : '';
    if (orderId && !this.capturedOrders.has(orderId)) {
      this.capturedOrders.add(orderId);
      void this.captureOrders(session.executionId, [orderId], 'live');
    }
  }

  /** 把排隊的資料寫進資料庫；失敗的那一批記成缺段 */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return;
    this.flushing = (async () => {
      const batch = this.buffer;
      this.buffer = [];
      for (let index = 0; index < batch.length; index += INSERT_CHUNK) {
        const chunk = batch.slice(index, index + INSERT_CHUNK);
        try {
          await this.frames.insert(
            chunk.map((frame) => ({
              executionId: frame.executionId,
              stream: frame.stream,
              kind: frame.kind,
              vehicleCode: frame.vehicleCode,
              topic: frame.topic,
              receivedAt: String(frame.receivedAt),
              operatingAt: String(frame.operatingAt),
              vehicleTs:
                frame.vehicleTs == null ? null : String(frame.vehicleTs),
              payload: frame.payload as DegradedReplayFrame['payload'],
            })),
          );
          this.onWritten(chunk);
        } catch (error) {
          this.onWriteFailed(chunk, error);
        }
      }
      await this.persistSession();
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private onWritten(chunk: PendingFrame[]) {
    const session = this.session;
    if (!session || chunk[0]?.executionId !== session.executionId) return;
    session.frameCount += chunk.length;
    session.lastWrittenReal = Date.now();
  }

  private onWriteFailed(chunk: PendingFrame[], error: unknown) {
    const message = (error as Error)?.message ?? String(error);
    this.logger.error(`降級回放資料寫入失敗（${chunk.length} 筆）：${message}`);
    const session = this.session;
    if (!session || chunk[0]?.executionId !== session.executionId) return;
    session.droppedCount += chunk.length;
    session.lastError = message.slice(0, 500);
    session.gaps.push({
      from_real: Math.min(...chunk.map((frame) => frame.receivedAt)),
      to_real: Math.max(...chunk.map((frame) => frame.receivedAt)),
      from_operating: Math.min(...chunk.map((frame) => frame.operatingAt)),
      to_operating: Math.max(...chunk.map((frame) => frame.operatingAt)),
      reason: 'write_failed',
      count: chunk.length,
    });
  }

  private async persistSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await this.sessions.update(
        { executionId: session.executionId },
        {
          frameCount: String(session.frameCount),
          droppedCount: String(session.droppedCount),
          gaps: session.openGap
            ? [...session.gaps, session.openGap]
            : session.gaps,
          lastError: session.lastError,
          lastWrittenReal:
            session.lastWrittenReal == null
              ? null
              : String(session.lastWrittenReal),
          updatedAt: String(Date.now()),
        },
      );
    } catch (error) {
      // 計數留在記憶體，下一次再寫；資料本身已經在上面處理過
      this.logger.warn(`降級回放保存範圍更新失敗：${(error as Error).message}`);
    }
  }

  private activate(session: ActiveSession) {
    this.session = session;
    this.lastPayloadKey.clear();
    this.lastHealthAt.clear();
    this.capturedOrders.clear();
  }

  private clockRun(): string {
    const snapshot = this.clock.snapshot();
    return `${snapshot.mode}:${snapshot.run_id ?? ''}`;
  }

  /**
   * 開始時這張地圖用的車輛模型：整份模型內容＋顯示設定一起存（不可變快照），
   * 不只存 ID——模型之後被改或刪，回放還是畫當時的樣子。
   */
  private async snapshotVehicleModel(
    mapId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await vehicleModelSnapshot(this.mapVehicles, mapId);
    } catch (error) {
      this.logger.warn(
        `降級開始時無法保存車輛模型：${(error as Error).message}`,
      );
      return null;
    }
  }

  private async saveActiveMap(): Promise<{
    mapId: string;
    hash: string;
    version: string | null;
    displayName: string | null;
  } | null> {
    try {
      return await saveActiveMapSnapshot(this.mapService, this.maps);
    } catch (error) {
      this.logger.error(`降級開始時無法保存地圖：${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 開始那一刻的狀態：各車最新的遙測／營運／健康（已失聯的車不算，即時畫面也不會畫它），
   * 以及未結案訂單的站序。這是回放的起點，之後的資料都疊在它上面。
   */
  private async captureInitialState(
    executionId: string,
    startedAtOperating: number,
  ): Promise<void> {
    const receivedAt = Date.now();
    // 一般運行歷史有錄製時，開始那一刻各車的狀態由歷史的起點快照提供，不再另存一份
    const historyBacked = this.session?.framesSource === 'history';
    for (const vehicleCode of historyBacked ? [] : this.lastTelemetrySeen.keys()) {
      // 最近 REPLAY_STALE_AFTER_MS 內沒收到遙測的車不算在場（即時圖台也不會畫它）
      const seenAt = this.lastTelemetrySeen.get(vehicleCode);
      if (seenAt === undefined || receivedAt - seenAt > REPLAY_STALE_AFTER_MS)
        continue;
      const [telemetry, operation, health] = await Promise.all([
        this.redis.getTelemetry(vehicleCode),
        this.redis.getOperationUpdate(vehicleCode),
        this.redis.getHealth(vehicleCode),
      ]);
      const state = { telemetry, operation, health };
      for (const stream of ['telemetry', 'operation', 'health'] as const) {
        const payload = state[stream];
        if (!payload || typeof payload !== 'object') continue;
        this.lastPayloadKey.set(
          `${stream}|${vehicleCode}|`,
          stream === 'health' ? healthContentKey(payload) : JSON.stringify(payload),
        );
        this.buffer.push({
          executionId,
          stream,
          kind: 'initial',
          vehicleCode,
          topic: null,
          receivedAt,
          operatingAt: startedAtOperating,
          vehicleTs: numberOrNull(payload.timestamp),
          payload,
        });
      }
    }
    const open = await this.dataSource.query<Array<{ order_id: string }>>(
      `SELECT order_id FROM operation_orders WHERE status IN ('PENDING', 'PROCESSING')`,
    );
    const ids = open.map((row) => row.order_id);
    ids.forEach((id) => this.capturedOrders.add(id));
    await this.captureOrders(executionId, ids, 'initial', startedAtOperating);
    await this.flush();
    await this.sessions
      .update({ executionId }, { initialCaptured: true })
      .catch(() => undefined);
  }

  /** 訂單在那一刻的站序與用途（判位與出廠呈現要用），以 topic＝訂單號保存 */
  private async captureOrders(
    executionId: string,
    orderIds: string[],
    kind: 'initial' | 'live',
    operatingAt?: number,
  ): Promise<void> {
    if (orderIds.length === 0) return;
    try {
      const rows = await this.dataSource.query<
        Array<{
          order_id: string;
          vehicle_code: string;
          status: string;
          trip_code: string;
          payload: Record<string, unknown> | null;
        }>
      >(
        `SELECT order_id, vehicle_code, status, trip_code, payload
           FROM operation_orders WHERE order_id = ANY($1)`,
        [orderIds],
      );
      const receivedAt = Date.now();
      const at = operatingAt ?? this.clock.now(receivedAt);
      for (const row of rows) {
        const payload = row.payload ?? {};
        const stations = Array.isArray(payload.stations)
          ? (payload.stations as Array<{ station_id?: unknown }>)
              .map((station) =>
                typeof station?.station_id === 'string'
                  ? station.station_id
                  : '',
              )
              .filter(Boolean)
          : [];
        if (this.session?.executionId !== executionId) return;
        const snapshot = {
          order_id: row.order_id,
          vehicle_code: row.vehicle_code,
          trip_code: row.trip_code,
          status: row.status,
          stations,
          transition_purpose: payload.transition_purpose ?? null,
          transition_facility: payload.transition_facility ?? null,
          execution_id: executionId,
          kind,
        };
        if (this.session.framesSource === 'history') {
          // 同一張歷史表、同一序號空間；降級回放依營運時間讀
          const accepted = this.history.captureSystem({
            stream: 'order_route',
            streamKey: `order_route|${row.order_id}`,
            vehicleCode: row.vehicle_code,
            orderId: row.order_id,
            payload: snapshot,
            receivedAt,
            operatingAt: at,
          });
          if (accepted) continue;
        }
        this.buffer.push({
          executionId,
          stream: 'order',
          kind,
          vehicleCode: row.vehicle_code,
          topic: row.order_id,
          receivedAt,
          operatingAt: at,
          vehicleTs: null,
          payload: snapshot,
        });
      }
    } catch (error) {
      this.logger.warn(`降級回放無法保存訂單站序：${(error as Error).message}`);
    }
  }

  /**
   * 後端重啟時降級還在進行：接著保存，並把重啟期間記成缺段。
   * 功能上線前就開始的降級沒有初始狀態，從現在起保存，之前那段標成未保存。
   */
  private async resumeAfterRestart(): Promise<void> {
    const execution = await this.executions.findOne({
      where: { executionStatus: In(REPLAY_RECORDING_STATUSES) },
    });
    if (!execution?.startedAtReal || !execution.startedAtOperating) return;
    const now = Date.now();
    const operatingNow = this.clock.now(now);
    let session = await this.sessions.findOne({
      where: { executionId: execution.id },
    });
    const gaps: ReplayGap[] = session?.gaps ? [...session.gaps] : [];
    if (!session) {
      gaps.push({
        from_real: Number(execution.startedAtReal),
        to_real: now,
        from_operating: Number(execution.startedAtOperating),
        to_operating: operatingNow,
        reason: 'not_recorded',
      });
      session = await this.sessions.save(
        this.sessions.create({
          executionId: execution.id,
          status: 'recording',
          mapId: null,
          mapHash: null,
          mapVersion: null,
          mapDisplayName: null,
          vehicleModel: null,
          clockRun: this.clockRun(),
          startedReal: execution.startedAtReal,
          startedOperating: execution.startedAtOperating,
          endedReal: null,
          endedOperating: null,
          initialCaptured: false,
          frameCount: '0',
          droppedCount: '0',
          gaps,
          lastError: '降級開始時沒有保存回放資料（功能上線前開始）',
          lastWrittenReal: String(now),
          updatedAt: String(now),
        }),
      );
    }
    // 已存資料的最後營運時刻：重啟缺段從這裡開始。這時候營運時鐘可能還沒接回來
    // （執行端心跳未到），所以缺段的結束時刻等第一筆時間正確的資料到了才定
    const [last] = await this.dataSource.query<
      Array<{ operating_at: string | null }>
    >(
      `SELECT MAX(operating_at) AS operating_at FROM degraded_replay_frames WHERE execution_id = $1`,
      [execution.id],
    );
    const lastOperatingAt = Math.max(
      Number(execution.startedAtOperating),
      Number(last?.operating_at ?? 0) || 0,
    );
    const resumedWithSession =
      session.initialCaptured || Number(session.frameCount) > 0;
    this.activate({
      executionId: execution.id,
      // 舊 session 沒有這一欄（預設 degraded）：照它原本的方式接著存
      framesSource: session.framesSource === 'history' && this.history.enabled() ? 'history' : 'degraded',
      clockRun: session.clockRun ?? this.clockRun(),
      frameCount: Number(session.frameCount) || 0,
      droppedCount: Number(session.droppedCount) || 0,
      gaps,
      openGap: resumedWithSession
        ? {
            from_real: Number(session.lastWrittenReal ?? session.startedReal),
            to_real: now,
            from_operating: lastOperatingAt,
            to_operating: null,
            reason: 'backend_restart',
          }
        : null,
      lastError: session.lastError,
      lastWrittenReal: now,
      limitReached: false,
      lastOperatingAt: resumedWithSession ? lastOperatingAt : operatingNow,
    });
    await this.persistSession();
    this.logger.warn(
      `降級 ${execution.id} 進行中，回放保存已接續；重啟期間記為資料缺段`,
    );
  }
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && value !== null && value !== ''
    ? number
    : null;
}
