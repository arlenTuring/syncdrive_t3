import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { tripDelayMinutes } from '../order/trip-delay';
import { SystemFoundationSettingsService } from '../system-health/system-foundation-settings.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';

const SCAN_INTERVAL_MS = 15_000;

type DelayedRow = {
  id: string;
  trip_code: string;
  vehicle_code: string;
  planned_end: string;
  delay_minutes: number;
};

/** 同一張訂單只記一次事件 */
export function tripDelayDedupKey(orderId: string): string {
  return `trip-delay|${orderId}`;
}

/** 班車延誤事件的內容；來源是班表部署管理（中心端判定），不是車端回報 */
export function tripDelayEvent(row: DelayedRow, receivedAt: number) {
  const lateMinutes = row.delay_minutes;
  const displayMessage = `班次 ${row.trip_code} 延誤：超過計畫結束 ${lateMinutes} 分鐘仍未完成`;
  return {
    event_id: `TRIP-DELAY-${row.id}`.slice(0, 120),
    dedup_key: tripDelayDedupKey(row.id),
    vehicle_code: row.vehicle_code,
    source_id: row.trip_code,
    params: JSON.stringify({ order_id: row.id, trip_code: row.trip_code, planned_end: Number(row.planned_end), late_minutes: lateMinutes }),
    display_message: displayMessage,
    created_at: String(receivedAt),
    received_at: String(receivedAt),
  };
}

/**
 * 班車延誤監督（班表部署管理的營運回報）：還沒完成的訂單過了界線就把判定寫進
 * operation_orders.delay_minutes（規則見 order/trip-delay.ts），寫入後通知畫面重查；
 * 載客班次第一次延誤時再記一筆事件到事件管理。車端不知道計畫時刻，這類事件只能由中心端產生。
 */
@Injectable()
export class TripDelayMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripDelayMonitorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: OperatingClockService,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
    @Optional() private readonly systemSettings?: SystemFoundationSettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const operatingNow = this.clock.now();
      const day = this.clock.operatingDay();
      const toleranceSeconds = (await this.systemSettings?.get())?.globalParams.tripDelayToleranceSeconds;
      const open: Array<{ id: string; planned_end: string; delay_minutes: number | null }> = await this.dataSource.query(
        `SELECT o.order_id AS id, o.planned_end::text AS planned_end, o.delay_minutes
         FROM operation_orders o
         WHERE o.status IN ('PENDING', 'PROCESSING')
           AND o.payload->>'operating_day' = $1
           AND o.planned_end > 0 AND o.planned_end < $2`,
        [day, operatingNow],
      );
      let changed = 0;
      for (const row of open) {
        const minutes = tripDelayMinutes(row.planned_end, operatingNow, toleranceSeconds);
        if (minutes <= (row.delay_minutes ?? 0)) continue;
        const result: unknown[] = await this.dataSource.query(
          `UPDATE operation_orders SET delay_minutes = $1
           WHERE order_id = $2 AND status IN ('PENDING', 'PROCESSING') RETURNING order_id`,
          [minutes, row.id],
        );
        changed += result.length;
      }
      if (changed > 0) this.invalidation?.emitOrderLifecycle();
      const rows: DelayedRow[] = await this.dataSource.query(
        `SELECT o.order_id AS id, COALESCE(o.payload->>'plan_trip_code', o.trip_code) AS trip_code,
                o.vehicle_code, o.planned_end::text AS planned_end, o.delay_minutes
         FROM operation_orders o
         WHERE o.status IN ('PENDING', 'PROCESSING')
           AND o.payload->>'task_type' = 'passenger'
           AND o.payload->>'operating_day' = $1
           AND o.delay_minutes > 0
           AND NOT EXISTS (SELECT 1 FROM security_event_logs e WHERE e.dedup_key = 'trip-delay|' || o.order_id)`,
        [day],
      );
      let inserted = 0;
      for (const row of rows) {
        const e = tripDelayEvent(row, Date.now());
        const result: unknown[] = await this.dataSource.query(
          `INSERT INTO security_event_logs
             (event_id, dedup_key, received_at, vehicle_code, source_type, source_id, source_name_snapshot, origin,
              occurred_at_valid, event_code, severity, params, created_at, category_label, display_message)
           VALUES ($1, $2, $3, $4, 'SYSTEM', $5, '班表部署管理', 'CENTER', true, 'TRIP_DELAYED', 'WARNING', $6::jsonb, $7, '班車延誤', $8)
           ON CONFLICT DO NOTHING RETURNING id`,
          [e.event_id, e.dedup_key, e.received_at, e.vehicle_code, e.source_id, e.params, e.created_at, e.display_message],
        );
        inserted += result.length;
      }
      if (inserted > 0) this.invalidation?.emitEventCenter();
      return inserted;
    } catch (error) {
      this.logger.warn(`班車延誤掃描失敗：${error instanceof Error ? error.message : String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
