import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MaintenanceDistributionService } from '../facility/maintenance-distribution.service';
import { OperationShiftService } from '../operation-shift/operation-shift.service';
import { TimeTemplateService } from '../time-template/time-template.service';
import {
  buildShiftCenterSummary,
  countPlannedPassengerTrips,
  DAY_MINUTES,
  formatClock,
  mergeDepartureLeads,
  nextSegment,
  perVehiclePphpd,
  plannedLeadsFromShift,
  pphpdAt,
  routesFromShift,
  segmentAt,
  templateSegments,
  type DepartureLead,
  type ShiftCenterSummary,
} from './operation-metrics';

const DAY_MS = DAY_MINUTES * 60_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
/** 運能趨勢圖的取樣間隔與範圍（跟圖的時間窗：過去 2 小時、未來 4 小時） */
const TREND_BUCKET_MINUTES = 10;
const TREND_PAST_MINUTES = 120;
const TREND_FUTURE_MINUTES = 240;
/** 實際運能低於計畫這個比例就在圖上標記 */
const TREND_SHORTFALL_RATIO = 0.8;

/** 台北時間今天 00:00（Epoch 毫秒） */
function taipeiDayStart(now: number): number {
  return Math.floor((now + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

@Injectable()
export class OperationMetricsService {
  private readonly logger = new Logger(OperationMetricsService.name);

  constructor(
    private readonly operationShiftService: OperationShiftService,
    private readonly timeTemplateService: TimeTemplateService,
    private readonly maintenanceDistributionService: MaintenanceDistributionService,
    private readonly dataSource: DataSource,
  ) {}

  /** 班次中心：部署班表今天的正線班次，完成／延誤／達成率 */
  async getShiftCenter(now = Date.now()): Promise<ShiftCenterSummary> {
    const shift = await this.operationShiftService.getDeployedShift();
    if (!shift) {
      return buildShiftCenterSummary({ shiftName: null, plannedTrips: 0, orders: [], now });
    }
    const dayStart = taipeiDayStart(now);
    const rows: Array<{ status: string; planned_end: string | null; delay_minutes: number | null }> = await this.dataSource.query(
      `SELECT status::text AS status, planned_end, delay_minutes
       FROM operation_orders
       WHERE line_kind = 'MAINLINE'
         AND payload->>'shift_id' = $1
         AND planned_start >= $2 AND planned_start < $3`,
      [shift.shiftId, dayStart, dayStart + DAY_MS],
    );
    return buildShiftCenterSummary({
      shiftName: shift.shiftName,
      plannedTrips: countPlannedPassengerTrips(shift.body),
      orders: rows.map((row) => ({
        status: row.status,
        plannedEnd: row.planned_end != null ? Number(row.planned_end) : null,
        delayMinutes: row.delay_minutes,
      })),
      now,
    });
  }

  /** 運能趨勢上方四個數值 */
  async getCapacitySummary(now = Date.now()) {
    const ctx = await this.loadCapacityContext(now);
    const nowSecond = Math.round((now - ctx.dayStart) / 1000);
    const nowMinute = nowSecond / 60;
    const current = segmentAt(ctx.segments, nowMinute);
    const next = nextSegment(ctx.segments, nowMinute);
    const vehicles = await this.maintenanceDistributionService.getVehicleDistribution();
    const standby = vehicles.find((row) => row.status_code === 'STANDBY')?.vehicle_count ?? 0;
    return {
      live_val: roundTo(pphpdAt(ctx.actualLeads, nowSecond, ctx.vehicleCapacity), 10),
      target_val: current?.pphpd ?? 0,
      avail_val: roundTo(standby * perVehiclePphpd(ctx.body, ctx.vehicleCapacity), 10),
      avail_hint: `可調度${standby}輛`,
      next_val: next?.pphpd ?? 0,
      next_hint: next ? formatClock(next.startMinute) : '—',
      segment_label: current?.label ?? '',
    };
  }

  /** 運能趨勢圖：計畫（班表發車）與實際（訂單實際發車）pphpd，過去 2 小時到未來 4 小時 */
  async getCapacityTrend(now = Date.now()) {
    const ctx = await this.loadCapacityContext(now);
    const nowMinute = (now - ctx.dayStart) / 60_000;
    const firstBucket = Math.floor((nowMinute - TREND_PAST_MINUTES) / TREND_BUCKET_MINUTES) * TREND_BUCKET_MINUTES;
    const lastBucket = Math.ceil((nowMinute + TREND_FUTURE_MINUTES) / TREND_BUCKET_MINUTES) * TREND_BUCKET_MINUTES;
    const rows: Array<Record<string, unknown>> = [];
    let previousShort = false;
    for (let minute = firstBucket; minute <= lastBucket; minute += TREND_BUCKET_MINUTES) {
      const sampleMinute = minute <= nowMinute && minute + TREND_BUCKET_MINUTES > nowMinute ? nowMinute : minute;
      const second = Math.round(sampleMinute * 60);
      const forecast = roundTo(pphpdAt(ctx.plannedLeads, second, ctx.vehicleCapacity), 10);
      const past = sampleMinute <= nowMinute;
      const actual = past ? roundTo(pphpdAt(ctx.actualLeads, second, ctx.vehicleCapacity), 10) : null;
      const short = actual != null && forecast > 0 && actual < forecast * TREND_SHORTFALL_RATIO;
      rows.push({
        time: formatClock(sampleMinute),
        actual_util: actual,
        forecast_util: forecast,
        segment_code: past ? 'IN_SERVICE' : 'SCHEDULED',
        // 只標記「開始不足」的那一點，連續不足不重複標
        is_anomaly: short && !previousShort,
        anomaly_label: short && !previousShort
          ? `低於計畫 ${Math.round(100 * (1 - (actual ?? 0) / forecast))}%`
          : null,
      });
      previousShort = short;
    }
    return rows;
  }

  private async loadCapacityContext(now: number): Promise<{
    body: Record<string, unknown>;
    dayStart: number;
    vehicleCapacity: number;
    segments: ReturnType<typeof templateSegments>;
    plannedLeads: DepartureLead[];
    actualLeads: DepartureLead[];
  }> {
    const dayStart = taipeiDayStart(now);
    const shift = await this.operationShiftService.getDeployedShift();
    const body = shift?.body ?? {};

    let templateBody: Record<string, unknown> | null = null;
    const templateId = typeof body.timeTemplateId === 'string' ? body.timeTemplateId.trim() : '';
    if (templateId) {
      try {
        templateBody = (await this.timeTemplateService.getTemplateDetail(templateId)).body;
      } catch (err) {
        this.logger.warn(`找不到班表綁定的時間模板 ${templateId}：${(err as Error).message}`);
      }
    }
    const vehicleCapacity = Number(templateBody?.vehicleCapacity) || 0;
    const routes = routesFromShift(body);

    // 班表是日循環：前一天延續到今天、今天延續到明天的班次都要算進取樣視窗
    const dayLeads = plannedLeadsFromShift(body, routes);
    const plannedLeads = [-1, 0, 1].flatMap((day) =>
      dayLeads.map((lead) => ({ ...lead, atSecond: lead.atSecond + day * DAY_MINUTES * 60 })));

    const actualLeads: DepartureLead[] = [];
    if (shift) {
      const rows: Array<{ vehicle_code: string; route_code: string | null; route_id: string | null; started_at: string }> = await this.dataSource.query(
        `SELECT vehicle_code,
                payload->>'route_code' AS route_code,
                route_id,
                COALESCE((payload->>'actual_started_at')::bigint, planned_start) AS started_at
         FROM operation_orders
         WHERE line_kind = 'MAINLINE'
           AND payload->>'shift_id' = $1
           AND status IN ('PROCESSING', 'END')
           AND COALESCE((payload->>'actual_started_at')::bigint, planned_start) >= $2`,
        [shift.shiftId, dayStart - DAY_MS],
      );
      const routeIdByCode = new Map(routes.filter((route) => route.routeCode).map((route) => [route.routeCode!, route.routeId] as const));
      const directionByRoute = new Map(routes.map((route) => [route.routeId, route.directionKey] as const));
      const byVehicle = new Map<string, Array<{ routeKey: string; atSecond: number }>>();
      for (const row of rows) {
        const routeKey = (row.route_code ? routeIdByCode.get(row.route_code) : undefined) ?? row.route_id ?? '';
        if (!routeKey) continue;
        const list = byVehicle.get(row.vehicle_code) ?? [];
        list.push({ routeKey, atSecond: Math.round((Number(row.started_at) - dayStart) / 1000) });
        byVehicle.set(row.vehicle_code, list);
      }
      for (const segments of byVehicle.values()) {
        actualLeads.push(...mergeDepartureLeads(segments, (key) => directionByRoute.get(key) ?? null));
      }
    }

    return { body, dayStart, vehicleCapacity, segments: templateSegments(templateBody), plannedLeads, actualLeads };
  }
}
