import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MapService } from '../map/map.service';
import { MapActivationService } from './map-activation.service';

class ActivateMapDto {
  libraryId?: string;
  displayName?: string;
  version?: string;
  updatedAt?: string;
  mapDocument?: Record<string, unknown>;
}

@ApiTags('Map')
@Controller('syncdrive-api/map-activation')
export class MapActivationController {
  constructor(
    private readonly activation: MapActivationService,
    private readonly mapService: MapService,
  ) {}

  @Get(':mapId/check')
  @ApiOperation({
    summary: '設為主要地圖前的檢查：部署中的班表在這張地圖上接不接得上',
  })
  check(@Param('mapId') mapId: string) {
    return this.activation.check(mapId);
  }

  @Post(':mapId')
  @ApiOperation({ summary: '設為主要地圖（檢查不過回 409，附檢查結果）' })
  @ApiHeader({
    name: 'X-Sync-Internal-Token',
    description: '內部發佈權杖（預設開發用 sync-dev-internal）',
    required: true,
  })
  activate(
    @Param('mapId') mapId: string,
    @Body() body: ActivateMapDto,
    @Headers('x-sync-internal-token') token?: string,
  ) {
    this.mapService.assertInternalPublishToken(token);
    return this.activation.activate(mapId, body);
  }
}
