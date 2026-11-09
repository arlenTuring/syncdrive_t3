import { Body, Controller, ForbiddenException, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, type AuthenticatedRequest } from '../access-control/access.guard';
import { EventTypesService } from './event-types.service';

/** 事件類型管理：代碼、名稱、嚴重等級與建議處置 SOP */
@ApiTags('Events')
@Controller('syncdrive-api/event-types')
@RequirePermission('events.events.view')
export class EventTypesController {
  constructor(private readonly types: EventTypesService) {}

  @Get()
  @ApiOperation({ summary: '事件類型清單（依顯示順序）' })
  async list() {
    return { items: await this.types.list() };
  }

  @Put()
  @RequirePermission('events.events.manage')
  @ApiOperation({ summary: '整份取代事件類型清單（對話框按「儲存」時送出）' })
  async replace(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!req.authUser) throw new ForbiddenException('權限不足');
    return { items: await this.types.replace(body, req.authUser, { ip: req.ip, userAgent: req.header('user-agent') ?? null }) };
  }
}
