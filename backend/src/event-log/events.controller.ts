import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission, type AuthenticatedRequest } from '../access-control/access.guard';
import { AuditService } from '../audit/audit.service';
import { auditActor } from '../audit/audit-action.decorator';
import { ActionResult } from '../database/entities/operator-action-log.entity';
import { exportFileName } from './csv';
import { EventsService } from './events.service';

/** 事件管理模組：事件資訊清單、歷史事件、事件報表、回放與影像。固定路由放在 :id 之前。 */
@ApiTags('Events')
@Controller('syncdrive-api/events')
@RequirePermission('events.events.view')
export class EventsController {
  constructor(private readonly events: EventsService, private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: '事件查詢（即時清單與歷史共用；from/to 為 epoch 毫秒，起點含、終點不含）' })
  list(@Query() query: Record<string, unknown>) {
    return this.events.list(query);
  }

  @Get('options')
  @ApiOperation({ summary: '篩選選項：歷史出現過的載具（含已刪除）、事件類型、嚴重度、來源' })
  options() {
    return this.events.options();
  }

  @Get('export')
  @RequirePermission('events.events.export')
  @ApiOperation({ summary: '事件報表 CSV（目前條件，最多 1,000 筆；標頭 X-Total-Count／X-Exported-Count）' })
  async export(@Query() query: Record<string, unknown>, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.events.exportCsv(query);
    await this.audit.record({
      ...auditActor(req),
      actionType: 'EVENT_EXPORT',
      targetType: 'EVENT',
      actionDetail: { filters: query, total: result.total, exported: result.exported },
      result: ActionResult.SUCCESS,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName('events', result.timeZone)}"`);
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Exported-Count', String(result.exported));
    res.setHeader('X-Export-Sort', result.sort);
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Exported-Count, X-Export-Sort, Content-Disposition');
    res.send(result.csv);
  }

  @Get(':id')
  @ApiOperation({ summary: '事件詳情（中心端內部 ID）' })
  detail(@Param('id') id: string) {
    return this.events.detail(id);
  }

  @Post(':id/acknowledgement')
  @RequirePermission('events.events.manage')
  @ApiOperation({ summary: '人工確認事件（只記錄中心端確認，不下發車控、不代表故障解除）' })
  acknowledge(@Param('id') id: string, @Body() body: { note?: unknown } | undefined, @Req() req: AuthenticatedRequest) {
    if (!req.authUser) throw new ForbiddenException('權限不足');
    const unknownKeys = Object.keys(body ?? {}).filter((key) => key !== 'note');
    if (unknownKeys.length) throw new ForbiddenException(`不接受的欄位：${unknownKeys.join('、')}`);
    return this.events.acknowledge(id, body?.note, req.authUser, { ip: req.ip, userAgent: req.header('user-agent') ?? null });
  }

  @Get(':id/playback')
  @ApiOperation({ summary: '事件回放時間窗（前 30 秒至後 30 秒）與目標載具；軌跡需另有運行紀錄檢視權限' })
  async playback(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const result = await this.events.playback(id);
    const permissions = req.authUser?.permissions ?? [];
    return {
      ...result,
      permissions: { trajectory: permissions.includes('vehicle.log.view'), video: permissions.includes('events.video.view') },
    };
  }
}
