import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { maintenancePayloadFields } from './dispatch.charging';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DispatchEngineService } from './dispatch-engine.service';
import type { PlannedDispatch } from './dispatch.plan';
import { SimulationPlanService } from './simulation-plan.service';

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
  ) {}

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
        }
      : {}),
  };
}
