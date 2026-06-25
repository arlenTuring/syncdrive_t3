import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

/**
 * 專門負責「中心端 → 車端」的 MQTT Publish 服務
 * 與 MqttController (訂閱端) 完全分離，避免角色混淆
 */
@Injectable()
export class OrderMqttPublisher implements OnModuleInit {
  private readonly logger = new Logger(OrderMqttPublisher.name);
  private mqttClient: mqtt.MqttClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('MQTT_URL', 'mqtt://127.0.0.1:1883');
    this.mqttClient = mqtt.connect(url, { clientId: `vtms-order-publisher` });
    this.mqttClient.on('error', (err) => this.logger.error('OrderMqttPublisher MQTT error', err));
  }

  /**
   * 規格書 §四-階段一-2：中心端觸發發車與優先權宣告
   * Topic: v1/vtms/{vehicle_code}/operation/assign
   * Retain: false (非持久性觸發訊號)
   */
  publishAssign(vehicleCode: string, orderId: string, priorityLevel: number) {
    const topic = `v1/vtms/${vehicleCode}/operation/assign`;
    const payload = JSON.stringify({
      vehicle_code: vehicleCode,
      timestamp: new Date().getTime(), // 13-bit Epoch (ms)
      order_id: orderId,
      priority_level: priorityLevel,
    });

    // retain: false (非持久性觸發訊號)，QoS 1 確保發車宣告送達車端
    this.mqttClient.publish(topic, payload, { retain: false, qos: 1 }, (err) => {
      if (err) {
        this.logger.error(`[Assign Failed] Could not publish to ${topic}`, err);
      }
    });
  }
}
