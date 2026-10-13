import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../access-control/access.guard';
import {
  MapVehicleSettingsService,
  type MapVehicleSetting,
} from './map-vehicle-settings.service';
import {
  VehicleDefinitionService,
  type VehicleDefinitionPayload,
} from './vehicle-definition.service';

/**
 * 車輛外觀模型 API（圖資管理 → 車輛模型）。
 *
 * 模型掛在 <code>syncdrive-api/vehicle-definitions</code>；地圖用哪個模型、畫多大掛在
 * <code>syncdrive-api/map-vehicle-settings</code>。模型是外觀資產，不碰車輛 ID、通訊設定或設備主檔。
 */
@ApiTags('Vehicle Definitions')
@Controller('syncdrive-api/vehicle-definitions')
@RequirePermission('site.map.view', 'vehicle.registry.view', 'vehicle.realtime.view')
export class VehicleDefinitionController {
  constructor(private readonly service: VehicleDefinitionService) {}

  @Get()
  @ApiOperation({ summary: '車輛模型清單' })
  async list() {
    return this.service.list();
  }

  @Get(':definitionKey')
  @ApiOperation({ summary: '單一車輛模型' })
  async findOne(@Param('definitionKey') definitionKey: string) {
    return this.service.findOne(definitionKey);
  }

  @Get(':definitionKey/references')
  @ApiOperation({ summary: '哪些地圖、儀表板元件、預設設定正在使用這個模型' })
  async references(@Param('definitionKey') definitionKey: string) {
    return this.service.references(definitionKey);
  }

  @Put(':definitionKey')
  @RequirePermission('site.map.edit', 'vehicle.registry.edit')
  @ApiOperation({
    summary: '新增或修改一個模型（修改要帶 baseVersion；版本不符回 409，不覆蓋）',
  })
  async upsert(
    @Param('definitionKey') definitionKey: string,
    @Body() body: { item?: VehicleDefinitionPayload; baseVersion?: number | null },
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.upsert(
      definitionKey,
      body?.item as VehicleDefinitionPayload,
      body?.baseVersion ?? null,
      operator,
    );
  }

  @Delete(':definitionKey')
  @RequirePermission('site.map.edit', 'vehicle.registry.delete')
  @ApiOperation({ summary: '刪除模型（仍被引用時拒絕）' })
  async remove(@Param('definitionKey') definitionKey: string) {
    return this.service.remove(definitionKey);
  }
}

@ApiTags('Vehicle Definitions')
@Controller('syncdrive-api/map-vehicle-settings')
@RequirePermission('site.map.view', 'vehicle.realtime.view')
export class MapVehicleSettingsController {
  constructor(private readonly service: MapVehicleSettingsService) {}

  @Get()
  @ApiOperation({ summary: '各地圖的車輛模型設定與系統預設模型' })
  list() {
    return this.service.list();
  }

  @Put()
  @RequirePermission('site.map.edit')
  @ApiOperation({
    summary: '設定系統預設車輛模型與顯示尺寸（地圖沒有自己的設定時使用；defaultSetting=null 清除）',
  })
  setDefault(
    @Body() body: { defaultSetting?: Partial<MapVehicleSetting> | null },
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.setDefault(body?.defaultSetting ?? null, operator);
  }

  @Get('migrations')
  @ApiOperation({ summary: '車輛模型設定遷移紀錄' })
  migrations() {
    return this.service.listMigrations();
  }

  @Post('migrations')
  @RequirePermission('site.map.import')
  @ApiOperation({
    summary: '把儀表板載具容器的模型與尺寸搬成地圖設定（dry_run=1 只產生報告）',
  })
  migrate(
    @Query('dry_run') dryRun?: string,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.migrateFromDashboards(dryRun === '1' || dryRun === 'true', operator);
  }

  @Post('migrations/:migrationId/rollback')
  @RequirePermission('site.map.import')
  @ApiOperation({ summary: '回復一次遷移（只刪除遷移後沒被改過的設定）' })
  rollback(
    @Param('migrationId') migrationId: string,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.rollbackMigration(migrationId, operator);
  }

  @Get(':mapId')
  @ApiOperation({ summary: '解析某張地圖要用的車輛模型與顯示設定' })
  resolve(@Param('mapId') mapId: string) {
    return this.service.resolve(mapId);
  }

  @Put(':mapId')
  @RequirePermission('site.map.edit')
  @ApiOperation({ summary: '設定某張地圖的車輛模型與顯示尺寸' })
  put(
    @Param('mapId') mapId: string,
    @Body() body: Partial<MapVehicleSetting>,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.putSetting(mapId, body, operator);
  }

  @Delete(':mapId')
  @RequirePermission('site.map.edit')
  @ApiOperation({ summary: '移除某張地圖的車輛模型設定（改用系統預設）' })
  remove(@Param('mapId') mapId: string) {
    return this.service.deleteSetting(mapId);
  }
}
