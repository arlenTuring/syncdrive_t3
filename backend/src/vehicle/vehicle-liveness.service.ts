import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { RedisService } from '../redis/redis.service';
import { VTMS_VEHICLE_CODES } from '../common/vehicle-codes';
import { withDerivedOffline } from '../common/vehicle-liveness';

/**
 * 失聯巡檢。
 *
 * <h3>為什麼需要主動掃</h3>
 * 失聯的定義是「一段時間沒收到東西」，而「沒收到」本身不會觸發任何事件——沒有訊息
 * 進來，就沒有程式被叫起來。圖台如果只在收到心跳時才更新，一台斷線的車會永遠停在
 * 它最後一次回報的狀態，看起來一切正常。
 *
 * 所以要有人固定去問「現在幾點了、上一次收到是什麼時候」。
 *
 * <h3>只在狀態翻轉時推播</h3>
 * 每一拍都推等於自己製造 11 Hz 的流量，而且蓋掉車端真正的健康狀態。只有
 * 在線↔失聯<strong>換邊</strong>時才送一次。
 */
const SWEEP_INTERVAL_MS = 1_000;

@Injectable()
export class VehicleLivenessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VehicleLivenessService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 上一輪判定的結果，用來認出翻轉；啟動時未知，第一輪一律視為翻轉 */
  private readonly lastOffline = new Map<string, boolean>();

  constructor(
    private readonly redis: RedisService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => {
        this.logger.warn(
          `失聯巡檢失敗：${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(now = Date.now()): Promise<{ offline: string[]; changed: string[] }> {
    const offline: string[] = [];
    const changed: string[] = [];

    for (const code of VTMS_VEHICLE_CODES) {
      const mark = await this.redis.getLivenessMark(code);
      const isOffline = mark === null || now - mark.receivedAt > this.redis.offlineAfterMs;
      if (isOffline) offline.push(code);

      const previous = this.lastOffline.get(code);
      if (previous === isOffline) continue;
      this.lastOffline.set(code, isOffline);
      // 啟動後第一輪：還沒收到任何心跳的車本來就該是失聯，不值得記一筆
      if (previous === undefined && isOffline) continue;
      changed.push(code);

      const health = await this.redis.getHealth(code);
      this.events.broadcastHealth(code, withDerivedOffline(health, isOffline, mark));
      this.logger.warn(
        isOffline
          ? `${code} 失聯：最後一次收到心跳是 ${
              mark ? `${Math.round((now - mark.receivedAt) / 1000)} 秒前` : '從未收到'
            }`
          : `${code} 恢復連線`,
      );
    }

    return { offline, changed };
  }
}
