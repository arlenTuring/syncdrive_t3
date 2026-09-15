import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DashboardDemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DashboardDemoSeedService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** 手動觸發事件／班次示範資料（儀表板設定頁） */
  async reseedPanels(): Promise<{ ok: boolean }> {
    await this.runSqlFile('seed-dashboard-panels.sql', undefined, 'event + shift panels (manual)', true);
    await this.runSqlFile('seed-dashboard-capacity-trend.sql', undefined, 'capacity trend (manual)', true);
    await this.runSqlFile('seed-dashboard-maintenance.sql', undefined, 'maintenance distribution (manual)', true);
    await this.runSqlFile('seed-dashboard-shifts.sql', undefined, 'mainline + maintenance shifts (manual)', true);
    await this.refreshDemoTimestamps('manual panels');
    return { ok: true };
  }

  /** 強制重載 PMS 車輛 + 調度訂單（車輛狀態列 SQL） */
  async reseedVehicles(): Promise<{ ok: boolean }> {
    await this.runSqlFile('seed-dashboard-demo.sql', undefined, 'PMS vehicles + orders (manual)', true);
    await this.runSqlFile('seed-vehicle-monitor-demo.sql', undefined, 'vehicle monitor demo (manual)', true);
    return { ok: true };
  }

  /** 儀表板全部示範資料（車輛 + 面板 + 運能 + 整備 + 正線／整備班次卡） */
  async reseedAll(): Promise<{ ok: boolean }> {
    await this.clearDemoSimulationOrders();
    await this.runSqlFile('seed-operation-routes.sql', undefined, 'operation routes (reseed)', true);
    await this.reseedVehicles();
    await this.reseedPanels();
    await this.refreshDemoTimestamps('manual all');
    return { ok: true };
  }

  /**
   * 模擬啟動前清空 PMS 訂單與關聯列，避免殘留 order_id 覆蓋新班次。
   * 訂單 id = YYMMDD-trip_code（日期取自模擬發車時刻，跨日則為隔天日期）。
   */
  async clearDemoSimulationOrders(): Promise<void> {
    try {
      await this.dataSource.query(`
        DELETE FROM order_action_states
        WHERE order_id IN (
          SELECT order_id FROM operation_orders
          WHERE vehicle_code LIKE 'PMS%' OR order_id ~ '-R[0-9]+$'
        )
      `);
      await this.dataSource.query(`
        DELETE FROM order_events
        WHERE order_id IN (
          SELECT order_id FROM operation_orders
          WHERE vehicle_code LIKE 'PMS%' OR order_id ~ '-R[0-9]+$'
        )
      `);
      await this.dataSource.query(`
        DELETE FROM operation_orders
        WHERE vehicle_code LIKE 'PMS%' OR order_id ~ '-R[0-9]+$'
      `);
      await this.dataSource.query(`
        UPDATE vehicle_monitor_demo
        SET badge_label = NULL, segment_label = NULL, demo_speed = NULL
        WHERE vehicle_code LIKE 'PMS%'
      `);
      this.logger.log('Cleared PMS demo orders and monitor badges');
    } catch (err) {
      this.logger.error('Failed to clear demo simulation orders', err);
      throw err;
    }
  }

  async onApplicationBootstrap() {
    await this.runSqlFile('seed-operation-routes.sql', undefined, 'operation routes');

    await this.runSqlFile('seed-dashboard-demo.sql', async () => {
      const [vehicles]: { c: number }[][] = await Promise.all([
        this.dataSource.query(
          `SELECT count(*)::int AS c FROM vehicles WHERE vehicle_code LIKE 'PMS%' AND is_active = true`,
        ),
      ]);
      return Number(vehicles[0]?.c ?? 0) >= 11;
    }, 'PMS vehicles + orders');

    await this.runSqlFile('seed-vehicle-monitor-demo.sql', undefined, 'vehicle monitor demo');

    await this.runSqlFile('seed-dashboard-panels.sql', undefined, 'event + shift panels');
    await this.runSqlFile('seed-dashboard-capacity-trend.sql', undefined, 'capacity trend');
    await this.runSqlFile('seed-dashboard-maintenance.sql', undefined, 'maintenance distribution');
    await this.runSqlFile('seed-dashboard-shifts.sql', undefined, 'mainline + maintenance shifts');
    await this.refreshDemoTimestamps('boot');
  }

  /** 每次啟動／手動 reseed 後刷新示範列時間戳，避免「今日」篩選落空 */
  async refreshDemoTimestamps(label = 'manual'): Promise<void> {
    await this.runSqlFile(
      'seed-dashboard-refresh-timestamps.sql',
      undefined,
      `refresh demo timestamps (${label})`,
      false,
    );
  }

  private resolveSqlPath(filename: string): string | null {
    const candidates = [
      path.join(__dirname, filename),
      path.join(__dirname, '..', 'database', filename),
      path.join(process.cwd(), 'src', 'database', filename),
      path.join(process.cwd(), 'dist', 'database', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private async runSqlFile(
    filename: string,
    skipIf?: () => Promise<boolean>,
    label?: string,
    throwOnError = false,
  ) {
    try {
      if (skipIf && (await skipIf())) {
        return;
      }
      const sqlPath = this.resolveSqlPath(filename);
      if (!sqlPath) {
        const msg = `Seed file not found: ${filename}`;
        this.logger.warn(msg);
        if (throwOnError) throw new Error(msg);
        return;
      }
      await this.dataSource.query(fs.readFileSync(sqlPath, 'utf8'));
    } catch (err) {
      this.logger.error(`Dashboard seed failed (${label ?? filename}).`, err);
      if (throwOnError) throw err;
    }
  }
}
