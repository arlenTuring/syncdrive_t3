import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { maintenancePayloadFields } from './dispatch.charging';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DailyPlanVersionMismatch, DispatchEngineService } from './dispatch-engine.service';
import { describeSwitch, type DailyPlanAdoption } from './daily-plan';
import { isOperatingDay, operatingDayOf } from '../operating-day/operating-day';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import type { PlannedDispatch } from './dispatch.plan';
import { SimulationPlanService } from './simulation-plan.service';
import { dispatchOrderFields } from './dispatch-order-kind';

/**
 * 即時調度引擎的內部維運介面。
 *
 * <strong>刻意不掛 @ExternalApi</strong>——這幾支會揭露班表結構與車輛指派邏輯，
 * 只在 80 埠可達，3100 埠一律 404。
 */
@ApiTags('即時調度引擎')
@Controller('syncdrive-api/dispatch')
export class DispatchController {
  constructor(
    private readonly engine: DispatchEngineService,
    private readonly simulationPlan: SimulationPlanService,
    private readonly operatingClock: OperatingClockService,
  ) {}

  @Get('daily-plan')
  @ApiOperation({
    summary: '某營運日採用的每日計畫',
    description:
      '班次中心的統計範圍。day 省略為目前營運日。當天沒有採用紀錄時採用部署中的班表並記下；' +
      '過去的日子沒有紀錄就回 adopted=false，不拿現在的班表回填。',
  })
  async dailyPlan(@Query('day') day?: string): Promise<Record<string, unknown>> {
    const target = day ?? this.operatingClock.operatingDay();
    if (!isOperatingDay(target)) throw new BadRequestException('day 格式為 YYYY-MM-DD');
    const adoption = await this.engine.ensureDailyPlan(target);
    if (!adoption) return { adopted: false, operating_day: target, message: '尚未部署每日計畫' };
    return { adopted: true, ...summarizeAdoption(adoption), history: adoption.history };
  }

  @Post('daily-plan/adopt')
  @ApiOperation({
    summary: '部署每日計畫（明確切換該營運日採用的班表）',
    description:
      '模擬器「部署並開始」、維運手動切換用。operating_day 省略為目前營運日。expected_plan_digest 有給時，' +
      '班表目前展開的版本必須相同（載入後被改過就回 409）。回傳切換結果：前後版本與載客班次數；' +
      '舊版本的訂單保留，但不計入新版本的完成數。',
  })
  async adoptDailyPlan(@Body() body: {
    shift_id?: string;
    operating_day?: string;
    expected_plan_digest?: string;
    load_digest?: string;
    via?: string;
    adopted_by?: string;
  }): Promise<Record<string, unknown>> {
    const shiftId = typeof body?.shift_id === 'string' ? body.shift_id.trim() : '';
    if (!shiftId) throw new BadRequestException('需要 shift_id');
    const day = body.operating_day ?? this.operatingClock.operatingDay();
    if (!isOperatingDay(day)) throw new BadRequestException('operating_day 格式為 YYYY-MM-DD');
    const via = body.via === 'simulator' ? 'simulator' : body.via === 'deploy' ? 'deploy' : 'manual';
    try {
      const { previous, adoption } = await this.engine.adoptDailyPlan({
        shiftId,
        day,
        via,
        by: body.adopted_by ?? null,
        expectedPlanDigest: body.expected_plan_digest ?? null,
        loadDigest: body.load_digest ?? null,
      });
      return { ...summarizeAdoption(adoption), switch: describeSwitch(previous, adoption) };
    } catch (error) {
      if (error instanceof DailyPlanVersionMismatch) {
        throw new ConflictException({ code: 'PLAN_VERSION_CHANGED', message: error.message, expected: error.expected, actual: error.actual });
      }
      throw error;
    }
  }

  @Get('operating-clock')
  @ApiOperation({
    summary: '營運時鐘',
    description:
      '目前營運日、營運時刻、倍速、是否暫停／中斷。正式營運時營運時間＝實際時間；加速重播時由執行端推進。' +
      '儀表板的班次狀態、延誤、ETA、倒數都以這個時鐘為準。',
  })
  operatingClockSnapshot(): Record<string, unknown> {
    return this.operatingClock.snapshot();
  }

  @Post('operating-clock')
  @ApiOperation({
    summary: '推進營運時鐘（執行端用）',
    description:
      'mode=replay 時帶 run_id、operating_day、operating_now（此刻的營運時刻，毫秒）、rate（1～180）、paused、ended、lag_ms；' +
      '執行中要定期回報（心跳），超過 15 秒沒消息畫面會標示中斷。mode=realtime 回到實際時間。',
  })
  async updateOperatingClock(@Body() body: {
    mode?: string;
    run_id?: string;
    operating_day?: string;
    operating_now?: number;
    rate?: number;
    paused?: boolean;
    ended?: boolean;
    lag_ms?: number;
  }): Promise<Record<string, unknown>> {
    if (body?.mode !== 'replay' && body?.mode !== 'realtime') throw new BadRequestException('mode 需為 replay 或 realtime');
    if (body.mode === 'replay' && body.operating_day != null && !isOperatingDay(body.operating_day)) {
      throw new BadRequestException('operating_day 格式為 YYYY-MM-DD');
    }
    try {
      return await this.operatingClock.update({
        mode: body.mode,
        runId: body.run_id ?? null,
        operatingDay: body.operating_day ?? (Number.isFinite(Number(body.operating_now)) ? operatingDayOf(Number(body.operating_now)) : null),
        operatingNow: body.operating_now,
        rate: body.rate,
        paused: body.paused,
        ended: body.ended,
        lagMs: body.lag_ms,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get('status')
  @ApiOperation({
    summary: '調度引擎狀態',
    description:
      '目前部署中的班表、今日班次數、已下訂單數、接下來十班、最近下的十張訂單。',
  })
  async status(): Promise<Record<string, unknown>> {
    return this.engine.status();
  }

  @Get('plan')
  @ApiOperation({
    summary: '今日完整調度計畫',
    description:
      '把部署中的班表展開成今日全部待下訂單。純讀取，不會發訂單，可用來對照班表與實際指派。' +
      '`full=1` 時每筆多帶完整起訖點與站序（含各站計畫時刻），供外部工具（例如模擬器的' +
      '整日班表重播）自行組出訂單內容，不需要重新展開班表。',
  })
  async plan(@Query('full') full?: string): Promise<Record<string, unknown>> {
    const plan = await this.engine.planToday();
    if (!plan) return { deployed: false, message: '目前沒有部署中的班表' };
    const detailed = full === '1' || full === 'true';
    return {
      deployed: true,
      shift_id: plan.shiftId,
      shift_name: plan.shiftName,
      trip_count: plan.planned.length,
      skipped: plan.skipped,
      trips: plan.planned.map((item) => serializePlanned(item, detailed)),
    };
  }

  @Get('plan/shift/:shiftId')
  @ApiOperation({
    summary: '指定班表的完整執行計畫（模擬器依班表 ID 載入用）',
    description:
      '依班表 ID 展開成今日全部任務（正線、出入廠／轉場、整備），與正式調度同一套展開與車輛指派。' +
      '找不到該班表回 404，不會退回部署中或最新的班表。回傳班表製作／儲存時間、引用地圖、' +
      '能否模擬與原因、版本摘要（identity）。純讀取：不下訂單、不發布、不改使用狀態。' +
      '`full=1` 時每筆多帶完整起訖點與站序；`map=1` 時附上引用地圖的完整內容。',
  })
  async planForShift(
    @Param('shiftId') shiftId: string,
    @Query('full') full?: string,
    @Query('map') map?: string,
  ): Promise<Record<string, unknown>> {
    const detailed = full === '1' || full === 'true';
    const withMap = map === '1' || map === 'true';
    const result = await this.simulationPlan.build(shiftId);
    const { planned, mapDocument, ...meta } = result;
    return {
      ...meta,
      trips: planned.map((item) => serializePlanned(item, detailed)),
      ...(withMap ? { map_document: mapDocument } : {}),
    };
  }

  @Get('simulation/runs/:runId')
  @ApiOperation({
    summary: '模擬執行進度（依訂單 payload.plan_run_id 追溯）',
    description:
      '模擬器建單時在 payload 帶 plan_run_id／plan_shift_id／plan_load_digest／plan_run_total。' +
      '每張單只歸一類：已建單未開始、執行中、車輛故障結案待確認、中心端取消待結案、已完成、已中止、故障結案。' +
      '「開始」只認車端 REST 回報（vehicle_progress_at.PROCESSING），中心端寫的完成時間不算車端證據。' +
      '本輪計畫數取自訂單上的 plan_run_total；沒建單的計畫項以 not_created 列出（伺服器無法區分未發送與建單失敗）。' +
      'outcome 只有在所有已建訂單結案、而且建單數等於計畫數時才可能是 all_completed。純讀取。',
  })
  async simulationRun(@Param('runId') runId: string): Promise<Record<string, unknown>> {
    return this.simulationPlan.runStatus(runId);
  }

  @Get('dry-run')
  @ApiOperation({
    summary: '試跑一次檢查',
    description:
      '照現在時刻算出「這一刻會下哪些訂單」，但不真的下。上線前對時用。',
  })
  async dryRun(@Query('at') at?: string): Promise<Record<string, unknown>> {
    const now = at ? Number(at) : Date.now();
    const result = await this.engine.tick({
      dryRun: true,
      now: Number.isFinite(now) ? now : Date.now(),
    });
    return {
      at: Number.isFinite(now) ? now : Date.now(),
      checked: result.checked,
      would_issue: result.issued.map((item) => ({
        order_id: item.orderId,
        vehicle_code: item.vehicleCode,
        depart_at: item.departAt,
      })),
      expired: result.expired.map((item) => item.orderId),
      skipped: result.skipped,
    };
  }

  @Post('enable')
  @ApiOperation({
    summary: '線上開關',
    description:
      '停用時保留既有訂單，只是不再發新的。狀態保存於資料庫，重啟後不會自行恢復。',
  })
  async setEnabled(
    @Body() body: { enabled?: boolean },
  ): Promise<Record<string, unknown>> {
    const enabled = body?.enabled !== false;
    await this.engine.setEnabled(enabled);
    return { enabled };
  }
}

/** /plan 與 /plan/shift/:id 共用的任務格式 */
function serializePlanned(
  item: PlannedDispatch,
  detailed: boolean,
): Record<string, unknown> {
  return {
    order_id: item.orderId,
    trip_code: item.tripCode,
    vehicle_code: item.vehicleCode,
    timeline_row: item.timelineRow,
    route_code: item.routeCode,
    depart_at: item.departAt,
    arrive_at: item.arriveAt,
    kind: item.kind,
    task_type: item.taskType,
    origin: item.origin?.name ?? null,
    destination: item.destination?.name ?? null,
    station_count: item.stations.length,
    ...(detailed
      ? {
          origin_point: item.origin,
          destination_point: item.destination,
          stations: item.stations,
          maintenance: maintenancePayloadFields(item.maintenance),
          // 下單要用的業務欄位（分類、整備徽章、任務子類型、卡片標籤），跟正式調度同一份
          order_fields: dispatchOrderFields(item),
        }
      : {}),
  };
}

function summarizeAdoption(adoption: DailyPlanAdoption): Record<string, unknown> {
  return {
    operating_day: adoption.operating_day,
    shift_id: adoption.shift_id,
    shift_name: adoption.shift_name,
    shift_version: adoption.shift_version,
    plan_digest: adoption.plan_digest,
    load_digest: adoption.load_digest,
    passenger_trips: adoption.passenger_trips.length,
    counts: adoption.counts,
    adopted_at: adoption.adopted_at,
    adopted_via: adoption.adopted_via,
    adopted_by: adoption.adopted_by,
  };
}
