import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CommandLog } from '../database/entities/command-log.entity';
import { SecurityEventLog, EventCode, Severity } from '../database/entities/security-event-log.entity';
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
  private lastVehiclePositionInvalidationAt = 0;
  private lastOrderLifecycleInvalidationAt = 0;
  /** 各車上一次判定的所在設施（無則空字串）；換格或離格時才通知整備分佈重查 */
  private readonly lastFacilityByVehicle = new Map<string, string>();

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

  /**
   * 每筆 telemetry 都由中心端依啟用圖資判定位置，並覆寫一車一筆的 DB 快照。
   * 顯示優先序在 MapService 固定為站點 → 設施 → 軌道；前端只讀結果，不再重算。
   */
  async updateVehicleLivePosition(vehicleCode: string, payload: Record<string, unknown>): Promise<void> {
    const position = (payload as { local_pose?: { position?: { x?: unknown; y?: unknown } } })
      ?.local_pose?.position;
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const mapId = this.mapService.getActiveMapLibraryStatus().activeMapId;
    const velocity = Number((payload as { kinematics?: { velocity?: unknown } }).kinematics?.velocity);
    // 車速（m/s）一起給：開著的車座標落進設施矩形（例如被支線穿過的 M1）不算「在設施裡」
    const location = this.mapService.findVehicleLocationAtPoint(mapId, x, y, {
      speedMps: Number.isFinite(velocity) ? velocity : null,
    });
    const battery = Number((payload as { energy?: { battery_level?: unknown } }).energy?.battery_level);
    const timestamp = Number(payload.timestamp);
    await this.dataSource.query(
      `INSERT INTO vehicle_monitor_demo (
         vehicle_code, segment_label, location_kind, location_object_id,
         position_x, position_y, position_updated_at, demo_speed, demo_load
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (vehicle_code) DO UPDATE SET
         segment_label = EXCLUDED.segment_label,
         location_kind = EXCLUDED.location_kind,
         location_object_id = EXCLUDED.location_object_id,
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         position_updated_at = EXCLUDED.position_updated_at,
         demo_speed = EXCLUDED.demo_speed,
         demo_load = EXCLUDED.demo_load`,
      [
        vehicleCode,
        location?.label ?? '場域外',
        location?.kind ?? 'UNKNOWN',
        location?.objectId ?? null,
        x,
        y,
        Number.isFinite(timestamp) ? timestamp : Date.now(),
        Number.isFinite(velocity) ? velocity * 3.6 : null,
        Number.isFinite(battery) ? battery : null,
      ],
    );

    // 整備分佈只在「車進出格位」時需要重查：每秒的 telemetry 大多只是位置微動
    const facilityId = location?.kind === 'FACILITY' ? String(location.objectId ?? '') : '';
    const previousFacilityId = this.lastFacilityByVehicle.get(vehicleCode);
    this.lastFacilityByVehicle.set(vehicleCode, facilityId);
    if (previousFacilityId !== undefined && previousFacilityId !== facilityId) {
      this.datasourceInvalidation.emitMaintenanceSlots();
    }

    // 一秒內通常會連續收到整個車隊的 telemetry。資料逐筆寫庫，但失效通知合併成
    // 每秒最多一次；前端收到後會重查整張車輛快照，避免 11 台車造成 11 次 SQL。
    const now = Date.now();
    if (now - this.lastVehiclePositionInvalidationAt >= 1_000) {
      this.lastVehiclePositionInvalidationAt = now;
      this.datasourceInvalidation.emitVehiclePosition(vehicleCode);
    }
  }

  /**
   * operation/update 不再要求車端回報 yard_slot_id：改由中心端用車輛最近一次
   * telemetry/update 回報的 local_pose.position 比對場區格位範圍。車輛停在
   * 正線軌道（座標不落在任何格位範圍內）時，維持不補值——語意與舊版
   * 「車輛停於正線時省略此欄位」相同。
   *
   * 若車端仍帶了 yard_slot_id（舊版車端／模擬器相容），保留原值不覆蓋。
   */
  async enrichWithFacilityLocation(
    vehicleCode: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.nonEmptyString(payload?.yard_slot_id)) {
      return payload;
    }
    try {
      const telemetry = await this.redisService.getTelemetry(vehicleCode);
      const position = (telemetry as { local_pose?: { position?: { x?: unknown; y?: unknown } } } | null)
        ?.local_pose?.position;
      const x = typeof position?.x === 'number' ? position.x : null;
      const y = typeof position?.y === 'number' ? position.y : null;
      if (x == null || y == null) return payload;

      const mapId = this.mapService.getActiveMapLibraryStatus().activeMapId;
      const hit = this.mapService.findFacilityAtPoint(mapId, x, y);
      if (!hit) return payload;
      return { ...payload, yard_slot_id: hit.mapCode };
    } catch (err) {
      this.logger.debug(`facility location lookup skipped for ${vehicleCode}: ${(err as Error)?.message}`);
      return payload;
    }
  }

  async saveTelemetry(vehicleCode: string, payload: any) {
    await this.saveTelemetryBatch([{ vehicleCode, payload }]);
  }

  async saveTelemetryBatch(batch: Array<{ vehicleCode: string; payload: any }>) {
    if (batch.length === 0 || this.telemetryPersistDisabled) return;

    const rows = batch.map(({ vehicleCode, payload }) => ({
      vehicleCode,
      timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
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

  /** MQTT operation/update → 增量更新訂單（單一路徑，委派 OrderService） */
  async syncOperationOrderFromLive(vehicleCode: string, payload: Record<string, unknown>) {
    const tripCode =
      this.nonEmptyString(payload?.trip_code)
      ?? (this.isShiftTripCode(payload?.badge_label) ? this.nonEmptyString(payload?.badge_label) : null);
    if (!tripCode) return;

    const orderId = this.nonEmptyString(payload?.order_id)
      ?? this.deriveOrderId(tripCode, payload?.timestamp);
    const leg = payload.current_leg as {
      target_station_id?: string;
      eta_seconds?: number;
    } | undefined;
    const syncKey = JSON.stringify({
      orderId,
      tripCode,
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
      await this.orderService.applyOperationMqttUpdate(vehicleCode, {
        ...payload,
        order_id: orderId,
        trip_code: tripCode,
        vehicle_code: vehicleCode,
      });
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
      const now = Date.now();
      if (now - this.lastOrderLifecycleInvalidationAt >= 1_000) {
        this.lastOrderLifecycleInvalidationAt = now;
        this.datasourceInvalidation.emitOrderLifecycle(vehicleCode);
      }
    } catch (err) {
      this.logger.warn(`operation/update sync failed for ${vehicleCode}: ${(err as Error)?.message ?? err}`);
    }
  }

  private isShiftTripCode(raw: unknown): boolean {
    return typeof raw === 'string' && /^[DU]\d{4}$/i.test(raw.trim());
  }

  private deriveOrderId(tripCode: string, departMs?: unknown): string {
    const base = typeof departMs === 'number' && Number.isFinite(departMs)
      ? new Date(departMs)
      : new Date();
    const yy = String(base.getFullYear()).slice(2);
    const mm = String(base.getMonth() + 1).padStart(2, '0');
    const dd = String(base.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}-${tripCode.trim().toUpperCase()}`;
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
      return;
    }

    // 2. 驗證 event_id 格式：EVT-YYYYMMDD-XXXX
    const eventIdPattern = /^EVT-\d{8}-\d{4}$/;
    if (!eventIdPattern.test(event_id)) {
      this.logger.warn(`[Event Report] Invalid event_id format: '${event_id}' from ${vehicleCode}, discarding.`);
      return;
    }

    // 3. 驗證 event_code 是否在規格書定義的白名單內（閉鎖式管理）
    const validEventCodes = Object.values(EventCode) as string[];
    if (!validEventCodes.includes(event_code)) {
      this.logger.warn(`[Event Report] Unknown event_code: '${event_code}' from ${vehicleCode}, discarding.`);
      return;
    }

    // 4. 驗證 severity
    const validSeverities = Object.values(Severity) as string[];
    if (!validSeverities.includes(severity)) {
      this.logger.warn(`[Event Report] Invalid severity: '${severity}' from ${vehicleCode}, discarding.`);
      return;
    }

    // 5. 儲存車端上報的安全事件
    const displayMessage = this.resolveEventDisplayMessage(event_code, detail);
    const newEvent = this.securityEventLogRepository.create({
      eventId: event_id,
      vehicleCode,
      eventCode: event_code as EventCode,
      severity,
      location,
      detail,
      ...(displayMessage ? { displayMessage } : {}),
      params: payload.params,
      createdAt: timestamp || (new Date().getTime()).toString()
    });

    await this.securityEventLogRepository.save(newEvent);
    this.datasourceInvalidation.emitEventCenter();
    this.logger.warn(`[Security Event] Vehicle ${vehicleCode} reported ${severity} event: ${event_code}`);

    if (severity === 'CRITICAL') {
      await this.orderService.faultActiveOrderForVehicle(vehicleCode, event_code);
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
  async recordHealthDegradedEvent(vehicleCode: string, payload: any) {
    const ts = typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now();
    const dateStr = new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
    const eventId = `EVT-${dateStr}-${String(ts % 10000).padStart(4, '0')}`;

    const errorSubsystems = Object.entries(payload?.subsystems ?? {})
      .filter(([, sub]: [string, any]) => sub?.status === 'ERROR')
      .map(([name]) => name);

    try {
      const row = this.securityEventLogRepository.create({
        eventId,
        vehicleCode,
        eventCode: EventCode.SYSTEM_HEALTH_DEGRADED,
        severity: Severity.CRITICAL,
        detail: errorSubsystems.length
          ? `Health degraded to ERROR: ${errorSubsystems.join(', ')}`
          : 'Health degraded to ERROR',
        displayMessage: this.resolveEventDisplayMessage('SYSTEM_HEALTH_DEGRADED') ?? undefined,
        params: { subsystems: payload?.subsystems },
        createdAt: String(ts),
      });
      await this.securityEventLogRepository.save(row);
    } catch (err) {
      // 同一秒內重複劣化可能造成 PK 衝突，忽略即可（已有當秒紀錄）
      this.logger.debug(`[Health Degraded] persist skipped for ${vehicleCode}: ${(err as Error)?.message}`);
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
