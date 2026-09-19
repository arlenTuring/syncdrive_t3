import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';
import { MqttService } from './mqtt.service';
import { TelemetryWriteQueue } from './telemetry-write.queue';
import { normalizeVehicleCode } from '../common/vehicle-codes';

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly eventsGateway: EventsGateway,
    private readonly mqttService: MqttService,
    private readonly telemetryWriteQueue: TelemetryWriteQueue,
  ) {}

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

  @MessagePattern('v1/vtms/+/telemetry/update')
  async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;

    await this.redisService.setTelemetry(vehicleCode, data);
    await this.mqttService.updateVehicleLivePosition(vehicleCode, data);
    if (this.mqttService.shouldPersistTelemetry(vehicleCode)) {
      this.telemetryWriteQueue.enqueue(vehicleCode, data);
    }

    this.eventsGateway.broadcastTelemetry(vehicleCode, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/health/heartbeat')
  async handleHealth(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;

    const { degraded, previousHealth } = await this.redisService.setHealth(vehicleCode, data);

    if (degraded) {
      this.logger.warn(`[Health Degradation] ${vehicleCode} health dropped from ${previousHealth} to ERROR.`);

      // 持久化以供稽核（先前僅 broadcast，DB 無紀錄）
      await this.mqttService.recordHealthDegradedEvent(vehicleCode, data);

      this.eventsGateway.broadcastEvent({
        vehicleCode,
        event_code: 'SYSTEM_HEALTH_DEGRADED',
        severity: 'CRITICAL',
        timestamp: data.timestamp,
        source: 'HEALTH_MONITOR',
      });
    }

    this.eventsGateway.broadcastHealth(vehicleCode, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/operation/update')
  async handleOperationUpdate(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;

    const enriched = await this.mqttService.enrichWithFacilityLocation(vehicleCode, data);

    await this.redisService.setOperationUpdate(vehicleCode, enriched);
    await this.mqttService.syncOperationOrderFromLive(vehicleCode, enriched);

    this.eventsGateway.broadcastOperation(vehicleCode, enriched);
    this.eventsGateway.broadcastMqttMessage(topic, enriched);
  }

  @MessagePattern('v1/vtms/+/command/ack')
  async handleCommandAck(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;

    await this.mqttService.handleCommandAck(vehicleCode, data);
  }

  @MessagePattern('v1/vtms/+/event/report')
  async handleEventReport(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const vehicleCode = this.vehicleCodeFromTopic(topic, data);
    if (!vehicleCode || !data) return;

    await this.mqttService.handleEventReport(vehicleCode, data);
    this.eventsGateway.broadcastEvent({ vehicleCode, ...data });
  }

  @MessagePattern('v1/vtms/+/slot/status')
  async handleSlotStatus(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    if (!data) return;

    await this.mqttService.handleSlotStatus(data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/status/+')
  async handleGenericStatus(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    if (!data) return;
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
    if (!data) return;
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  /** 月台門狀態：v1/vtms/{psd_id}/psd/update */
  @MessagePattern('v1/vtms/+/psd/update')
  async handlePsdUpdate(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    if (!data) return;
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  /** 場域設施（月台門 PSD、號誌等）：syncdrive/Gate/141 */
  @MessagePattern('syncdrive/#')
  async handleSyncdriveFacility(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    if (!data) return;
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }
}
