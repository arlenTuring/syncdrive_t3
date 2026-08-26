import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DispatchEngineService } from './dispatch-engine.service';

/**
 * 即時調度引擎的內部維運介面。
 *
 * <strong>刻意不掛 @ExternalApi</strong>——這幾支會揭露班表結構與車輛指派邏輯，
 * 只在 80 埠可達，3100 埠一律 404。
 */
@ApiTags('即時調度引擎')
@Controller('syncdrive-api/dispatch')
export class DispatchController {
  constructor(private readonly engine: DispatchEngineService) {}

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
      '把部署中的班表展開成今日全部待下訂單。純讀取，不會發訂單，可用來對照班表與實際指派。',
  })
  async plan(): Promise<Record<string, unknown>> {
    const plan = await this.engine.planToday();
    if (!plan) return { deployed: false, message: '目前沒有部署中的班表' };
    return {
      deployed: true,
      shift_id: plan.shiftId,
      shift_name: plan.shiftName,
      trip_count: plan.planned.length,
      skipped: plan.skipped,
      trips: plan.planned.map((item) => ({
        order_id: item.orderId,
        trip_code: item.tripCode,
        vehicle_code: item.vehicleCode,
        timeline_row: item.timelineRow,
        route_code: item.routeCode,
        depart_at: item.departAt,
        arrive_at: item.arriveAt,
        kind: item.kind,
        origin: item.origin?.name ?? null,
        destination: item.destination?.name ?? null,
        station_count: item.stations.length,
      })),
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
      '停用時保留既有訂單，只是不再發新的。重啟後回到 DISPATCH_ENABLED 的值。',
  })
  setEnabled(@Body() body: { enabled?: boolean }): Record<string, unknown> {
    const enabled = body?.enabled !== false;
    this.engine.setEnabled(enabled);
    return { enabled };
  }
}
