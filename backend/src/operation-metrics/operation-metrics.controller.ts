import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { OperationMetricsService } from './operation-metrics.service';
import { StationEtaService } from './station-eta.service';

/**
 * 儀表板營運指標（規則見 operation-metrics.ts）。訂單狀態改變時後端會發
 * table:operation_orders／domain:shift_center 失效通知，前端據此重查。
 */
@Controller('syncdrive-api/operation-metrics')
export class OperationMetricsController {
  constructor(
    private readonly operationMetricsService: OperationMetricsService,
    private readonly stationEtaService: StationEtaService,
  ) {}

  /** 班次中心：目前營運日採用的每日計畫——總共／完成／延誤班次、達成率、剩餘班次、未達成原因 */
  @Get('shift-center')
  async getShiftCenter(
    @Query('date') date?: string,
    @Query('start') start?: string,
  ) {
    return this.operationMetricsService.getShiftCenter({ date, start });
  }

  /** 運能趨勢上方數值：即時／目標／可用／下段 */
  @Get('capacity-summary')
  async getCapacitySummary() {
    return this.operationMetricsService.getCapacitySummary();
  }

  /** 運能趨勢圖：計畫與實際 pphpd（每列一個時間點） */
  @Get('capacity-trend')
  async getCapacityTrend() {
    return this.operationMetricsService.getCapacityTrend();
  }

  /**
   * 站點到站／出發清單（儀表板 N2W／S2W／T3 元件）：每日計畫站序＋車端即時回報，營運時間。
   * arrive＝列到站的站點、depart＝列出發的站點（可重複或逗號分隔）；station_id 等同 arrive。
   * limit 預設 3（1～10）。登入端內部端點，不需要車端金鑰。
   */
  @Get('station-eta')
  async getStationEta(
    @Query('station_id') stationId?: string | string[],
    @Query('arrive') arrive?: string | string[],
    @Query('depart') depart?: string | string[],
    @Query('limit') limit?: string,
  ) {
    const list = (raw?: string | string[]) => (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const byId = new Map<string, Set<'arrive' | 'depart'>>();
    const add = (id: string, event: 'arrive' | 'depart') => {
      if (!byId.has(id)) byId.set(id, new Set());
      byId.get(id)!.add(event);
    };
    for (const id of [...list(stationId), ...list(arrive)]) add(id, 'arrive');
    for (const id of list(depart)) add(id, 'depart');
    if (byId.size === 0) throw new BadRequestException('需要 arrive 或 depart（站點 ID）');
    const n = limit == null ? 3 : Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new BadRequestException('limit 需為 1～10 的整數');
    return this.stationEtaService.byStation(
      [...byId].map(([stationId, events]) => ({ stationId, events: [...events] })),
      n,
    );
  }
}
