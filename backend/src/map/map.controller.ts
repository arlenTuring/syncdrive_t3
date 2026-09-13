import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MapService } from './map.service';

class PublishMapLibraryDto {
  libraryId?: string;
  displayName?: string;
  version?: string;
  updatedAt?: string;
  mapDocument!: Record<string, unknown>;
}

class SetActiveMapLibraryDto {
  mapId!: string;
  libraryId?: string;
  displayName?: string;
  version?: string;
  updatedAt?: string;
  mapDocument?: Record<string, unknown>;
}

@ApiTags('Map')
@Controller('syncdrive-api/map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get()
  @ApiOperation({ summary: '列出已發佈地圖 ID' })
  listMaps() {
    return { maps: this.mapService.listPublishedMapIds() };
  }

  @Get('library')
  @ApiOperation({ summary: '地圖庫：已發佈至後端的場域地圖清單（含路線數）' })
  listMapLibrary() {
    return this.mapService.listPublishedMapLibrary();
  }

  @Get('library/active')
  @ApiOperation({ summary: '地圖庫：目前使用中地圖的完整 JSON（模擬器／其他服務用）' })
  getActiveMapLibraryDocument() {
    return this.mapService.getActivePublishedMapLibrary();
  }

  @Put('library/active')
  @ApiOperation({ summary: '地圖庫：設為當前使用地圖（可同時發佈最新內容）' })
  @ApiHeader({
    name: 'X-Sync-Internal-Token',
    description: '內部發佈權杖（預設開發用 sync-dev-internal）',
    required: true,
  })
  setActiveMapLibrary(
    @Body() body: SetActiveMapLibraryDto,
    @Headers('x-sync-internal-token') token?: string,
  ) {
    this.mapService.assertInternalPublishToken(token);
    return this.mapService.setActiveMapLibrary(body);
  }

  @Get('library/:mapId')
  @ApiOperation({ summary: '地圖庫：依 mapId 取得完整 JSON' })
  getMapLibraryDocument(@Param('mapId') mapId: string) {
    return this.mapService.getPublishedMapLibrary(mapId);
  }

  @Put('library/:mapId')
  @ApiOperation({ summary: '地圖庫：發佈／更新地圖（地圖編輯器儲存時同步）' })
  @ApiHeader({
    name: 'X-Sync-Internal-Token',
    description: '內部發佈權杖（預設開發用 sync-dev-internal）',
    required: true,
  })
  publishMapLibrary(
    @Param('mapId') mapId: string,
    @Body() body: PublishMapLibraryDto,
    @Headers('x-sync-internal-token') token?: string,
  ) {
    this.mapService.assertInternalPublishToken(token);
    return this.mapService.publishMapLibrary(mapId, body);
  }

  @Delete('library/:mapId')
  @ApiOperation({ summary: '地圖庫：刪除已發佈的地圖（使用中的不給刪）' })
  @ApiHeader({
    name: 'X-Sync-Internal-Token',
    description: '內部發佈權杖（預設開發用 sync-dev-internal）',
    required: true,
  })
  deleteMapLibrary(
    @Param('mapId') mapId: string,
    @Headers('x-sync-internal-token') token?: string,
  ) {
    this.mapService.assertInternalPublishToken(token);
    return this.mapService.deleteMapLibrary(mapId);
  }

  @Get(':mapId/stations/:stationId')
  @ApiOperation({ summary: '查詢單一站點座標（依 stationId）' })
  getStation(
    @Param('mapId') mapId: string,
    @Param('stationId') stationId: string,
  ) {
    return this.mapService.getStation(mapId, stationId);
  }

  @Get(':mapId/operation-nodes')
  @ApiOperation({
    summary: '擷取地圖停靠站點（stationId + 別名 + 場域座標）',
  })
  getOperationNodes(@Param('mapId') mapId: string) {
    return this.mapService.getOperationNodes(mapId);
  }

  @Get(':mapId/field-equipment')
  @ApiOperation({
    summary:
      '擷取地圖場域物件（設備：紅綠燈／智慧桿／月台門；設施：充電格等大型區塊）',
  })
  getFieldEquipment(
    @Param('mapId') mapId: string,
    @Query('kind') kind?: string,
  ) {
    const allowed = new Set([
      'charging',
      'signal',
      'smart_pole',
      'platform_door',
      'car_wash',
      'maintenance',
      'yard_slot',
      'equipment',
      'facility',
      'all',
    ]);
    const resolved = allowed.has(kind ?? '') ? kind! : 'all';
    return this.mapService.getFieldEquipment(
      mapId,
      resolved as
        | 'charging'
        | 'signal'
        | 'smart_pole'
        | 'platform_door'
        | 'car_wash'
        | 'maintenance'
        | 'yard_slot'
        | 'equipment'
        | 'facility'
        | 'all',
    );
  }

  @Get(':mapId/waypoints')
  @ApiOperation({ summary: '擷取地圖途經點（Waypoint 代號）' })
  getWaypoints(@Param('mapId') mapId: string) {
    return this.mapService.getWaypoints(mapId);
  }
}
