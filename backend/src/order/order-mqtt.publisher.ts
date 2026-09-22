import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

export type AssignPublishTrace = {
  topic: string;
  qos: 1;
  retain: false;
  payload: {
    vehicle_code: string;
    timestamp: number;
    order_id: string;
    priority_level: number;
  };
};

export type CancelPublishTrace = {
  topic: string;
  qos: 1;
  retain: false;
  payload: {
    vehicle_code: string;
    timestamp: number;
    order_id: string;
  };
};

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
  publishAssign(vehicleCode: string, orderId: string, priorityLevel: number): AssignPublishTrace {
    const topic = `v1/vtms/${vehicleCode}/operation/assign`;
    const payload = {
      vehicle_code: vehicleCode,
      timestamp: new Date().getTime(), // 13-bit Epoch (ms)
      order_id: orderId,
      priority_level: priorityLevel,
    };

    // retain: false (非持久性觸發訊號)，QoS 1 確認 broker 收件；不保證離線車端收到，車端以 order/active 對帳
    this.mqttClient.publish(topic, JSON.stringify(payload), { retain: false, qos: 1 }, (err) => {
      if (err) {
        this.logger.error(`[Assign Failed] Could not publish to ${topic}`, err);
      }
    });
    return { topic, qos: 1, retain: false, payload };
  }

  /**
   * 中心端主動取消一張已下發訂單的低延遲通知。
   * Topic: v1/vtms/{vehicle_code}/operation/cancel
   * Retain: false——跟 assign 同理，非持久性觸發訊號，不保證離線車端收得到。
   *
   * 這裡只負責「通知」，不是取消的權威來源。真相是 REST：中心端呼叫取消端點的當下
   * 就已經在 order.payload 寫下 cancel_requested_at；車端就算錯過這則 MQTT，
   * 下一次 order/active 或 queryById 對帳也會看到同一個欄位。車端收到後照既有協議
   * 呼叫 updateOrderProgress?status=FAULTED 把單結掉，不必新開任何端點。
   */
  publishCancel(vehicleCode: string, orderId: string): CancelPublishTrace {
    const topic = `v1/vtms/${vehicleCode}/operation/cancel`;
    const payload = {
      vehicle_code: vehicleCode,
      timestamp: new Date().getTime(),
      order_id: orderId,
    };

    this.mqttClient.publish(topic, JSON.stringify(payload), { retain: false, qos: 1 }, (err) => {
      if (err) {
        this.logger.error(`[Cancel Failed] Could not publish to ${topic}`, err);
      }
    });
    return { topic, qos: 1, retain: false, payload };
  }
}
