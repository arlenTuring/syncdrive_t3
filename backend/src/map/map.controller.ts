import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MapService } from './map.service';

@ApiTags('Map')
@Controller('syncdrive-api/map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get()
  @ApiOperation({ summary: '列出已發佈地圖 ID' })
  listMaps() {
    return { maps: this.mapService.listPublishedMapIds() };
  }

  @Get(':mapId/operation-nodes')
  @ApiOperation({
    summary: '擷取地圖營運節點（DockingPoint operationNodeId + 參照場域座標）',
  })
  getOperationNodes(@Param('mapId') mapId: string) {
    return this.mapService.getOperationNodes(mapId);
  }
}
