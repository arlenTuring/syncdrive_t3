import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MaintenanceDistributionService } from '../facility/maintenance-distribution.service';
import { OperationShiftService } from '../operation-shift/operation-shift.service';
import { TimeTemplateService } from '../time-template/time-template.service';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';
import {
  noPlanSummary,
  summarizeDailyPlan,
  tripsInWindow,
  type ShiftCenterSummary,
} from '../dispatch/daily-plan';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { DELAY_TOLERANCE_MS, localMidnight, operatingDayOf, operatingDayStart } from '../operating-day/operating-day';
import {
  buildCapacityTrend,
  DAY_MINUTES,
  capacitySampleMs,
  formatClock,
  formatHeadway,
  mergeDepartureLeads,
  nextSegment,
  perVehiclePphpd,
  pphpdAt,
  routesFromShift,
  segmentAt,
  templateSegments,
  type DepartureLead,
} from './operation-metrics';

const DAY_MS = DAY_MINUTES * 60_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
/** 運能趨勢圖的取樣間隔與範圍（跟圖的時間窗：過去 2 小時、未來 4 小時） */
const TREND_BUCKET_MINUTES = 10;
const TREND_PAST_MINUTES = 120;
const TREND_FUTURE_MINUTES = 240;

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
    private readonly engine: DispatchEngineService,
    private readonly clock: OperatingClockService,
  ) {}

  /**
   * 班次中心：目前營運日採用的每日計畫（dispatch/daily-plan.ts）。
   *
   * 分母是計畫裡的載客班次，完成數依計畫班次去重；訂單只認 payload 上的每日計畫關聯
   * （operating_day、plan_shift_id、plan_digest、plan_trip_code），不看資料來源或執行 ID。
   * 查詢失敗直接丟出（畫面顯示錯誤），不回零。
   */
  async getShiftCenter(options: { date?: string; start?: string } = {}): Promise<ShiftCenterSummary> {
    const operatingNow = this.clock.now();
    const day = options.date?.match(/^\d{4}-\d{2}-\d{2}$/) ? options.date : this.clock.operatingDay();
    const match = (options.start ?? '00:00').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) throw new Error('統計起始時間格式必須為 HH:mm');
    const dayStart = operatingDayStart(day);
    if (dayStart == null) throw new Error('統計日期格式不正確');
    const startMinutes = Number(match[1]) * 60 + Number(match[2]);
    const rangeStart = dayStart + startMinutes * 60_000;
    const rangeEnd = rangeStart + DAY_MS;
    const nextDay = new Date(dayStart + DAY_MS + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
    const requiredDays = startMinutes === 0 ? [day] : [day, nextDay];
    const adoptions = await Promise.all(requiredDays.map(async (value) => ({ day: value, adoption: await this.engine.ensureDailyPlan(value) })));
    const missingDays = adoptions.filter((item) => !item.adoption).map((item) => item.day);
    if (adoptions.every((item) => !item.adoption)) return { ...noPlanSummary(day, operatingNow), range: { start: rangeStart, end: rangeEnd, start_time: options.start ?? '00:00', timezone: 'Asia/Taipei' }, missing_days: missingDays };
    const parts: ShiftCenterSummary[] = [];
    const trips: NonNullable<ShiftCenterSummary['trips']> = [];
    for (const item of adoptions) {
      const adoption = item.adoption;
      if (!adoption) continue;
      const selected = tripsInWindow(adoption, rangeStart, rangeEnd);
      const scoped = { ...adoption, passenger_trips: selected, counts: { ...adoption.counts, passenger: selected.length } };
      const rows = await this.shiftCenterOrders(item.day, adoption.shift_id);
      const summary = summarizeDailyPlan(scoped, rows, operatingNow);
      parts.push(summary);
      for (const trip of selected) {
        const matching = rows.filter((row) => row.tripCode === trip.code && row.planDigest === adoption.plan_digest);
        const completedOrder = matching.find((row) => row.status === 'END');
        trips.push({
          ...trip,
          operating_day: item.day,
          completed: Boolean(completedOrder),
          delayed: Boolean(completedOrder && trip.end != null && completedOrder.completedAt != null && completedOrder.completedAt > trip.end + DELAY_TOLERANCE_MS),
        });
      }
    }
    const total = parts.reduce((sum, part) => sum + (part.total_shifts ?? 0), 0);
    const completed = parts.reduce((sum, part) => sum + (part.completed_shifts ?? 0), 0);
    const delayed = parts.reduce((sum, part) => sum + (part.delayed_shifts ?? 0), 0);
    const pct = total ? Math.floor(100 * completed / total) : 0;
    const remaining = total - completed;
    const unachieved = parts.reduce((sum, part) => {
      if (!part.unachieved) return sum;
      for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += part.unachieved[key];
      return sum;
    }, { faulted: 0, cancelled: 0, in_progress: 0, pending: 0, not_run_overdue: 0, not_due: 0 });
    const reasons = [
      unachieved.faulted ? `故障 ${unachieved.faulted}` : '',
      unachieved.cancelled ? `取消 ${unachieved.cancelled}` : '',
      unachieved.not_run_overdue ? `已過時未執行 ${unachieved.not_run_overdue}` : '',
    ].filter(Boolean);
    return {
      ...parts[0]!,
      state: missingDays.length ? 'incomplete' : 'ok',
      message: missingDays.length ? `計畫資料不完整：缺少 ${missingDays.join('、')}` : null,
      operating_day: day,
      total_shifts: total,
      completed_shifts: completed,
      delayed_shifts: delayed,
      achievement_pct: pct,
      achievement_line: `達成了 ${pct}%`,
      remaining_shifts: remaining,
      remaining_line: remaining > 0 ? `剩餘${remaining}班次` : '',
      unachieved,
      unachieved_line: reasons.length ? `未達成：${reasons.join('、')}` : '',
      other_version_orders: parts.reduce((sum, part) => sum + part.other_version_orders, 0),
      range: { start: rangeStart, end: rangeEnd, start_time: options.start ?? '00:00', timezone: 'Asia/Taipei' },
      trips,
      missing_days: missingDays,
    };
  }

  private async shiftCenterOrders(day: string, shiftId: string) {
    const rows: Array<{
      order_id: string;
      trip_code: string;
      status: string;
      plan_digest: string | null;
      closed_reason: string | null;
      completed_at: string | null;
    }> = await this.dataSource.query(
      `SELECT order_id,
              COALESCE(payload->>'plan_trip_code', trip_code) AS trip_code,
              status::text AS status,
              payload->>'plan_digest' AS plan_digest,
              payload->>'closed_reason' AS closed_reason,
              COALESCE((payload->>'op_completed_at')::bigint, completed_at::bigint) AS completed_at
       FROM operation_orders
       WHERE payload->>'operating_day' = $1
         AND payload->>'plan_shift_id' = $2
       ORDER BY created_at ASC`,
      [day, shiftId],
    );
    return rows.map((row) => ({
        orderId: row.order_id,
        tripCode: row.trip_code,
        status: row.status,
        planDigest: row.plan_digest,
        closedReason: row.closed_reason,
        completedAt: row.completed_at != null ? Number(row.completed_at) : null,
      }));
  }

  /** 運能趨勢上方四個數值 */
  async getCapacitySummary(clockNow = this.clock.now()) {
    // 跟趨勢圖「現在」那一列同一個採樣時刻（取到營運分鐘），兩個 API 各自輪詢也對得上
    const now = capacitySampleMs(clockNow);
    const ctx = await this.loadCapacityContext(now);
    const { today } = ctx;
    const nowMinute = (now - today.dayStart) / 60_000;
    const segments = today.segments ?? [];
    const current = segmentAt(segments, nowMinute);
    const next = nextSegment(segments, nowMinute);
    const vehicles = await this.maintenanceDistributionService.getVehicleDistribution();
    // 可調度：營運分佈裡標成可調度的車（待命中、而且沒有計畫中卻還沒下單的任務）——不直接用待命中的總數
    const standby = vehicles.flatMap((row) => row.vehicles).filter((vehicle) => vehicle.dispatchable).length;
    const live = ctx.actualAt(now);
    return {
      // 跟運能趨勢圖「現在」那一點同一個算法、同一個營運時刻；算不出來（沒有實際資料）就是 null
      live_val: live,
      /** 即時數值的採樣時刻（營運時間）；跟趨勢圖 now_ms 相同時兩個數字一定一樣 */
      live_at_ms: now,
      target_val: current?.pphpd ?? 0,
      avail_val: roundTo(standby * perVehiclePphpd(today.body, ctx.vehicleCapacity), 10),
      avail_hint: `可調度${standby}輛`,
      next_val: next?.pphpd ?? 0,
      next_hint: next ? formatClock(next.startMinute) : '—',
      segment_label: current?.label ?? '',
      // 目前時段的目標班距：部署班表綁定的時間模板裡，這個時段屬性設定的班距
      headway_seconds: current?.headwaySeconds ?? null,
      headway_line: `班距 ${formatHeadway(current?.headwaySeconds ?? null)}`,
      data_issue: ctx.dataIssue,
    };
  }

  /**
   * 運能趨勢圖：過去 2 小時到未來 4 小時（營運時間，帶日期的時間戳）。
   * 灰線＝部署班表綁定的時間模板各時段的預期運能；藍線＝實際發車換算的運能，只到現在。
   * 規則見 operation-metrics.ts buildCapacityTrend。
   */
  async getCapacityTrend(clockNow = this.clock.now()) {
    const now = capacitySampleMs(clockNow);
    const ctx = await this.loadCapacityContext(now);
    return buildCapacityTrend({
      now,
      days: ctx.days,
      pastMinutes: TREND_PAST_MINUTES,
      futureMinutes: TREND_FUTURE_MINUTES,
      bucketMinutes: TREND_BUCKET_MINUTES,
      actualAt: ctx.actualAt,
      dataIssue: ctx.dataIssue,
      formatTime: (ts) => formatClock((ts - localMidnight(ts)) / 60_000),
    });
  }

  /** 某營運日採用的班表與它綁定的時間模板 */
  private async loadCapacityDay(day: string, isCurrent: boolean) {
    const dayStart = operatingDayStart(day) ?? taipeiDayStart(this.clock.now());
    // 今天會自動採用部署中的班表；過去的日子只讀當天的紀錄，沒有就是沒有
    const adoption = await this.engine.ensureDailyPlan(day);
    const shift = adoption ? await this.adoptedShift(adoption.shift_id) : null;
    const body = shift?.body ?? {};
    let templateBody: Record<string, unknown> | null = null;
    let templateIssue: string | null = null;
    const templateId = typeof body.timeTemplateId === 'string' ? body.timeTemplateId.trim() : '';
    if (!shift) {
      templateIssue = `${day} 沒有採用的班表`;
    } else if (!templateId) {
      templateIssue = '部署班表沒有綁定時間模板';
    } else {
      try {
        templateBody = (await this.timeTemplateService.getTemplateDetail(templateId)).body;
      } catch (err) {
        this.logger.warn(`找不到班表綁定的時間模板 ${templateId}：${(err as Error).message}`);
        templateIssue = `讀不到班表綁定的時間模板 ${templateId}`;
      }
    }
    const segments = templateBody ? templateSegments(templateBody) : null;
    if (templateBody && segments!.length === 0) templateIssue = '時間模板沒有有效的時段';
    return {
      day,
      dayStart,
      isCurrent,
      shiftId: shift?.shiftId ?? null,
      body,
      templateBody,
      segments: segments && segments.length > 0 ? segments : null,
      templateIssue,
    };
  }

  private async loadCapacityContext(now: number) {
    // 營運日與班表都取每日計畫（跟班次中心同一份），時間是營運時間
    const day = this.clock.operatingDay();
    const today = await this.loadCapacityDay(day, true);
    const previousDay = operatingDayOf(today.dayStart - 12 * 60 * 60 * 1000);
    const yesterday = await this.loadCapacityDay(previousDay, false);
    /*
     * 灰線（預期運能）整個視窗都用「今天部署班表引用的時間模板」：模板是日循環，跟上方目標數值、
     * 下段數值同一份。不用前一天自己採用的班表——那一天沒有每日計畫時（例如部署機重播只跑了今天）
     * 午夜前就整段沒有灰線。實際值另外只用各日自己的真實訂單，不跨日複製。
     */
    const templateDay = (dayStart: number, day: string) => ({
      day,
      dayStart,
      isCurrent: false,
      segments: today.segments,
      templateIssue: today.templateIssue,
    });
    const days = [
      templateDay(yesterday.dayStart, yesterday.day),
      today,
      templateDay(today.dayStart + DAY_MS, operatingDayOf(today.dayStart + 36 * 60 * 60 * 1000)),
    ];

    const vehicleCapacity = Number(today.templateBody?.vehicleCapacity) || 0;
    const dataIssue = today.templateIssue
      ?? (vehicleCapacity > 0 ? null : '時間模板沒有設定車輛載客量，無法換算運能');

    // 實際發車：昨天與今天各自採用的那份班表的正線訂單，以實際開始執行的營運時刻為準
    // （沒有實際開始時刻的不算，不拿計畫時刻冒充）。重播時只算這一次執行。
    const replay = this.clock.replayRun();
    const actualLeads: DepartureLead[] = [];
    for (const source of [yesterday, today]) {
      if (!source.shiftId) continue;
      const routes = routesFromShift(source.body);
      const params: unknown[] = [source.shiftId, source.day];
      let runFilter = '';
      if (replay?.runId) {
        params.push(replay.runId);
        runFilter = `AND payload->>'plan_run_id' = $${params.length}`;
      }
      const rows: Array<{ vehicle_code: string; route_code: string | null; route_id: string | null; started_at: string }> = await this.dataSource.query(
        `SELECT vehicle_code,
                payload->>'route_code' AS route_code,
                route_id,
                COALESCE((payload->>'op_started_at')::bigint, (payload->>'actual_started_at')::bigint) AS started_at
         FROM operation_orders
         WHERE line_kind = 'MAINLINE'
           AND payload->>'plan_shift_id' = $1
           AND payload->>'operating_day' = $2
           AND status IN ('PROCESSING', 'END')
           AND COALESCE(payload->>'op_started_at', payload->>'actual_started_at') IS NOT NULL
           ${runFilter}`,
        params,
      );
      const routeIdByCode = new Map(routes.filter((route) => route.routeCode).map((route) => [route.routeCode!, route.routeId] as const));
      const directionByRoute = new Map(routes.map((route) => [route.routeId, route.directionKey] as const));
      const byVehicle = new Map<string, Array<{ routeKey: string; atSecond: number }>>();
      for (const row of rows) {
        const routeKey = (row.route_code ? routeIdByCode.get(row.route_code) : undefined) ?? row.route_id ?? '';
        if (!routeKey) continue;
        const list = byVehicle.get(row.vehicle_code) ?? [];
        // 秒數一律以今天零點為基準，昨天的發車是負數，跨午夜的班距照算
        list.push({ routeKey, atSecond: Math.round((Number(row.started_at) - today.dayStart) / 1000) });
        byVehicle.set(row.vehicle_code, list);
      }
      for (const segments of byVehicle.values()) {
        actualLeads.push(...mergeDepartureLeads(segments, (key) => directionByRoute.get(key) ?? null));
      }
    }

    // 實際資料從哪裡開始有：重播是這次執行開始的時刻；正式營運是昨天零點（往前沒有載入）
    const actualFrom = replay?.startedAt ?? yesterday.dayStart;
    const actualAt = (ts: number): number | null => {
      if (vehicleCapacity <= 0 || ts < actualFrom || ts > now) return null;
      return roundTo(pphpdAt(actualLeads, Math.round((ts - today.dayStart) / 1000), vehicleCapacity), 10);
    };

    return { today, days, vehicleCapacity, dataIssue, actualAt };
  }

  /** 每日計畫的班表內容：跟部署中是同一份就用它的快取，否則讀那一份 */
  private async adoptedShift(shiftId: string): Promise<{ shiftId: string; body: Record<string, unknown> } | null> {
    const deployed = await this.operationShiftService.getDeployedShift();
    if (deployed?.shiftId === shiftId) return deployed;
    try {
      const row = await this.operationShiftService.getShiftTrips(shiftId);
      return { shiftId: row.shiftId, body: row.body };
    } catch (err) {
      this.logger.warn(`讀不到每日計畫的班表 ${shiftId}：${(err as Error).message}`);
      return null;
    }
  }
}
