import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';
import { MqttService } from './mqtt.service';
import { TelemetryWriteQueue } from './telemetry-write.queue';

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly eventsGateway: EventsGateway,
    private readonly mqttService: MqttService,
    private readonly telemetryWriteQueue: TelemetryWriteQueue,
  ) {}

  @MessagePattern('v1/vtms/+/telemetry/update')
  async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const parts = topic.split('/');
    const vehicleCode = parts[2];
    if (!vehicleCode || !data) return;

    await this.redisService.setTelemetry(vehicleCode, data);
    if (this.mqttService.shouldPersistTelemetry(vehicleCode)) {
      this.telemetryWriteQueue.enqueue(vehicleCode, data);
    }

    this.eventsGateway.broadcastTelemetry(vehicleCode, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/health/heartbeat')
  async handleHealth(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const parts = topic.split('/');
    const vehicleCode = parts[2];
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
    const parts = topic.split('/');
    const vehicleCode = parts[2];
    if (!vehicleCode || !data) return;

    await this.redisService.setOperationUpdate(vehicleCode, data);
    await this.mqttService.syncOperationOrderFromLive(vehicleCode, data);

    this.eventsGateway.broadcastOperation(vehicleCode, data);
    this.eventsGateway.broadcastMqttMessage(topic, data);
  }

  @MessagePattern('v1/vtms/+/command/ack')
  async handleCommandAck(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const parts = topic.split('/');
    const vehicleCode = parts[2];
    if (!vehicleCode || !data) return;

    await this.mqttService.handleCommandAck(vehicleCode, data);
  }

  @MessagePattern('v1/vtms/+/event/report')
  async handleEventReport(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    const parts = topic.split('/');
    const vehicleCode = parts[2];
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
