import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    
    this.client = new Redis({
      host,
      port,
    });

    this.client.on('connect', () => this.logger.log('Connected to Redis'));
    this.client.on('error', (err) => this.logger.error('Redis error', err));
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  /** 健康檢查：回傳 Redis PING 結果 */
  async ping(): Promise<string> {
    return this.client.ping();
  }

  async setTelemetry(vehicleCode: string, payload: any) {
    // 規格書 §四 Anti-drift 硬性約束：驗證根層必填欄位
    if (!payload.timestamp || !payload.global_pose || !payload.kinematics) {
      this.logger.warn(
        `[Telemetry] Incomplete payload from ${vehicleCode}: missing timestamp, global_pose, or kinematics. Discarding.`
      );
      return;
    }
    // 驗證 global_pose 座標齊全
    const gp = payload.global_pose;
    if (gp.latitude == null || gp.longitude == null) {
      this.logger.warn(`[Telemetry] Invalid global_pose from ${vehicleCode}: lat/lng is null. Discarding.`);
      return;
    }

    const key = `vtms:telemetry:${vehicleCode}`;
    await this.client.set(key, JSON.stringify(payload));
  }

  async setHealth(vehicleCode: string, payload: any): Promise<{ degraded: boolean, previousHealth: string }> {
    const key = `vtms:health:${vehicleCode}`;

    // 1. 驗證 overall_health 值域
    const validOverallHealth = ['OK', 'WARNING', 'ERROR', 'OFFLINE'];
    if (!validOverallHealth.includes(payload.overall_health)) {
      this.logger.warn(`[Health] Invalid overall_health value: '${payload.overall_health}' from ${vehicleCode}, discarding.`);
      return { degraded: false, previousHealth: 'OK' };
    }

    // 2. 驗證四大子系統是否齊全（規格書 §四 規定必須含 COMPUTING/SENSING/COMMUNICATION/CHASSIS）
    const requiredSubsystems = ['COMPUTING', 'SENSING', 'COMMUNICATION', 'CHASSIS'];
    const receivedSubsystems = Object.keys(payload.subsystems || {});
    const missingSubs = requiredSubsystems.filter(s => !receivedSubsystems.includes(s));
    if (missingSubs.length > 0) {
      this.logger.warn(`[Health] Missing subsystems from ${vehicleCode}: [${missingSubs.join(', ')}], discarding.`);
      return { degraded: false, previousHealth: 'OK' };
    }

    // 3. 交叉驗算：若任一子系統為 ERROR，overall_health 必須為 ERROR（離線狀態除外）
    // sub 可能是 null／字串等非預期型別（車端送錯格式），用可選鏈避免拋例外中斷處理程序。
    const hasErrorSubsystem = Object.values(payload.subsystems).some(
      (sub: any) => sub?.status === 'ERROR'
    );
    if (hasErrorSubsystem && payload.overall_health !== 'ERROR' && payload.overall_health !== 'OFFLINE') {
      this.logger.warn(
        `[Health] Data inconsistency from ${vehicleCode}: subsystem has ERROR but overall_health is '${payload.overall_health}'. Force-correcting to ERROR.`
      );
      payload.overall_health = 'ERROR'; // 強制修正，以子系統狀態為準
    }

    // 4. 與前一筆快取比較，偵測狀態劣化
    const previousStr = await this.client.get(key);
    let degraded = false;
    let previousHealth = 'OK';

    if (previousStr) {
      try {
        const previous = JSON.parse(previousStr);
        previousHealth = previous.overall_health || 'OK';
        if (previousHealth !== 'ERROR' && payload.overall_health === 'ERROR') {
          degraded = true;
        }
      } catch (e) {
        this.logger.error('Failed to parse previous health data', e);
      }
    } else if (payload.overall_health === 'ERROR') {
      // 第一次收到就是 ERROR
      degraded = true;
    }

    await this.client.set(key, JSON.stringify(payload));
    return { degraded, previousHealth };
  }

  async setOperationUpdate(vehicleCode: string, payload: any) {
    const key = `vtms:operation:${vehicleCode}`;
    await this.client.set(key, JSON.stringify(payload));
  }

  /** 讀取車輛最新一筆 telemetry 快取，供 operation/update 處理流程比對場區位置用。 */
  async getTelemetry(vehicleCode: string): Promise<Record<string, unknown> | null> {
    const raw = await this.client.get(`vtms:telemetry:${vehicleCode}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Cold Start Snapshot：一次性讀取所有車輛的三類最新快取狀態
   * 供前端頁面初始載入時呼叫，避免地圖畫面在 WebSocket 建立前空白
   */
  async getAllVehiclesSnapshot(vehicleCodes: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};

    for (const code of vehicleCodes) {
      const [telemetryRaw, healthRaw, operationRaw] = await Promise.all([
        this.client.get(`vtms:telemetry:${code}`),
        this.client.get(`vtms:health:${code}`),
        this.client.get(`vtms:operation:${code}`),
      ]);

      result[code] = {
        telemetry:  telemetryRaw  ? JSON.parse(telemetryRaw)  : null,
        health:     healthRaw     ? JSON.parse(healthRaw)     : null,
        operation:  operationRaw  ? JSON.parse(operationRaw)  : null,
      };
    }

    return result;
  }
}
