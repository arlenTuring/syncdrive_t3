import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VehicleService } from './vehicle.service';
import { RequirePermission } from '../access-control/access.guard';
import { VehicleRealtimeQueryDto } from './dto/vehicle-realtime-query.dto';

@ApiTags('vehicles')
@Controller('syncdrive-api/vehicles')
@RequirePermission('vehicle.realtime.view', 'site.map.view', 'dashboard.monitor.view')
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出資料庫中啟用中的註冊車輛' })
  async list() {
    const items = await this.vehicleService.listActive();
    return {
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        vehicle_code: item.vehicleCode,
        display_name: item.displayName,
        is_active: item.isActive,
      })),
    };
  }

  /**
   * 規格書 §即時資料顯示介面
   * 前端頁面載入時呼叫此 API，一次取得所有車輛目前的最新狀態快照。
   * 資料來源為資料庫的一車一筆持久化快照，Redis 清空或後端重啟仍可還原。
   *
   * GET /syncdrive-api/vehicles/snapshot
   */
  @Get('snapshot')
  @RequirePermission('vehicle.realtime.view')
  @ApiOperation({ summary: '取得所有車輛當前狀態快照 (Cold Start Snapshot)' })
  @ApiResponse({
    status: 200,
    description: '回傳所有車輛的 telemetry / health / operation 最新狀態',
  })
  async getSnapshot(@Query() query: VehicleRealtimeQueryDto) {
    return this.vehicleService.getRealtimeSnapshot(query);
  }
}
