import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { MqttService } from './mqtt.service';

type TelemetryQueueItem = {
  vehicleCode: string;
  payload: Record<string, unknown>;
};

/**
 * 非阻塞 telemetry 寫庫佇列：MQTT 進來一筆就 enqueue 一筆，背景批次 INSERT。
 * 不降低 MQTT 頻率、不丟資料，只避免 handler 被 await DB 卡住。
 */
@Injectable()
export class TelemetryWriteQueue implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryWriteQueue.name);
  private readonly queue: TelemetryQueueItem[] = [];
  private draining = false;
  private readonly batchSize = 80;

  constructor(private readonly mqttService: MqttService) {}

  enqueue(vehicleCode: string, payload: Record<string, unknown>) {
    this.queue.push({ vehicleCode, payload });
    void this.drain();
  }

  async onModuleDestroy() {
    await this.drain(true);
  }

  private async drain(flushAll = false) {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const take = flushAll ? this.queue.length : Math.min(this.queue.length, this.batchSize);
        const batch = this.queue.splice(0, take);
        await this.mqttService.saveTelemetryBatch(batch);
      }
    } catch (err) {
      this.logger.error('Telemetry batch drain failed', err);
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        void this.drain(flushAll);
      }
    }
  }
}
