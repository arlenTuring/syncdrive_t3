import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CommandLog } from '../database/entities/command-log.entity';
import { SecurityEventLog, EventCode, Severity, securityEventDedupKey } from '../database/entities/security-event-log.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { SlotStatus_ } from '../database/entities/slot-status.entity';
import { OrderService } from '../order/order.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { RedisService } from '../redis/redis.service';
import { MapService } from '../map/map.service';

@Injectable()
export class MqttService {
  private readonly logger = new Logger(MqttService.name);
  private telemetryPersistDisabled = false;
  private readonly operationSyncCache = new Map<string, { at: number; key: string }>();
  private readonly operationDiagnosedAt = new Map<string, number>();
  private lastVehiclePositionInvalidationAt = 0;
  private lastOrderLifecycleInvalidationAt = 0;
  /** 各車上一次判定的所在設施（無則空字串）；換格或離格時才通知整備分佈重查 */
  private readonly lastFacilityByVehicle = new Map<string, string>();
  /** 各車上一次判定的位置標籤（站／設施／軌道）；變了才需要通知車輛狀態重查 */
  private readonly lastLocationByVehicle = new Map<string, string>();
  private vehiclePositionDirty = false;
  /** 各車上一次通知時的訂單顯示狀態；沒變就不通知 */
  private readonly lastOrderDisplayKeyByVehicle = new Map<string, string>();
  private readonly pausedLiveInputs = new Set<string>();
  private readonly registeredVehicleCache = new Map<string, { active: boolean; until: number }>();

  constructor(
    @InjectRepository(CommandLog)
    private commandLogRepository: Repository<CommandLog>,
    @InjectRepository(SecurityEventLog)
    private securityEventLogRepository: Repository<SecurityEventLog>,
    @InjectRepository(TelemetryLog)
    private telemetryLogRepository: Repository<TelemetryLog>,
    @InjectRepository(SlotStatus_)
    private slotStatusRepository: Repository<SlotStatus_>,
    private readonly orderService: OrderService,
    private readonly datasourceInvalidation: DatasourceInvalidationService,
    private readonly redisService: RedisService,
    private readonly mapService: MapService,
    private readonly dataSource: DataSource,
  ) {}

  pauseLiveInputs(vehicleCodes: string[]): void {
    vehicleCodes.forEach((code) => {
      this.pausedLiveInputs.add(code);
      this.registeredVehicleCache.set(code, { active: false, until: Number.POSITIVE_INFINITY });
    });
  }

  resumeLiveInputs(vehicleCodes: string[]): void {
    vehicleCodes.forEach((code) => this.pausedLiveInputs.delete(code));
  }

  isLiveInputPaused(vehicleCode: string): boolean {
    return this.pausedLiveInputs.has(vehicleCode);
  }

  async acceptsVehicleInput(vehicleCode: string): Promise<boolean> {
    if (this.pausedLiveInputs.has(vehicleCode)) return false;
    const cached = this.registeredVehicleCache.get(vehicleCode);
    if (cached && cached.until > Date.now()) return cached.active;
    const rows = await this.dataSource.query(
      `SELECT 1 FROM vehicles WHERE vehicle_code = $1 AND is_active = true LIMIT 1`,
      [vehicleCode],
    );
    const active = rows.length > 0;
    this.registeredVehicleCache.set(vehicleCode, { active, until: Date.now() + 2_000 });
    return active;
  }

  clearLiveCaches(vehicleCodes: string[]): void {
    vehicleCodes.forEach((code) => {
      this.operationSyncCache.delete(code);
      this.lastFacilityByVehicle.delete(code);
      this.lastLocationByVehicle.delete(code);
      this.lastOrderDisplayKeyByVehicle.delete(code);
    });
    this.vehiclePositionDirty = false;
  }

  /**
   * 每筆 telemetry 都由中心端依啟用圖資判定位置，並覆寫一車一筆的 DB 快照。
   * 顯示優先序在 MapService 固定為站點 → 設施 → 軌道；前端只讀結果，不再重算。
   */
  async updateVehicleLivePosition(
    vehicleCode: string,
    payload: Record<string, unknown>,
    receivedAt = Date.now(),
  ): Promise<{
    persisted: boolean;
    dataAt: number;
    receivedAt: number;
    derivedLocation: { label: string | null; kind: string | null; objectId: string | null };
  }> {
    const position = (payload as { local_pose?: { position?: { x?: unknown; y?: unknown; z?: unknown } } })
      ?.local_pose?.position;
    const x = Number(position?.x);
    const y = Number(position?.y);
    const dataAt = Number(payload.timestamp);
    if (!Number.isSafeInteger(dataAt) || dataAt <= 0) {
      throw new Error(`telemetry timestamp 無效：${String(payload.timestamp)}`);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('telemetry 缺少有效 local_pose.position.x/y');
    }

    const mapId = this.mapService.getActiveMapLibraryStatus().activeMapId;
    const velocity = Number((payload as { kinematics?: { velocity?: unknown } }).kinematics?.velocity);
    // 車速（m/s）一起給：開著的車座標落進設施矩形（例如被支線穿過的 M1）不算「在設施裡」
    const location = this.mapService.findVehicleLocationAtPoint(mapId, x, y, {
      speedMps: Number.isFinite(velocity) ? velocity : null,
    });
    const battery = Number((payload as { energy?: { battery_level?: unknown } }).energy?.battery_level);
    const z = Number(position?.z);
    const localPose = payload.local_pose as { heading?: unknown } | undefined;
    const heading = Number(localPose?.heading);
    const gear = (payload.actuation_feedback as { gear?: unknown } | undefined)?.gear;
    const rows = await this.dataSource.query(
      `INSERT INTO vehicle_monitor_demo (
         vehicle_code, segment_label, location_kind, location_object_id,
         position_x, position_y, position_z, heading_rad, position_updated_at,
         demo_speed, demo_load, gear, map_id,
         telemetry_payload, telemetry_derived, telemetry_data_at, telemetry_received_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (vehicle_code) DO UPDATE SET
         segment_label = EXCLUDED.segment_label,
         location_kind = EXCLUDED.location_kind,
         location_object_id = EXCLUDED.location_object_id,
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         position_z = EXCLUDED.position_z,
         heading_rad = EXCLUDED.heading_rad,
         position_updated_at = EXCLUDED.position_updated_at,
         demo_speed = EXCLUDED.demo_speed,
         demo_load = EXCLUDED.demo_load,
         gear = EXCLUDED.gear,
         map_id = EXCLUDED.map_id,
         telemetry_payload = EXCLUDED.telemetry_payload,
         telemetry_derived = EXCLUDED.telemetry_derived,
         telemetry_data_at = EXCLUDED.telemetry_data_at,
         telemetry_received_at = EXCLUDED.telemetry_received_at
       WHERE vehicle_monitor_demo.telemetry_data_at IS NULL
          OR vehicle_monitor_demo.telemetry_data_at < EXCLUDED.telemetry_data_at
       RETURNING vehicle_code`,
      [
        vehicleCode,
        location?.label ?? '場域外',
        location?.kind ?? 'UNKNOWN',
        location?.objectId ?? null,
        x,
        y,
        Number.isFinite(z) ? z : null,
        Number.isFinite(heading) ? heading : null,
        dataAt,
        Number.isFinite(velocity) ? velocity * 3.6 : null,
        Number.isFinite(battery) ? battery : null,
        typeof gear === 'string' && ['P', 'R', 'N', 'D'].includes(gear) ? gear : null,
        mapId ?? null,
        JSON.stringify(payload),
        JSON.stringify({
          mapId: mapId ?? null,
          label: location?.label ?? null,
          kind: location?.kind ?? null,
          objectId: location?.objectId ?? null,
        }),
        dataAt,
        receivedAt,
      ],
    );

    // 整備分佈只在「車進出格位」時需要重查：每秒的 telemetry 大多只是位置微動
    const facilityId = location?.kind === 'FACILITY' ? String(location.objectId ?? '') : '';
    const previousFacilityId = this.lastFacilityByVehicle.get(vehicleCode);
    this.lastFacilityByVehicle.set(vehicleCode, facilityId);
    if (previousFacilityId !== undefined && previousFacilityId !== facilityId) {
      this.datasourceInvalidation.emitMaintenanceSlots();
    }

    // 一秒內通常會連續收到整個車隊的 telemetry。資料逐筆寫庫，但失效通知只在
    // 「某台車的位置標籤變了」時才發，而且合併成每秒最多一次。速度、電量等即時數值
    // 儀表板直接吃 MQTT，不靠重查；原本每筆遙測都觸發整張車輛快照重查＋整排卡片重畫，
    // 畫面每秒卡一下（2026-09-27 實測 100～190 毫秒的長任務）。
    const locationKey = `${location?.kind ?? ''}|${location?.label ?? ''}|${location?.objectId ?? ''}`;
    if (this.lastLocationByVehicle.get(vehicleCode) !== locationKey) {
      this.lastLocationByVehicle.set(vehicleCode, locationKey);
      this.vehiclePositionDirty = true;
    }
    const now = Date.now();
    if (this.vehiclePositionDirty && now - this.lastVehiclePositionInvalidationAt >= 1_000) {
      this.lastVehiclePositionInvalidationAt = now;
      this.vehiclePositionDirty = false;
      this.datasourceInvalidation.emitVehiclePosition(vehicleCode);
    }
    return {
      persisted: rows.length > 0,
      dataAt,
      receivedAt,
      derivedLocation: {
        label: location?.label ?? null,
        kind: location?.kind ?? null,
        objectId: location?.objectId ?? null,
      },
    };
  }

  /** operation/update 的一車一筆最後有效快照；REST 訂單狀態仍由 OrderService 管理。 */
  async persistOperationSnapshot(
    vehicleCode: string,
    payload: Record<string, unknown>,
    receivedAt = Date.now(),
  ): Promise<{ persisted: boolean; dataAt: number; receivedAt: number }> {
    const dataAt = Number(payload.timestamp);
    if (!Number.isSafeInteger(dataAt) || dataAt <= 0) {
      throw new Error(`operation timestamp 無效：${String(payload.timestamp)}`);
    }
    const rows = await this.dataSource.query(
      `INSERT INTO vehicle_monitor_demo (
         vehicle_code, operation_payload, operation_data_at, operation_received_at
       ) VALUES ($1,$2,$3,$4)
       ON CONFLICT (vehicle_code) DO UPDATE SET
         operation_payload = EXCLUDED.operation_payload,
         operation_data_at = EXCLUDED.operation_data_at,
         operation_received_at = EXCLUDED.operation_received_at
       WHERE vehicle_monitor_demo.operation_data_at IS NULL
          OR vehicle_monitor_demo.operation_data_at < EXCLUDED.operation_data_at
       RETURNING vehicle_code`,
      [vehicleCode, JSON.stringify(payload), dataAt, receivedAt],
    );
    return { persisted: rows.length > 0, dataAt, receivedAt };
  }

  /** health/heartbeat 快照。只有資料 timestamp 前進時才刷新在線接收時間。 */
  async persistHealthSnapshot(
    vehicleCode: string,
    payload: Record<string, unknown>,
    receivedAt = Date.now(),
  ): Promise<{ persisted: boolean; dataAt: number; receivedAt: number }> {
    const dataAt = Number(payload.timestamp);
    if (!Number.isSafeInteger(dataAt) || dataAt <= 0) {
      throw new Error(`health timestamp 無效：${String(payload.timestamp)}`);
    }
    const rows = await this.dataSource.query(
      `INSERT INTO vehicle_monitor_demo (
         vehicle_code, health_payload, health_data_at, health_received_at,
         health_fresh_received_at, overall_health
       ) VALUES ($1,$2,$3,$4,$4,$5)
       ON CONFLICT (vehicle_code) DO UPDATE SET
         health_payload = EXCLUDED.health_payload,
         health_data_at = EXCLUDED.health_data_at,
         health_received_at = EXCLUDED.health_received_at,
         health_fresh_received_at = EXCLUDED.health_fresh_received_at,
         overall_health = EXCLUDED.overall_health
       WHERE vehicle_monitor_demo.health_data_at IS NULL
          OR vehicle_monitor_demo.health_data_at < EXCLUDED.health_data_at
       RETURNING vehicle_code`,
      [vehicleCode, JSON.stringify(payload), dataAt, receivedAt, String(payload.overall_health)],
    );
    return { persisted: rows.length > 0, dataAt, receivedAt };
  }

  async saveTelemetry(vehicleCode: string, payload: any) {
    await this.saveTelemetryBatch([{ vehicleCode, payload }]);
  }

  async saveTelemetryBatch(batch: Array<{ vehicleCode: string; payload: any; receivedAt?: number }>) {
    if (batch.length === 0 || this.telemetryPersistDisabled) return;

    const rows = batch.map(({ vehicleCode, payload, receivedAt }) => ({
      vehicleCode,
      timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
      receivedAt: String(receivedAt ?? Date.now()),
      rawPayload: payload,
    }));

    try {
      await this.telemetryLogRepository.insert(rows);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '53100') {
        this.telemetryPersistDisabled = true;
        this.logger.error(
          '[Telemetry DB] Disk full — disabling telemetry persistence for this session. Dashboard MQTT streaming continues via Redis.',
        );
        return;
      }
      this.logger.error(`[Telemetry DB] Failed to save batch (${batch.length})`, err);
    }
  }

  shouldPersistTelemetry(vehicleCode: string): boolean {
    if (this.telemetryPersistDisabled) return false;
    if (process.env.TELEMETRY_PERSIST_ALL === '1') return true;
    // 儀表板 PMS 示範車：即時資料走 Redis／Socket，不寫入時序庫
    return !/^PMS\d{2}$/i.test(vehicleCode);
  }

  /**
   * MQTT operation/update → 增量更新訂單（單一路徑，委派 OrderService）。
   *
   * 只用車端回報的 order_id 對應訂單：不從 trip_code／badge_label 拼單號、不看班次代號格式。
   * 待命時協議本來就不帶 order_id，那是正常；帶了班次或任務狀態卻沒有 order_id，記一筆診斷。
   */
  async syncOperationOrderFromLive(vehicleCode: string, payload: Record<string, unknown>) {
    const orderId = this.nonEmptyString(payload?.order_id);
    if (!orderId) {
      const status = String(payload?.order_status ?? '').toUpperCase();
      if (this.nonEmptyString(payload?.trip_code) || status === 'PENDING' || status === 'PROCESSING') {
        this.diagnoseOperation(vehicleCode, 'missing_order_id', payload);
      }
      return;
    }
    const tripCode = this.nonEmptyString(payload?.trip_code);
    const leg = payload.current_leg as {
      target_station_id?: string;
      eta_seconds?: number;
    } | undefined;
    const syncKey = JSON.stringify({
      orderId,
      tripCode,
      phase: payload.vehicle_phase ?? null,
      legTarget: leg?.target_station_id ?? null,
      eta: typeof leg?.eta_seconds === 'number'
        ? Math.round(leg.eta_seconds / 5) * 5
        : null,
      taskRev: Array.isArray(payload.task_group)
        ? (payload.task_group as Array<{ task_id?: string; status?: string }>)
            .map((t) => `${t.task_id}:${t.status}`)
            .join('|')
        : '',
    });
    const now = Date.now();
    const cached = this.operationSyncCache.get(vehicleCode);
    if (cached?.key === syncKey && now - cached.at < 2500) return;
    this.operationSyncCache.set(vehicleCode, { at: now, key: syncKey });

    try {
      // line_kind／route_id 不再由這裡猜測：訂單建立時中心端已經寫死
      // order.lineKind／order.routeId，applyOperationMqttUpdate 會直接信任
      // 既有訂單記錄，不需要在進來的路上先幫車端補值。
      const { order, outcome, assignedVehicle } = await this.orderService.applyOperationMqttUpdateWithOutcome(vehicleCode, {
        ...payload,
        order_id: orderId,
        vehicle_code: vehicleCode,
      });
      if (outcome === 'missing_order_id' || outcome === 'unknown_order' || outcome === 'vehicle_mismatch' || outcome === 'stale') {
        this.diagnoseOperation(vehicleCode, outcome, payload, assignedVehicle);
      }
      /*
       * 訂單的 leg_eta_max／segment 由中心端依班表計算。寫庫後通知事件型 SQL
       * 元件重讀一次；卡片之後仍由 1 Hz MQTT 倒數平滑更新，不必輪詢資料庫。
       *
       * 跟 updateVehicleLivePosition 一樣的節流，理由也一樣：這裡沒節流時，
       * 車隊同時有好幾台在跑，dedup 只擋掉 2.5 秒內同一台車完全沒變的重複，
       * ETA 每 5 秒跨一次進位、好幾台車交錯，全域失效通知變成一秒好幾次，
       * 任何訂閱了 table:operation_orders 的清單頁（例如班次運行紀錄）就跟著
       * 一直重新整理、畫面一直閃（2026-09-23 實測：11 台車跑著，5 秒內 25 次）。
       */
      //
      // 而且只在「畫面會顯示的訂單狀態」變了才通知：狀態、下一站、目前這一段的目標站、
      // 任務進度。倒數秒數每秒都在變，但卡片的倒數本來就吃 MQTT，不需要重查資料庫；
      // 原本連倒數變了都通知，儀表板上所有綁訂單的元件幾乎每秒整批重查、重畫。
      const displayKey = JSON.stringify({
        orderId,
        status: order?.status ?? null,
        nextStation: order?.nextStation ?? null,
        legTarget: leg?.target_station_id ?? null,
        taskRev: JSON.parse(syncKey).taskRev,
      });
      const now = Date.now();
      if (
        this.lastOrderDisplayKeyByVehicle.get(vehicleCode) !== displayKey
        && now - this.lastOrderLifecycleInvalidationAt >= 1_000
      ) {
        this.lastOrderLifecycleInvalidationAt = now;
        this.lastOrderDisplayKeyByVehicle.set(vehicleCode, displayKey);
        this.datasourceInvalidation.emitOrderLifecycle(vehicleCode);
      }
    } catch (err) {
      this.logger.warn(`operation/update sync failed for ${vehicleCode}: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * operation/update 沒有套用到訂單的原因（同一台車同一種原因一分鐘記一次，避免 1 Hz 洗版）。
   * 不寫庫、不建卡，只讓維運看得到哪台車回報了對不上的東西。
   */
  private diagnoseOperation(
    vehicleCode: string,
    reason: 'missing_order_id' | 'unknown_order' | 'vehicle_mismatch' | 'stale',
    payload: Record<string, unknown>,
    assignedVehicle?: string,
  ): void {
    const key = `${vehicleCode}:${reason}`;
    const now = Date.now();
    if (now - (this.operationDiagnosedAt.get(key) ?? 0) < 60_000) return;
    this.operationDiagnosedAt.set(key, now);
    const ref = `order_id=${String(payload?.order_id ?? '—')} trip_code=${String(payload?.trip_code ?? '—')}`;
    const message = {
      missing_order_id: `${vehicleCode} 回報任務進度但沒有 order_id（${ref}），不套用到任何訂單`,
      unknown_order: `${vehicleCode} 回報的訂單不存在（${ref}），不建立訂單`,
      vehicle_mismatch: `${vehicleCode} 回報的訂單指派給 ${assignedVehicle ?? '其他車'}（${ref}），不套用`,
      stale: `${vehicleCode} 的進度回報比上一則舊（${ref}），已略過`,
    }[reason];
    this.logger.warn(`[operation/update] ${message}`);
  }

  private nonEmptyString(raw: unknown): string | null {
    if (raw == null) return null;
    const value = String(raw).trim();
    return value ? value : null;
  }

  async handleCommandAck(vehicleCode: string, payload: any) {
    const { command_id, timestamp } = payload;
    if (!command_id) return;

    // 尋找對應的指令並更新為已回覆 (Acked)
    const command = await this.commandLogRepository.findOne({ where: { commandId: command_id } });
    if (command) {
      command.isAcked = true;
      command.ackedAt = timestamp || (new Date().getTime()).toString();
      await this.commandLogRepository.save(command);
    } else {
      this.logger.warn(`[Command Acked] Received ack for unknown command ${command_id} from ${vehicleCode}`);
    }
  }

  async handleEventReport(vehicleCode: string, payload: any) {
    const { event_id, event_code, severity, location, timestamp, detail } = payload;

    // 1. 驗證必填欄位
    if (!event_id || !event_code) {
      this.logger.warn(`[Event Report] Missing event_id or event_code from ${vehicleCode}, discarding.`);
      return null;
    }

    // 2. 驗證 event_id 格式：EVT-YYYYMMDD-XXXX
    const eventIdPattern = /^EVT-\d{8}-\d{4}$/;
    if (!eventIdPattern.test(event_id)) {
      this.logger.warn(`[Event Report] Invalid event_id format: '${event_id}' from ${vehicleCode}, discarding.`);
      return null;
    }

    // 3. 驗證 event_code 是否在規格書定義的白名單內（閉鎖式管理）
    const validEventCodes = Object.values(EventCode) as string[];
    if (!validEventCodes.includes(event_code)) {
      this.logger.warn(`[Event Report] Unknown event_code: '${event_code}' from ${vehicleCode}, discarding.`);
      return null;
    }

    // 4. 驗證 severity
    const validSeverities = Object.values(Severity) as string[];
    if (!validSeverities.includes(severity)) {
      this.logger.warn(`[Event Report] Invalid severity: '${severity}' from ${vehicleCode}, discarding.`);
      return null;
    }

    // 5. 儲存車端上報的安全事件（去重規則見 securityEventDedupKey）
    //    原本 event_id 是主鍵、用 save 寫入：兩台車撞號時後到的會「更新」掉另一台車的告警。
    const dedupKey = securityEventDedupKey(vehicleCode, event_id, timestamp);
    const sameId = await this.securityEventLogRepository.find({
      where: { vehicleCode, eventId: event_id },
      select: ['id', 'dedupKey'],
    });
    if (sameId.some((row) => row.dedupKey === dedupKey)) {
      // QoS 1 重送、延遲到達的同一則：不重複新增，也不重複觸發後續處置
      this.logger.debug(`[Event Report] duplicate ${event_id} from ${vehicleCode}, ignored`);
      return null;
    }
    if (sameId.length > 0) {
      this.logger.warn(
        `[Event Report] ${vehicleCode} 重複使用 event_id ${event_id}（timestamp 不同，可能是車端重啟後流水號從頭算），當成不同事件保存`,
      );
    }
    const displayMessage = this.resolveEventDisplayMessage(event_code, detail);
    const occurredValid = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;
    const insertedId = await this.insertSecurityEvent({
      eventId: event_id,
      dedupKey,
      vehicleCode,
      sourceType: 'VEHICLE',
      sourceId: vehicleCode,
      sourceNameSnapshot: await this.vehicleNameSnapshot(vehicleCode),
      origin: 'REPORTED',
      // 車端沒給有效時間：以接收時間代替並標示「來源時間不可用」，不冒充真實發生時間
      occurredAtValid: occurredValid,
      eventCode: event_code as EventCode,
      severity,
      location,
      detail,
      ...(displayMessage ? { displayMessage } : {}),
      params: sameId.length > 0 ? { ...(payload.params ?? {}), event_id_reused: true } : payload.params,
      createdAt: occurredValid ? String(Math.trunc(timestamp)) : String(Date.now()),
      receivedAt: String(Date.now()),
    });
    if (!insertedId) return null; // 同時到達的重送：另一筆已經寫入並處理
    this.datasourceInvalidation.emitEventCenter();
    this.logger.warn(`[Security Event] Vehicle ${vehicleCode} reported ${severity} event: ${event_code}`);

    // 嚴重事件：告警與事件中心已在上面寫入／通知；訂單只標「車輛故障，結案待確認」，
    // 結案由車端用 REST 回報 FAULTED（不由中心端代替車端結案）
    if (severity === 'CRITICAL') {
      await this.orderService.markVehicleFaultOnActiveOrder(vehicleCode, event_code);
    }
    return { id: insertedId, eventId: event_id, eventCode: event_code, severity, vehicleCode };
  }

  /**
   * 新增一筆告警；去重鍵衝突（同一則同時到達兩次）回 false，不更新既有列。
   * 一律 insert，不用 save——save 遇到相同主鍵會改成更新別人的資料。
   */
  private async insertSecurityEvent(row: Partial<SecurityEventLog>): Promise<string | null> {
    try {
      const result = await this.securityEventLogRepository.insert(row);
      return String(result.identifiers[0]?.id ?? '');
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') return null;
      throw err;
    }
  }

  /** 接收當下的車輛名稱（事件日後仍可理解）；查不到就不填，不猜 */
  private async vehicleNameSnapshot(vehicleCode: string): Promise<string | null> {
    try {
      const [row] = await this.securityEventLogRepository.manager.query(
        `SELECT display_name FROM vehicles WHERE lower(vehicle_code) = lower($1) ORDER BY is_active DESC LIMIT 1`, [vehicleCode]);
      return row?.display_name?.trim() || null;
    } catch {
      return null;
    }
  }

  private resolveEventDisplayMessage(eventCode: string, detail?: string): string | null {
    const messages: Record<string, string> = {
      PATH_BLOCKED: '路徑受阻，車輛已執行安全停車',
      UNSCHEDULED_DOOR_OPEN: '行駛中偵測到車門異常開啟',
      OBSTACLE_DETECTED: '路徑上偵測到障礙物',
      DIRECTION_VIOLATION: '行向偏離或逆向行駛',
      INTERLOCK_REQ: '請求路口路權鎖定',
      SYSTEM_HEALTH_DEGRADED: '車載系統健康度下降',
    };
    if (eventCode === 'PATH_BLOCKED' && detail?.includes('Emergency stop')) {
      return '緊急停車指令：路徑受阻，車輛已安全停車';
    }
    return messages[eventCode] ?? null;
  }

  /**
   * 持久化健康劣化事件（健康總評由非 ERROR 掉到 ERROR 時）。
   * 注意：依協議 §五.5，P3 健康與 P4 事件嚴重度脫鉤——本事件僅供稽核/告警，
   * 不經 handleEventReport，故不會自動將營運訂單轉為 FAULTED。
   */
  async recordHealthDegradedEvent(vehicleCode: string, payload: any): Promise<string | null> {
    const occurredValid = typeof payload?.timestamp === 'number' && Number.isFinite(payload.timestamp) && payload.timestamp > 0;
    const ts = occurredValid ? payload.timestamp : Date.now();
    const dateStr = new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
    const eventId = `EVT-${dateStr}-${String(ts % 10000).padStart(4, '0')}`;

    const errorSubsystems = Object.entries(payload?.subsystems ?? {})
      .filter(([, sub]: [string, any]) => sub?.status === 'ERROR')
      .map(([name]) => name);

    try {
      const id = await this.insertSecurityEvent({
        eventId,
        dedupKey: securityEventDedupKey(vehicleCode, eventId, ts),
        receivedAt: String(Date.now()),
        vehicleCode,
        sourceType: 'VEHICLE',
        sourceId: vehicleCode,
        sourceNameSnapshot: await this.vehicleNameSnapshot(vehicleCode),
        // 中心端依健康心跳衍生，不是車端事件契約（§四）回報的事件
        origin: 'CENTER',
        occurredAtValid: occurredValid,
        eventCode: EventCode.SYSTEM_HEALTH_DEGRADED,
        severity: Severity.CRITICAL,
        detail: errorSubsystems.length
          ? `Health degraded to ERROR: ${errorSubsystems.join(', ')}`
          : 'Health degraded to ERROR',
        displayMessage: this.resolveEventDisplayMessage('SYSTEM_HEALTH_DEGRADED') ?? undefined,
        params: { subsystems: payload?.subsystems },
        createdAt: String(ts),
      });
      if (id) this.datasourceInvalidation.emitEventCenter();
      return id;
    } catch (err) {
      this.logger.debug(`[Health Degraded] persist skipped for ${vehicleCode}: ${(err as Error)?.message}`);
      return null;
    }
  }

  async handleSlotStatus(payload: any) {
    const { slot_id, status, vehicle_code, timestamp } = payload;
    if (!slot_id) return;

    // 使用 Upsert 模式更新格位狀態
    const slotStatus = await this.slotStatusRepository.findOne({ where: { slotId: slot_id } }) ||
                       this.slotStatusRepository.create({ slotId: slot_id });

    slotStatus.status = status;
    slotStatus.vehicleCode = vehicle_code || null;
    slotStatus.lastUpdated = timestamp || (new Date().getTime()).toString();
    slotStatus.rawPayload = payload;

    await this.slotStatusRepository.save(slotStatus);
    this.datasourceInvalidation.emitMaintenanceSlots();
  }
}
