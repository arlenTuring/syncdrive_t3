import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DashboardPlaneService,
  type DashboardPlanePayload,
  type ModuleDashboardPagePayload,
} from './dashboard-plane.service';

/**
 * 營運全景圖台 API（TP13C §1.4 介面資源）。
 *
 * 版面與模組頁面對應放在同一個控制器：兩者是同一件事的兩面——版面是內容，
 * 對應是「哪個模組要開哪一份版面」，前端也總是一起讀。
 */
@ApiTags('Dashboard Planes')
@Controller('syncdrive-api/dashboard')
export class DashboardPlaneController {
  constructor(private readonly service: DashboardPlaneService) {}

  @Get('planes')
  @ApiOperation({ summary: '圖台版面清單' })
  async listPlanes() {
    return this.service.listPlanes();
  }

  @Get('planes/:planeId')
  @ApiOperation({ summary: '單一圖台版面' })
  async findPlane(@Param('planeId') planeId: string) {
    return this.service.findPlane(planeId);
  }

  @Put('planes')
  @ApiOperation({ summary: '整批覆寫圖台版面（送進來的清單即為完整結果）' })
  async replacePlanes(
    @Body() body: { items?: DashboardPlanePayload[]; updatedBy?: string },
  ) {
    return this.service.replacePlanes(body?.items ?? [], body?.updatedBy);
  }

  @Put('planes/:planeId')
  @ApiOperation({ summary: '新增或更新單一圖台版面（不刪除其他版面）' })
  async savePlane(
    @Param('planeId') planeId: string,
    @Body() body: Omit<DashboardPlanePayload, 'planeId'>,
  ) {
    return this.service.savePlane({ ...body, planeId });
  }

  @Get('module-pages')
  @ApiOperation({ summary: '模組與版面對應清單' })
  async listPages(@Query('module_id') moduleId?: string) {
    return this.service.listPages(moduleId);
  }

  @Put('module-pages')
  @ApiOperation({ summary: '整批覆寫模組與版面對應' })
  async replacePages(
    @Body() body: { items?: ModuleDashboardPagePayload[]; updatedBy?: string },
  ) {
    return this.service.replacePages(body?.items ?? [], body?.updatedBy);
  }
}
