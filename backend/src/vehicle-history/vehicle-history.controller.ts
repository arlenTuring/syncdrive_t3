import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../access-control/access.guard';
import { VehicleHistoryService } from './vehicle-history.service';

/**
 * 運行管理紀錄回放 API（唯讀）。權限沿用「載具管理模組 → 運行管理紀錄 → 檢視」，
 * 不需要也不給降級運轉的權限。
 */
@ApiTags('運行管理紀錄')
@Controller('syncdrive-api/vehicle-history')
@RequirePermission('vehicle.log.view')
export class VehicleHistoryController {
  constructor(private readonly history: VehicleHistoryService) {}

  @Get('vehicles')
  @ApiOperation({ summary: '可調查的載具（已註冊，含停用）' })
  vehicles() {
    return this.history.listVehicles();
  }

  @Get('resolve/range')
  @ApiOperation({ summary: '調查載具＋時間區間：可回放範圍、該車紀錄數、錄製涵蓋' })
  resolveRange(@Query('vehicle_id') vehicleId: string, @Query('from') from: string, @Query('to') to: string, @Query('tz') tz?: string) {
    return this.history.resolveRange({ vehicle_id: vehicleId, from, to, tz });
  }

  @Get('resolve/shift')
  @ApiOperation({ summary: '班次唯一碼：那一次執行的實際範圍與實際載具（多台時需指定 vehicle_id）' })
  resolveShift(@Query('code') code: string, @Query('vehicle_id') vehicleId?: string) {
    return this.history.resolveShift(code, vehicleId);
  }

  @Get('snapshot')
  @ApiOperation({ summary: '游標當下各狀態來源的最後一筆（scope=vehicle 調查載具／background 背景）' })
  snapshot(@Query('vehicle_id') vehicleId: string, @Query('at') at: string, @Query('seq') seq?: string, @Query('scope') scope?: string) {
    return this.history.snapshot({ vehicle_id: vehicleId, scope, at, seq });
  }

  @Get('frames')
  @ApiOperation({ summary: '分段資料（先依範圍篩選再分頁），依 (收到時間, 序號) 排序，含下一段游標' })
  frames(
    @Query('vehicle_id') vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('after_t') afterT?: string,
    @Query('after_seq') afterSeq?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
  ) {
    return this.history.frames({ vehicle_id: vehicleId, scope, from, to, after_t: afterT, after_seq: afterSeq, limit });
  }

  @Get('neighbor')
  @ApiOperation({ summary: '調查載具在游標前一筆／後一筆自己的紀錄' })
  neighbor(
    @Query('vehicle_id') vehicleId: string,
    @Query('at') at: string,
    @Query('seq') seq: string | undefined,
    @Query('dir') dir: string,
    @Query('min') min?: string,
    @Query('max') max?: string,
  ) {
    return this.history.neighbor({ vehicle_id: vehicleId, at, seq, dir, min, max });
  }

  @Get('map')
  @ApiOperation({ summary: '當時的地圖快照（依內容雜湊）' })
  map(@Query('hash') hash: string) {
    return this.history.map(hash);
  }

  @Get('vehicle-events')
  @ApiOperation({ summary: '調查載具截至游標的事件與指令紀錄' })
  vehicleEvents(@Query('vehicle_id') vehicleId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.history.vehicleEvents({ vehicle_id: vehicleId, from, to });
  }
}
