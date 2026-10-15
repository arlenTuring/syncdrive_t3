import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { MqttService } from './mqtt.service';

type TelemetryQueueItem = {
  vehicleCode: string;
  payload: Record<string, unknown>;
  receivedAt: number;
};

/**
 * 非阻塞歷史 telemetry 寫庫佇列；最新狀態快照由 MQTT handler 另行同步保存。
 */
@Injectable()
export class TelemetryWriteQueue implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryWriteQueue.name);
  private readonly queue: TelemetryQueueItem[] = [];
  private draining = false;
  private readonly batchSize = 80;
  private readonly maxQueued = 5000;
  private readonly pausedVehicles = new Set<string>();

  constructor(private readonly mqttService: MqttService) {}

  enqueue(vehicleCode: string, payload: Record<string, unknown>) {
    if (this.pausedVehicles.has(vehicleCode)) return;
    if (this.queue.length >= this.maxQueued) {
      const dropped = this.queue.splice(0, this.batchSize).length;
      this.logger.warn(`Telemetry history queue full; dropped ${dropped} oldest records (latest snapshot is unaffected)`);
    }
    this.queue.push({ vehicleCode, payload, receivedAt: Date.now() });
    void this.drain();
  }

  async pauseAndDiscard(vehicleCodes: string[]): Promise<number> {
    vehicleCodes.forEach((code) => this.pausedVehicles.add(code));
    while (this.draining) await new Promise((resolve) => setTimeout(resolve, 10));
    const before = this.queue.length;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.pausedVehicles.has(this.queue[index].vehicleCode)) this.queue.splice(index, 1);
    }
    return before - this.queue.length;
  }

  resume(vehicleCodes: string[]): void {
    vehicleCodes.forEach((code) => this.pausedVehicles.delete(code));
  }

  /** 清理前的寫入屏障：先把清理快照時間以前已接收的佇列資料落庫。 */
  async flushForCleanup(): Promise<void> {
    while (this.draining) await new Promise((resolve) => setTimeout(resolve, 10));
    await this.drain(true);
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
