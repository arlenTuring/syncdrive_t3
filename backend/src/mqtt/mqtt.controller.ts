import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';
import { MqttService } from './mqtt.service';
import { TelemetryWriteQueue } from './telemetry-write.queue';
import { normalizeVehicleCode } from '../common/vehicle-codes';
import { DegradedReplayRecorder } from '../degraded-replay/degraded-replay.recorder';
import { VehicleHistoryRecorder } from '../vehicle-history/vehicle-history.recorder';

/** 中心端位置判定的欄位：只由後端填，車端或前端送來的同名欄位一律不採用 */
const DERIVED_LOCATION_FIELDS = ['segment_label', 'location_kind', 'location_object_id'] as const;

/**
 * 遙測 → 給瀏覽器的副本：去掉同名的外來欄位，換成中心端這一次的判定。沒有判定（寫入失敗、
 * 沒有有效座標）就不帶，前端照「不在格位」處理，不沿用車端自報的歸屬。
 */
export function withDerivedLocation(
  payload: Record<string, unknown>,
  location: { label: string | null; kind: string | null; objectId: string | null } | undefined,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...payload };
  for (const key of DERIVED_LOCATION_FIELDS) delete copy[key];
  if (!location) return copy;
  copy.segment_label = location.label;
  copy.location_kind = location.kind;
  copy.location_object_id = location.objectId;
  return copy;
}

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly eventsGateway: EventsGateway,
    private readonly mqttService: MqttService,
    private readonly telemetryWriteQueue: TelemetryWriteQueue,
    private readonly replayRecorder: DegradedReplayRecorder,
    private readonly historyRecorder: VehicleHistoryRecorder,
  ) {}

  /**
   * 收到的原始內容：在車輛代號正規化或任何加工之前複製一份，歷史保存的是這一份
   * （見 VehicleHistoryRecorder）。下游會就地改寫 data，不能拿改過的物件當原始資料。
   */
  private rawCopy(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== 'object') return null;
    try {
      return structuredClone(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * 從 topic 取車輛代號，順手把舊寫法 `01` 收成 `PMS01`，並蓋回 payload。
   *
   * 改名不是所有發布端同一秒切換：車端、模擬器、broker 上既存的 retain 訊息會有一段
   * 混用期。topic 與 payload 各留各的寫法，下游就會出現同一台車兩個身分——訂單同步
   * 靠 vehicle_code 對 operation_orders，對不上時不會拋例外，只是安靜地什麼都沒更新。
   * 兩邊都在入口收斂成同一種寫法，後面就不必再處理。
   */
  private vehicleCodeFromTopic(topic: string, data: unknown): string | null {
    const raw = topic.split('/')[2];
    if (!raw) return null;
    const vehicleCode = normalizeVehicleCode(raw);
    if (data && typeof data === 'object') {
      const payload = data as Record<string, unknown>;
      if (typeof payload.vehicle_code === 'string') {
        payload.vehicle_code = normalizeVehicleCode(payload.vehicle_code);
      }
    }
    return vehicleCode;
  }

  private async acceptsVehicle(vehicleCode: string): Promise<boolean> {
    return typeof this.mqttService.acceptsVehicleInput !== 'function'
      || this.mqttService.acceptsVehicleInput(vehicleCode);
  }

  @MessagePattern('v1/vtms/+/telemetry/update')
  async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;
    if (!(await this.acceptsVehicle(vehicleCode))) return;

    const receivedAt = Date.now();
    if (!(await this.redisService.setTelemetry(vehicleCode, data))) {
      // 即時系統拒收（比已收到的舊或重複）：歷史照實保存並標示，回放不拿它覆蓋狀態
      this.historyRecorder.capture('telemetry', { vehicleCode, topic, payload: raw, receivedAt, derived: { rejected: 'stale_or_duplicate' } });
      return;
    }
    let persistence: {
      persisted: boolean;
      dataAt: number;
      receivedAt: number;
      derivedLocation?: { label: string | null; kind: string | null; objectId: string | null };
    } = { persisted: false, dataAt: Number(data.timestamp), receivedAt };
    try {
      persistence = await this.mqttService.updateVehicleLivePosition(vehicleCode, data, receivedAt);
    } catch (error) {
      this.logger.error(`[Telemetry snapshot] ${vehicleCode} 寫入失敗：${(error as Error).message}`);
    }
    if (this.mqttService.shouldPersistTelemetry(vehicleCode)) {
      this.telemetryWriteQueue.enqueue(vehicleCode, data);
    }

    this.historyRecorder.capture('telemetry', {
      vehicleCode,
      topic,
      payload: raw,
      receivedAt,
      derived: persistence?.derivedLocation ? { location: persistence.derivedLocation } : null,
    });
    /*
     * 給瀏覽器的副本帶上中心端對「這一筆」的位置判定（站點／設施／軌道）。圖台據此判斷車是不是
     * 停在格位裡、要不要讓車身中心對齊格位；同一筆訊息帶同一筆判定，位置與歸屬不會錯開。
     * Redis、資料庫與歷史保存的仍是車端原始內容。
     */
    const browserCopy = withDerivedLocation(data, persistence?.derivedLocation);
    // 降級進行中才會真的保存（見 DegradedReplayRecorder）；平常只是一次判斷
    this.replayRecorder.capture('telemetry', vehicleCode, null, browserCopy);
    this.eventsGateway.broadcastVehicleState({ vehicleCode, stream: 'telemetry', payload: data, ...persistence });
    this.eventsGateway.broadcastTelemetry(vehicleCode, browserCopy);
    this.eventsGateway.broadcastMqttMessage(topic, browserCopy);
  }

  @MessagePattern('v1/vtms/+/health/heartbeat')
  async handleHealth(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;
    if (!(await this.acceptsVehicle(vehicleCode))) return;

    const receivedAt = Date.now();
    const { degraded, previousHealth, accepted } = await this.redisService.setHealth(vehicleCode, data);
    if (!accepted) {
      this.historyRecorder.capture('health', { vehicleCode, topic, payload: raw, receivedAt, derived: { rejected: 'stale_or_duplicate' } });
      return;
    }
    this.historyRecorder.capture('health', { vehicleCode, topic, payload: raw, receivedAt });
    let persistence = { persisted: false, dataAt: Number(data.timestamp), receivedAt };
    try {
      persistence = await this.mqttService.persistHealthSnapshot(vehicleCode, data, receivedAt);
    } catch (error) {
      this.logger.error(`[Health snapshot] ${vehicleCode} 寫入失敗：${(error as Error).message}`);
    }

    if (degraded) {
      this.logger.warn(`[Health Degradation] ${vehicleCode} health dropped from ${previousHealth} to ERROR.`);

      // 持久化以供稽核（先前僅 broadcast，DB 無紀錄）
      const eventId = await this.mqttService.recordHealthDegradedEvent(vehicleCode, data);

      // 只在持久化成功後推播，帶中心端事件 ID（前端以 REST 重查詳情）
      if (eventId) {
        this.eventsGateway.broadcastEvent({
          id: eventId,
          vehicleCode,
          event_code: 'SYSTEM_HEALTH_DEGRADED',
          severity: 'CRITICAL',
          timestamp: data.timestamp,
          source: 'HEALTH_MONITOR',
        });
      }
    }

    this.replayRecorder.capture('health', vehicleCode, null, data);
    this.eventsGateway.broadcastVehicleState({ vehicleCode, stream: 'health', payload: data, ...persistence });
    this.eventsGateway.broadcastHealth(vehicleCode, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/operation/update')
  async handleOperationUpdate(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;
    if (!(await this.acceptsVehicle(vehicleCode))) return;

    const receivedAt = Date.now();
    if (!(await this.redisService.setOperationUpdate(vehicleCode, data))) {
      this.historyRecorder.capture('operation', { vehicleCode, topic, payload: raw, receivedAt, derived: { rejected: 'stale_or_duplicate' } });
      return;
    }
    this.historyRecorder.capture('operation', { vehicleCode, topic, payload: raw, receivedAt });
    let persistence = { persisted: false, dataAt: Number(data.timestamp), receivedAt };
    try {
      persistence = await this.mqttService.persistOperationSnapshot(vehicleCode, data, receivedAt);
    } catch (error) {
      this.logger.error(`[Operation snapshot] ${vehicleCode} 寫入失敗：${(error as Error).message}`);
    }
    await this.mqttService.syncOperationOrderFromLive(vehicleCode, data);

    this.replayRecorder.capture('operation', vehicleCode, null, data);
    this.eventsGateway.broadcastVehicleState({ vehicleCode, stream: 'operation', payload: data, ...persistence });
    this.eventsGateway.broadcastOperation(vehicleCode, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/command/ack')
  async handleCommandAck(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;
    if (!(await this.acceptsVehicle(vehicleCode))) return;
    this.historyRecorder.capture('command_ack', { vehicleCode, topic, payload: raw });

    await this.mqttService.handleCommandAck(vehicleCode, data);
  }

  @MessagePattern('v1/vtms/+/event/report')
  async handleEventReport(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;
    if (!(await this.acceptsVehicle(vehicleCode))) return;
    this.historyRecorder.capture('event', { vehicleCode, topic, payload: raw });

    // 只在新事件持久化成功後推播（重送、格式錯誤、寫入失敗都不推），帶中心端事件 ID
    const saved = await this.mqttService.handleEventReport(vehicleCode, data);
    if (saved) this.eventsGateway.broadcastEvent({ vehicleCode, ...data, id: saved.id });
  }

  @MessagePattern('v1/vtms/+/slot/status')
  async handleSlotStatus(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    if (!data) return;

    await this.mqttService.handleSlotStatus(data);
    this.historyRecorder.capture('facility', { vehicleCode: null, topic, payload: raw });
    this.replayRecorder.capture('facility', null, topic, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/status/+')
  async handleGenericStatus(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    if (!data) return;
    this.historyRecorder.capture('facility', { vehicleCode: null, topic, payload: raw });
    this.replayRecorder.capture('facility', null, topic, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/dashboard/capacity/live')
  async handleDashboardCapacity(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    if (!data) return;
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  /** 車門狀態：v1/vtms/{vehicle_code}/door/update */
  @MessagePattern('v1/vtms/+/door/update')
  async handleDoorUpdate(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;
    if (!(await this.acceptsVehicle(vehicleCode))) return;
    this.historyRecorder.capture('facility', { vehicleCode: null, topic, payload: raw });
    this.replayRecorder.capture('facility', null, topic, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  /** 月台門狀態：v1/vtms/{psd_id}/psd/update */
  @MessagePattern('v1/vtms/+/psd/update')
  async handlePsdUpdate(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    if (!data) return;
    this.historyRecorder.capture('facility', { vehicleCode: null, topic, payload: raw });
    this.replayRecorder.capture('facility', null, topic, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  /** 場域設施（月台門 PSD、號誌等）：syncdrive/Gate/141 */
  @MessagePattern('syncdrive/#')
  async handleSyncdriveFacility(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const raw = this.rawCopy(data);
    if (!data) return;
    this.historyRecorder.capture('facility', { vehicleCode: null, topic, payload: raw });
    this.replayRecorder.capture('facility', null, topic, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }
}
