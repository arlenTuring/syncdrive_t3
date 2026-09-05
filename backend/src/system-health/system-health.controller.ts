import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MonitoringThresholdsService } from './monitoring-thresholds.service';
import {
  type HealthHistoryRange,
  SystemHealthService,
} from './system-health.service';
import {
  resolveWarnThreshold,
  type MonitoringThresholdSettings,
} from './monitoring-thresholds';

@ApiTags('SystemHealth')
@Controller('syncdrive-api/system/health')
export class SystemHealthController {
  constructor(
    private readonly systemHealth: SystemHealthService,
    private readonly thresholds: MonitoringThresholdsService,
  ) {}

  @Get('snapshot')
  @ApiOperation({
    summary: '取得主機資源與核心服務即時監測狀態',
  })
  async snapshot() {
    const [hostSnapshot, settings] = await Promise.all([
      this.systemHealth.getSnapshot(),
      this.thresholds.get(),
    ]);
    return {
      ...hostSnapshot,
      thresholds: {
        memoryUsageWarnPercent: resolveWarnThreshold(
          settings.memoryUsage,
          hostSnapshot.thresholds.memoryUsageWarnPercent,
        ),
        cpuUsageWarnPercent: resolveWarnThreshold(
          settings.cpuUsage,
          hostSnapshot.thresholds.cpuUsageWarnPercent,
        ),
        diskFreeWarnPercent: resolveWarnThreshold(
          settings.diskFree,
          hostSnapshot.thresholds.diskFreeWarnPercent,
          'below-max',
        ),
        settings,
      },
    };
  }

  @Get('history')
  @ApiOperation({
    summary: '取得主機資源歷史趨勢（記憶體環形緩衝，程序重啟後清空）',
  })
  @ApiQuery({
    name: 'range',
    required: false,
    enum: ['1h', '6h', '24h'],
  })
  history(@Query('range') range?: string) {
    const allowed: HealthHistoryRange[] = ['1h', '6h', '24h'];
    const resolved = allowed.includes(range as HealthHistoryRange)
      ? (range as HealthHistoryRange)
      : '6h';
    return {
      range: resolved,
      points: this.systemHealth.getHistory(resolved),
    };
  }

  @Get('thresholds')
  @ApiOperation({
    summary: '取得系統共用監測閾值設定（system_settings）',
  })
  async getThresholds(): Promise<MonitoringThresholdSettings> {
    return this.thresholds.get();
  }

  @Put('thresholds')
  @ApiOperation({
    summary: '儲存系統共用監測閾值設定（所有操作人員共用）',
  })
  @ApiBody({
    description: '四項指標的通知人員與閾值條件',
  })
  async putThresholds(
    @Body() body: MonitoringThresholdSettings,
  ): Promise<MonitoringThresholdSettings> {
    return this.thresholds.save(body);
  }
}
