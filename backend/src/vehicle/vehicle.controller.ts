import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RedisService } from '../redis/redis.service';
import { VTMS_VEHICLE_CODES } from '../common/vehicle-codes';

@ApiTags('vehicles')
@Controller('syncdrive-api/vehicles')
export class VehicleController {
  constructor(private readonly redisService: RedisService) {}

  /**
   * 規格書 §即時資料顯示介面
   * 前端頁面載入時呼叫此 API，一次取得所有車輛目前的最新狀態快照。
   * 資料來源為 Redis 快取，避免地圖畫面在 WebSocket 建立前出現空白。
   *
   * GET /syncdrive-api/vehicles/snapshot
   */
  @Get('snapshot')
  @ApiOperation({ summary: '取得所有車輛當前狀態快照 (Cold Start Snapshot)' })
  @ApiResponse({
    status: 200,
    description: '回傳所有車輛的 telemetry / health / operation 最新狀態',
  })
  async getSnapshot() {
    const vehicleCodes = [...VTMS_VEHICLE_CODES];

    const snapshot =
      await this.redisService.getAllVehiclesSnapshot(vehicleCodes);
    return {
      timestamp: new Date().getTime(),
      count: vehicleCodes.length,
      vehicles: snapshot,
    };
  }
}
