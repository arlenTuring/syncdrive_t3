import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DemoSimulationService } from '../demo/demo-simulation.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { EventsGateway } from '../events/events.gateway';
import { MqttService } from '../mqtt/mqtt.service';
import { TelemetryWriteQueue } from '../mqtt/telemetry-write.queue';
import { RedisService } from '../redis/redis.service';

type ResetStep = { id: string; status: 'completed' | 'failed' | 'skipped'; detail: string };

@Injectable()
export class LiveDataResetService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly mqtt: MqttService,
    private readonly queue: TelemetryWriteQueue,
    private readonly demo: DemoSimulationService,
    private readonly invalidation: DatasourceInvalidationService,
    private readonly events: EventsGateway,
  ) {}

  async preview() {
    const rows = await this.dataSource.query(`
      SELECT DISTINCT vehicle_code FROM (
        SELECT vehicle_code FROM vehicle_monitor_demo
        UNION SELECT vehicle_code FROM operation_orders
        UNION SELECT vehicle_code FROM telemetry_logs
      ) known WHERE vehicle_code IS NOT NULL ORDER BY vehicle_code
    `);
    const redisKeys = await this.redis.listLiveStateKeys();
    const vehicleCodes = [...new Set([
      ...rows.map((row) => String(row.vehicle_code)),
      ...redisKeys.map((key) => key.split(':').at(-1) ?? '').filter(Boolean),
    ])].sort();
    return this.describe(vehicleCodes, redisKeys);
  }

  async execute(vehicleCodes: string[]) {
    const scope = this.validateScope(vehicleCodes);
    const steps: ResetStep[] = [];
    const run = async (id: string, action: () => Promise<string>) => {
      try {
        steps.push({ id, status: 'completed', detail: await action() });
      } catch (error) {
        steps.push({ id, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
        throw Object.assign(new Error(`重置步驟失敗：${id}`), { steps });
      }
    };

    await run('pause_sources', async () => {
      this.mqtt.pauseLiveInputs(scope);
      await this.demo.pause();
      return '已暫停本機投影與所選車輛的 MQTT 接收；外部模擬器仍需在 4300 停止';
    });
    await run('drain_queue', async () => `已丟棄 ${await this.queue.pauseAndDiscard(scope)} 筆所選範圍待寫入資料`);
    await run('database_snapshots', async () => {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const telemetry = await runner.query('DELETE FROM telemetry_logs WHERE vehicle_code = ANY($1::text[])', [scope], true);
        const monitor = await runner.query(`UPDATE vehicle_monitor_demo SET
          segment_label = NULL, location_kind = NULL, location_object_id = NULL,
          position_x = NULL, position_y = NULL, position_updated_at = NULL,
          demo_speed = NULL, demo_load = NULL, badge_label = NULL
          WHERE vehicle_code = ANY($1::text[])`, [scope], true);
        await runner.commitTransaction();
        return `telemetry_logs ${telemetry.affected ?? 0} 筆；vehicle_monitor_demo ${monitor.affected ?? 0} 筆`;
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    });
    await run('redis', async () => {
      const result = await this.redis.deleteLiveState(scope);
      return `僅刪除 ${result.deleted}/${result.keys.length} 個 vtms 範圍 key（未使用 FLUSHALL）`;
    });
    await run('memory_caches', async () => {
      this.mqtt.clearLiveCaches(scope);
      return '已清除訂單同步、位置與顯示去重快取';
    });
    steps.push({
      id: 'mqtt_retained',
      status: 'skipped',
      detail: 'Broker 未提供 retained 清單，未經確認不發布空 retained 訊息；確切 Topic 已列於預覽',
    });
    await run('notify_clients', async () => {
      this.invalidation.emit([
        'table:telemetry_logs', 'table:vehicle_monitor_demo', 'domain:vehicle_monitor',
        'domain:vehicle_distribution', 'domain:mainline_shifts', 'domain:maintenance_shifts',
      ], 'live_data_reset');
      this.events.broadcastLiveStateReset({ vehicleCodes: scope, at: Date.now() });
      return '已透過即時通道通知所有前端清除快取並重查';
    });
    return { vehicleCodes: scope, paused: true, steps };
  }

  resume(vehicleCodes: string[]) {
    const scope = this.validateScope(vehicleCodes);
    this.mqtt.resumeLiveInputs(scope);
    this.queue.resume(scope);
    return { vehicleCodes: scope, resumed: true, note: '已恢復接收；外部模擬器需由 4300 另行啟動' };
  }

  private validateScope(vehicleCodes: string[]): string[] {
    const scope = [...new Set((vehicleCodes ?? []).map((code) => String(code).trim()).filter(Boolean))];
    if (!scope.length) throw new BadRequestException('請至少選擇一個車輛範圍');
    if (scope.some((code) => !/^[a-zA-Z0-9_-]+$/.test(code))) throw new BadRequestException('車輛代號格式無效');
    return scope;
  }

  private describe(vehicleCodes: string[], redisKeys: string[]) {
    const quoted = vehicleCodes.map((code) => `'${code.replaceAll("'", "''")}'`).join(', ');
    return {
      vehicleCodes,
      sql: `DELETE FROM telemetry_logs WHERE vehicle_code IN (${quoted});\nUPDATE vehicle_monitor_demo SET segment_label = NULL, location_kind = NULL, location_object_id = NULL, position_x = NULL, position_y = NULL, position_updated_at = NULL, demo_speed = NULL, demo_load = NULL, badge_label = NULL WHERE vehicle_code IN (${quoted});`,
      redisKeys,
      mqttTopics: vehicleCodes.flatMap((code) => [
        `v1/vtms/${code}/telemetry/update`,
        `v1/vtms/${code}/operation/update`,
        `v1/vtms/${code}/health/heartbeat`,
      ]),
      actions: [
        '暫停本機班表投影與所選車輛接收', '排空所選範圍待寫入佇列',
        '清除資料庫即時快照', '刪除列出的 Redis key', '清除後端記憶體快取', '通知所有前端',
      ],
      preserved: ['訂單與班表定義', '時間模板', '路線與地圖', '車輛主檔', '帳號與憑證', '儀表板設定'],
      warnings: ['外部模擬器／車端若仍發送資料，需先在來源端停止', '未確認 retained 存在時不會清除 Broker 訊息'],
    };
  }
}
