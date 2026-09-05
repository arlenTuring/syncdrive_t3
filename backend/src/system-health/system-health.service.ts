import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';
import * as si from 'systeminformation';
import { DatasourceService } from '../datasource/datasource.service';
import { RedisService } from '../redis/redis.service';

export type HealthHistoryRange = '1h' | '6h' | '24h';

export type HostMetricsSnapshot = {
  at: string;
  cpuUsagePercent: number | null;
  cpuTempC: number | null;
  memoryUsagePercent: number | null;
  diskFreePercent: number | null;
  diskReadMBps: number | null;
  diskWriteMBps: number | null;
  networkLatencyMs: number | null;
};

export type ServiceProbeStatus = 'ok' | 'error' | 'unknown';

export type ServiceProbe = {
  id: 'database' | 'mqtt' | 'middleware' | 'telemetry';
  label: string;
  detail: string;
  status: ServiceProbeStatus;
  latencyMs: number | null;
  message: string;
};

export type SystemHealthSnapshot = {
  host: HostMetricsSnapshot;
  services: ServiceProbe[];
  thresholds: {
    memoryUsageWarnPercent: number;
    cpuUsageWarnPercent: number;
    diskFreeWarnPercent: number;
  };
};

export type HistoryPoint = {
  at: string;
  cpuUsagePercent: number | null;
  cpuTempC: number | null;
  memoryUsagePercent: number | null;
  diskFreePercent: number | null;
};

const SAMPLE_INTERVAL_MS = 30_000;
const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SystemHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemHealthService.name);
  private history: HistoryPoint[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private collecting = false;

  constructor(
    private readonly config: ConfigService,
    private readonly datasource: DatasourceService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    void this.sampleAndStore().catch((err) => {
      this.logger.warn(
        `Initial health sample failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.timer = setInterval(() => {
      void this.sampleAndStore().catch((err) => {
        this.logger.warn(
          `Health sample failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, SAMPLE_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async getSnapshot(): Promise<SystemHealthSnapshot> {
    const [host, services] = await Promise.all([
      this.collectHostMetrics(),
      this.probeServices(),
    ]);
    return {
      host,
      services,
      thresholds: {
        memoryUsageWarnPercent: 80,
        cpuUsageWarnPercent: 90,
        diskFreeWarnPercent: 15,
      },
    };
  }

  getHistory(range: HealthHistoryRange): HistoryPoint[] {
    const now = Date.now();
    const windowMs =
      range === '1h'
        ? 60 * 60 * 1000
        : range === '6h'
          ? 6 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
    const from = now - windowMs;
    return this.history.filter((p) => Date.parse(p.at) >= from);
  }

  private async sampleAndStore() {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const host = await this.collectHostMetrics();
      this.history.push({
        at: host.at,
        cpuUsagePercent: host.cpuUsagePercent,
        cpuTempC: host.cpuTempC,
        memoryUsagePercent: host.memoryUsagePercent,
        diskFreePercent: host.diskFreePercent,
      });
      const cutoff = Date.now() - MAX_HISTORY_MS;
      this.history = this.history.filter((p) => Date.parse(p.at) >= cutoff);
    } finally {
      this.collecting = false;
    }
  }

  /**
   * 以 systeminformation 跨平台取得主機資源（Linux / macOS / Windows；
   * 容器內部分指標可能為 null，前端以「—」降級顯示）。
   */
  private async collectHostMetrics(): Promise<HostMetricsSnapshot> {
    const at = new Date().toISOString();
    const [load, mem, fsSize, temp, fsStats, netLatency] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.fsSize().catch(() => [] as si.Systeminformation.FsSizeData[]),
      si.cpuTemperature().catch(() => null),
      si.fsStats().catch(() => null),
      this.measureNetworkLatencyMs(),
    ]);

    const cpuUsagePercent =
      load && Number.isFinite(load.currentLoad)
        ? round1(load.currentLoad)
        : null;

    const cpuTempC =
      temp && Number.isFinite(temp.main) && temp.main > 0
        ? round1(temp.main)
        : null;

    let memoryUsagePercent: number | null = null;
    if (mem && mem.total > 0) {
      memoryUsagePercent = round1(((mem.total - mem.available) / mem.total) * 100);
    }

    const rootFs =
      fsSize.find((f) => f.mount === '/') ??
      fsSize.find((f) => f.mount === 'C:\\') ??
      fsSize[0];
    const diskFreePercent =
      rootFs && Number.isFinite(rootFs.use)
        ? round1(100 - rootFs.use)
        : null;

    const diskReadMBps =
      fsStats && typeof fsStats.rx_sec === 'number' && Number.isFinite(fsStats.rx_sec)
        ? round1(fsStats.rx_sec / (1024 * 1024))
        : null;
    const diskWriteMBps =
      fsStats && typeof fsStats.wx_sec === 'number' && Number.isFinite(fsStats.wx_sec)
        ? round1(fsStats.wx_sec / (1024 * 1024))
        : null;

    return {
      at,
      cpuUsagePercent,
      cpuTempC,
      memoryUsagePercent,
      diskFreePercent,
      diskReadMBps,
      diskWriteMBps,
      networkLatencyMs: netLatency,
    };
  }

  /** 以 TCP 連線往返時間作為「本機網路／中介延遲」通用量測 */
  private async measureNetworkLatencyMs(): Promise<number | null> {
    const host = this.config.get<string>('REDIS_HOST', '127.0.0.1');
    const port = Number(this.config.get<string>('REDIS_PORT', '6379'));
    try {
      const ms = await tcpConnectLatencyMs(host, port, 2000);
      return round1(ms);
    } catch {
      try {
        const dbHost = this.config.get<string>('DB_HOST', '127.0.0.1');
        const dbPort = Number(this.config.get<string>('DB_PORT', '5432'));
        return round1(await tcpConnectLatencyMs(dbHost, dbPort, 2000));
      } catch {
        return null;
      }
    }
  }

  private async probeServices(): Promise<ServiceProbe[]> {
    const [database, mqtt, telemetry] = await Promise.all([
      this.probeDatabase(),
      this.probeMqtt(),
      this.probeRedisTelemetry(),
    ]);
    const middleware: ServiceProbe = {
      id: 'middleware',
      label: '中介軟體',
      detail: 'REST API Services',
      status: 'ok',
      latencyMs: 0,
      message: '正常連線',
    };
    return [database, mqtt, middleware, telemetry];
  }

  private async probeDatabase(): Promise<ServiceProbe> {
    const detail = `Port ${this.config.get<string>('DB_PORT', '5432')}`;
    try {
      const started = Date.now();
      const result = await this.datasource.ping();
      const latencyMs = round1(
        typeof result?.latencyMs === 'number' ? result.latencyMs : Date.now() - started,
      );
      const ok = result?.ok !== false;
      return {
        id: 'database',
        label: '資料庫服務',
        detail,
        status: ok ? 'ok' : 'error',
        latencyMs,
        message: ok ? '正常連線' : '連線失敗',
      };
    } catch (err) {
      return {
        id: 'database',
        label: '資料庫服務',
        detail,
        status: 'error',
        latencyMs: null,
        message: err instanceof Error ? err.message : '連線失敗',
      };
    }
  }

  private async probeMqtt(): Promise<ServiceProbe> {
    const mqttUrl = this.config.get<string>('MQTT_URL', 'mqtt://127.0.0.1:1883');
    const publicPort = this.config.get<string>('MQTT_PUBLIC_PORT', '8883');
    let host = '127.0.0.1';
    let port = 1883;
    let detail = `Port ${publicPort} (mTLS)`;
    try {
      const u = new URL(mqttUrl.replace(/^mqtts?:/, 'http:'));
      host = u.hostname || host;
      port = u.port ? Number(u.port) : mqttUrl.startsWith('mqtts') ? 8883 : 1883;
      detail = port === 8883 ? `Port ${port} (mTLS)` : `Port ${port}`;
    } catch {
      // keep defaults
    }
    try {
      const latencyMs = round1(await tcpConnectLatencyMs(host, port, 2500));
      return {
        id: 'mqtt',
        label: 'MQTT Broker',
        detail,
        status: 'ok',
        latencyMs,
        message: '正常連線',
      };
    } catch (err) {
      return {
        id: 'mqtt',
        label: 'MQTT Broker',
        detail,
        status: 'error',
        latencyMs: null,
        message: err instanceof Error ? err.message : '連線失敗',
      };
    }
  }

  private async probeRedisTelemetry(): Promise<ServiceProbe> {
    const detail = 'Kafka/Redis Cluster';
    try {
      const started = Date.now();
      const pong = await this.redis.ping();
      const latencyMs = round1(Date.now() - started);
      const ok = typeof pong === 'string' && pong.toUpperCase() === 'PONG';
      return {
        id: 'telemetry',
        label: '遙測數據管線',
        detail,
        status: ok ? 'ok' : 'error',
        latencyMs,
        message: ok ? '正常連線' : '連線失敗',
      };
    } catch (err) {
      return {
        id: 'telemetry',
        label: '遙測數據管線',
        detail,
        status: 'error',
        latencyMs: null,
        message: err instanceof Error ? err.message : '連線失敗',
      };
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function tcpConnectLatencyMs(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      socket.end();
      socket.destroy();
      resolve(ms);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      fail(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
