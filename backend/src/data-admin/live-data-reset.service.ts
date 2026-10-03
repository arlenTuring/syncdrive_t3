import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DemoSimulationService } from '../demo/demo-simulation.service';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { EventsGateway } from '../events/events.gateway';
import { MqttService } from '../mqtt/mqtt.service';
import { TelemetryWriteQueue } from '../mqtt/telemetry-write.queue';
import { RedisService } from '../redis/redis.service';

type StepStatus = 'completed' | 'failed' | 'skipped' | 'not_run';
type ResetStep = { id: string; status: StepStatus; detail: string };
const STEP_IDS = ['pause_sources', 'drain_queue', 'database', 'redis', 'memory_caches', 'mqtt_retained', 'notify_clients', 'verify'] as const;

@Injectable()
export class LiveDataResetService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly mqtt: MqttService,
    private readonly queue: TelemetryWriteQueue,
    private readonly demo: DemoSimulationService,
    private readonly dispatch: DispatchEngineService,
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
    const requestId = randomUUID();
    const startedAt = Date.now();
    const steps: ResetStep[] = [];
    let databaseCommitted = false;
    let databaseRolledBack = false;
    let failed = false;

    const run = async (id: typeof STEP_IDS[number], action: () => Promise<string>) => {
      if (failed) {
        steps.push({ id, status: 'not_run', detail: '前一步失敗，未執行' });
        return;
      }
      try {
        steps.push({ id, status: 'completed', detail: await action() });
      } catch (error) {
        failed = true;
        steps.push({ id, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
      }
    };

    await run('pause_sources', async () => {
      await this.dispatch.setEnabled(false);
      this.mqtt.pauseLiveInputs(scope);
      await this.demo.pause();
      return '調度已持久停用；已暫停本機投影與所選車輛 MQTT 接收';
    });
    await run('drain_queue', async () => `已丟棄 ${await this.queue.pauseAndDiscard(scope)} 筆所選範圍待寫入資料`);
    await run('database', async () => {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const rows = await runner.query(this.resetSql('$1'), [scope]);
        await runner.commitTransaction();
        databaseCommitted = true;
        return Object.entries(rows[0] ?? {}).map(([name, count]) => `${name} ${count} 筆`).join('；');
      } catch (error) {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
          databaseRolledBack = true;
        }
        throw new Error(`資料庫交易失敗，本次資料變更已回滾：${error instanceof Error ? error.message : String(error)}`);
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
    if (failed) steps.push({ id: 'mqtt_retained', status: 'not_run', detail: '前一步失敗，未執行' });
    else steps.push({ id: 'mqtt_retained', status: 'skipped', detail: 'Broker 未提供 retained 清單，因此未宣稱或執行 retained 清除' });
    await run('notify_clients', async () => {
      this.invalidation.emit([
        'table:operation_orders', 'table:order_events', 'table:order_action_states',
        'table:telemetry_logs', 'table:vehicle_monitor_demo', 'domain:vehicle_monitor',
        'domain:vehicle_distribution', 'domain:mainline_shifts', 'domain:maintenance_shifts',
      ], 'complete_test_reset');
      this.events.broadcastLiveStateReset({ vehicleCodes: scope, at: Date.now() });
      return '已通知所有前端清除相同範圍快取並重查';
    });
    await run('verify', async () => {
      const rows = await this.dataSource.query(`
        SELECT
          (SELECT count(*)::int FROM operation_orders WHERE vehicle_code = ANY($1::text[])) AS operation_orders,
          (SELECT count(*)::int FROM telemetry_logs WHERE vehicle_code = ANY($1::text[])) AS telemetry_logs
      `, [scope]);
      const counts = rows[0] ?? {};
      if (Number(counts.operation_orders) || Number(counts.telemetry_logs)) {
        throw new Error(`仍有殘留：operation_orders ${counts.operation_orders}；telemetry_logs ${counts.telemetry_logs}`);
      }
      return '所選範圍訂單與遙測均為 0；調度維持停用';
    });

    const status = failed ? (databaseCommitted ? 'partial' : 'failed') : 'completed';
    return {
      requestId, status, operation: '完整重置測試資料', startedAt, finishedAt: Date.now(),
      vehicleCodes: scope, steps,
      database: { committed: databaseCommitted, rolledBack: databaseRolledBack },
      dispatchPaused: true, liveInputPaused: true,
    };
  }

  resume(vehicleCodes: string[]) {
    const scope = this.validateScope(vehicleCodes);
    this.mqtt.resumeLiveInputs(scope);
    this.queue.resume(scope);
    return {
      requestId: randomUUID(), status: 'completed', operation: '恢復即時資料接收',
      vehicleCodes: scope, resumed: true,
      note: '已恢復 MQTT 接收；調度部署仍保持停用，需由調度開關明確啟用',
    };
  }

  private validateScope(vehicleCodes: string[]): string[] {
    const scope = [...new Set((vehicleCodes ?? []).map((code) => String(code).trim()).filter(Boolean))];
    if (!scope.length) throw new BadRequestException('請至少選擇一個車輛範圍');
    if (scope.some((code) => !/^[a-zA-Z0-9_-]+$/.test(code))) throw new BadRequestException('車輛代號格式無效');
    return scope;
  }

  private resetSql(scopeExpression: string): string {
    return `WITH target_orders AS MATERIALIZED (
      SELECT order_id FROM operation_orders WHERE vehicle_code = ANY(${scopeExpression}::text[])
    ), deleted_action_states AS (
      DELETE FROM order_action_states s USING target_orders t WHERE s.order_id = t.order_id RETURNING 1
    ), deleted_events AS (
      DELETE FROM order_events e USING target_orders t WHERE e.order_id = t.order_id RETURNING 1
    ), deleted_orders AS (
      DELETE FROM operation_orders o USING target_orders t WHERE o.order_id = t.order_id RETURNING 1
    ), deleted_telemetry AS (
      DELETE FROM telemetry_logs WHERE vehicle_code = ANY(${scopeExpression}::text[]) RETURNING 1
    ), reset_monitor AS (
      UPDATE vehicle_monitor_demo SET segment_label = NULL, location_kind = NULL,
        location_object_id = NULL, position_x = NULL, position_y = NULL,
        position_updated_at = NULL, demo_speed = NULL, demo_load = NULL, badge_label = NULL,
        overall_health = 'UNKNOWN', alert_message = '未收到資料', card_border_color = '#52525b',
        status_computing = 'UNKNOWN', status_sensing = 'UNKNOWN',
        status_communication = 'UNKNOWN', status_chassis = 'UNKNOWN'
      WHERE vehicle_code = ANY(${scopeExpression}::text[]) RETURNING 1
    ) SELECT
      (SELECT count(*)::int FROM deleted_action_states) AS order_action_states,
      (SELECT count(*)::int FROM deleted_events) AS order_events,
      (SELECT count(*)::int FROM deleted_orders) AS operation_orders,
      (SELECT count(*)::int FROM deleted_telemetry) AS telemetry_logs,
      (SELECT count(*)::int FROM reset_monitor) AS vehicle_monitor_demo`;
  }

  private describe(vehicleCodes: string[], redisKeys: string[]) {
    const values = `ARRAY[${vehicleCodes.map((code) => `'${code.replaceAll("'", "''")}'`).join(', ')}]`;
    return {
      vehicleCodes, sql: `${this.resetSql(values)};`, redisKeys,
      mqttTopics: vehicleCodes.flatMap((code) => [
        `v1/vtms/${code}/telemetry/update`, `v1/vtms/${code}/operation/update`, `v1/vtms/${code}/health/heartbeat`,
      ]),
      actions: [
        '持久停用調度及所選車輛接收', '排空所選範圍待寫入佇列',
        '同一交易清除訂單、明細、遙測與快照', '刪除列出的 Redis key',
        '清除後端快取', '通知前端', '驗證無殘留',
      ],
      preserved: ['班表定義', '時間模板', '路線與地圖', '車輛主檔', '帳號與憑證', '儀表板設定'],
      warnings: ['外部車端若仍發送資料，需在來源端停止', '未確認 Broker retained 訊息，故不宣稱已清除'],
    };
  }
}
