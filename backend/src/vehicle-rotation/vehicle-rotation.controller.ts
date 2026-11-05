import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedRequest, RequirePermission } from '../access-control/access.guard';
import { AuditAction } from '../audit/audit-action.decorator';
import { VehicleRotationService } from './vehicle-rotation.service';

const actor = (request: AuthenticatedRequest) => request.authUser?.display_name ?? request.authUser?.id ?? '系統';

@ApiTags('車輛輪替')
@Controller('syncdrive-api/vehicle-rotation')
@RequirePermission('operations.dispatch.view')
export class VehicleRotationController {
  constructor(private readonly service: VehicleRotationService) {}

  @Get('today')
  @ApiOperation({ summary: '今日輪替報告與監看進度' })
  today() {
    return this.service.today();
  }

  @Get('vehicles')
  @ApiOperation({ summary: '車輛清單：里程、運營狀態與車輛設定' })
  vehicles() {
    return this.service.vehicles();
  }

  @Get('records')
  @ApiOperation({ summary: '輪替紀錄' })
  records() {
    return this.service.records();
  }

  @AuditAction('VEHICLE_ROTATION_RULES')
  @Put('rules')
  @RequirePermission('operations.dispatch.edit')
  @ApiOperation({ summary: '部署輪替規則' })
  deploy(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.service.deployRules(body, actor(request));
  }

  @AuditAction('VEHICLE_ROTATION_GENERATE')
  @Post('report/generate')
  @RequirePermission('operations.dispatch.edit')
  @ApiOperation({ summary: '立刻產出或重排報告', description: '不帶 day 時是目前營運日。已確認的項目不會變動。' })
  async generate(@Body() body: { day?: string }) {
    await this.service.generate(body?.day);
    return { ok: true };
  }

  @AuditAction('VEHICLE_ROTATION_CONFIRM', { param: 'id' })
  @Post('items/:id/confirm')
  @RequirePermission('operations.dispatch.edit')
  @ApiOperation({ summary: '確認輪替', description: '確認後派遣計畫會加上調車、取消被換車最後一段，下一營運日起兩台車對調列。' })
  async confirm(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.service.confirm(id, actor(request));
    return { ok: true };
  }

  @AuditAction('VEHICLE_ROTATION_SKIP', { param: 'id' })
  @Post('items/:id/skip')
  @RequirePermission('operations.dispatch.edit')
  @ApiOperation({ summary: '今天略過這筆輪替' })
  async skip(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.service.skip(id, actor(request));
    return { ok: true };
  }

  @AuditAction('VEHICLE_ROTATION_HOLD', { param: 'code' })
  @Put('vehicles/:code/hold')
  @RequirePermission('operations.dispatch.edit')
  @ApiOperation({ summary: '設定車輛可輪替、保留或大保養' })
  async setHold(@Param('code') code: string, @Body() body: { hold?: unknown }, @Req() request: AuthenticatedRequest) {
    await this.service.setHold(code, body?.hold, actor(request));
    return { ok: true };
  }
}
