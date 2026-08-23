import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  VehicleDefinitionService,
  type VehicleDefinitionPayload,
} from './vehicle-definition.service';

/**
 * 載具外觀定義 API（TP13C §1.4 主檔 · vehicle_definitions）。
 *
 * 路徑掛在 <code>syncdrive-api/vehicle-definitions</code>，與其他營運資源同一個
 * 前綴；載具定義是主檔資源，不是車輛即時資料，所以不併進 vehicles 之下。
 */
@ApiTags('Vehicle Definitions')
@Controller('syncdrive-api/vehicle-definitions')
export class VehicleDefinitionController {
  constructor(private readonly service: VehicleDefinitionService) {}

  @Get()
  @ApiOperation({ summary: '載具外觀定義清單' })
  async list() {
    return this.service.list();
  }

  @Get(':definitionKey')
  @ApiOperation({ summary: '單一載具外觀定義' })
  async findOne(@Param('definitionKey') definitionKey: string) {
    return this.service.findOne(definitionKey);
  }

  @Put()
  @ApiOperation({
    summary: '整批覆寫載具外觀定義（送進來的清單即為完整結果）',
  })
  async replaceAll(
    @Body() body: { items?: VehicleDefinitionPayload[]; updatedBy?: string },
  ) {
    return this.service.replaceAll(body?.items ?? [], body?.updatedBy);
  }
}
