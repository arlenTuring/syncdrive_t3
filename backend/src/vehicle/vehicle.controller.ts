import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VehicleService } from './vehicle.service';
import { RequirePermission } from '../access-control/access.guard';
import { VehicleRealtimeQueryDto } from './dto/vehicle-realtime-query.dto';
import { CreateVehicleDto, UpdateVehicleDto, UpdateVehicleServiceDto, VehicleIdDto, VehicleIdentityAvailabilityDto, VehicleRegistrationQueryDto } from './dto/vehicle-registration.dto';
import { AuditService } from '../audit/audit.service';
import { ActionResult, OperatorActionType } from '../database/entities/operator-action-log.entity';
import type { AuthenticatedRequest } from '../access-control/access.guard';

@ApiTags('vehicles')
@Controller('syncdrive-api/vehicles')
@RequirePermission('vehicle.realtime.view', 'site.map.view', 'dashboard.monitor.view')
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly audit: AuditService,
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

  @Get('registry')
  @RequirePermission('vehicle.registry.view')
  @ApiOperation({ summary: '載具註冊清單' })
  registry(@Query() query: VehicleRegistrationQueryDto) {
    return this.vehicleService.getRegistrationList(query);
  }

  @Get('registry/identity-availability')
  @RequirePermission('vehicle.registry.create')
  @ApiOperation({ summary: '檢查載具通訊身分是否可用' })
  identityAvailability(@Query() query: VehicleIdentityAvailabilityDto) {
    return this.vehicleService.identityAvailability(query.value);
  }

  @Post('registry')
  @RequirePermission('vehicle.registry.create')
  @ApiOperation({ summary: '完成載具註冊並分配穩定通訊身分' })
  async createRegistry(@Body() body: CreateVehicleDto, @Req() request: AuthenticatedRequest) {
    const result = await this.vehicleService.createRegistration(body);
    await this.audit.write({
      operatorId: request.authUser?.id,
      sourceIp: request.ip || request.socket.remoteAddress,
      actionType: OperatorActionType.VEHICLE_REGISTER,
      targetVehicle: result.vehicleCode,
      actionDetail: { displayName: result.displayName, initialMileageKm: result.initialMileageKm },
      result: ActionResult.SUCCESS,
    });
    return result;
  }

  @Get('registry/:id')
  @RequirePermission('vehicle.registry.view')
  @ApiOperation({ summary: '載具註冊詳情與串接資訊' })
  registryDetail(@Param() params: VehicleIdDto) {
    return this.vehicleService.getRegistration(params.id);
  }

  @Patch('registry/:id')
  @RequirePermission('vehicle.registry.edit')
  @ApiOperation({ summary: '編輯載具名稱與里程基準' })
  async updateRegistry(@Param() params: VehicleIdDto, @Body() body: UpdateVehicleDto, @Req() request: AuthenticatedRequest) {
    const result = await this.vehicleService.updateRegistration(params.id, body);
    await this.audit.write({
      operatorId: request.authUser?.id,
      sourceIp: request.ip || request.socket.remoteAddress,
      actionType: OperatorActionType.VEHICLE_UPDATE,
      targetVehicle: result.vehicleCode,
      actionDetail: { displayName: result.displayName, initialMileageKm: result.initialMileageKm, version: result.version },
      result: ActionResult.SUCCESS,
    });
    return result;
  }

  @Patch('registry/:id/service')
  @RequirePermission('vehicle.registry.service-scope')
  @ApiOperation({ summary: '設定是否允許派發新任務' })
  async updateService(@Param() params: VehicleIdDto, @Body() body: UpdateVehicleServiceDto, @Req() request: AuthenticatedRequest) {
    const result = await this.vehicleService.updateServiceSetting(params.id, body);
    await this.audit.write({
      operatorId: request.authUser?.id,
      sourceIp: request.ip || request.socket.remoteAddress,
      actionType: OperatorActionType.VEHICLE_SERVICE_SETTING,
      targetVehicle: result.vehicleCode,
      actionDetail: { serviceEnabled: result.serviceEnabled, version: result.version },
      result: ActionResult.SUCCESS,
    });
    return result;
  }

  @Delete('registry/:id')
  @RequirePermission('vehicle.registry.delete')
  @ApiOperation({ summary: '移除載具並撤銷其外部存取' })
  async removeRegistry(@Param() params: VehicleIdDto, @Req() request: AuthenticatedRequest) {
    const result = await this.vehicleService.removeRegistration(params.id);
    await this.audit.write({
      operatorId: request.authUser?.id,
      sourceIp: request.ip || request.socket.remoteAddress,
      actionType: OperatorActionType.VEHICLE_REMOVE,
      targetVehicle: result.vehicleCode,
      actionDetail: { displayName: result.displayName, credentialsRevoked: true },
      result: ActionResult.SUCCESS,
    });
    return result;
  }
}
