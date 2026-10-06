import { Controller, Get } from '@nestjs/common';
import { OperationMetricsService } from './operation-metrics.service';

/**
 * 儀表板營運指標（規則見 operation-metrics.ts）。訂單狀態改變時後端會發
 * table:operation_orders／domain:shift_center 失效通知，前端據此重查。
 */
@Controller('syncdrive-api/operation-metrics')
export class OperationMetricsController {
  constructor(private readonly operationMetricsService: OperationMetricsService) {}

  /** 班次中心：目前營運日採用的每日計畫——總共／完成／延誤班次、達成率、剩餘班次、未達成原因 */
  @Get('shift-center')
  async getShiftCenter() {
    return this.operationMetricsService.getShiftCenter();
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
}
