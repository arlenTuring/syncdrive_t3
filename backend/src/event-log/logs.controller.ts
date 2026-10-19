import { Controller, ForbiddenException, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission, type AuthenticatedRequest } from '../access-control/access.guard';
import { auditActor } from '../audit/audit-action.decorator';
import { AuditService } from '../audit/audit.service';
import { ActionResult } from '../database/entities/operator-action-log.entity';
import { exportFileName } from './csv';
import { LogsService } from './logs.service';

const VIEW = ['logs.system.view', 'logs.permissions.view', 'logs.operations.view', 'logs.authentication.view'];

/**
 * 日誌管理模組：系統操作紀錄、權限異動查詢、營運操作紀錄、登入登出紀錄。唯讀，沒有修改或刪除 API。
 * 類別級守衛只確認「至少能看一類」；每個請求再檢查該類別自己的 view／export 權限。
 */
@ApiTags('Logs')
@Controller('syncdrive-api/logs')
@RequirePermission(...VIEW)
export class LogsController {
  constructor(private readonly logs: LogsService, private readonly audit: AuditService) {}

  private require(req: AuthenticatedRequest, category: string, action: 'view' | 'export') {
    const cat = this.logs.category(category);
    if (!req.authUser?.permissions.includes(`logs.${cat}.${action}`)) throw new ForbiddenException('權限不足');
    return cat;
  }

  @Get('options')
  @ApiOperation({ summary: '篩選選項（帳號含已刪除、角色、操作類型）' })
  options() {
    return this.logs.options();
  }

  @Get(':category')
  @ApiOperation({ summary: '日誌查詢（category：system／permissions／operations／authentication）' })
  list(@Param('category') category: string, @Query() query: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.logs.list(this.require(req, category, 'view'), query);
  }

  @Get(':category/export')
  @ApiOperation({ summary: '日誌 CSV（目前條件，最多 1,000 筆；標頭 X-Total-Count／X-Exported-Count）' })
  async export(@Param('category') category: string, @Query() query: Record<string, unknown>, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const cat = this.require(req, category, 'export');
    const result = await this.logs.exportCsv(cat, query);
    await this.audit.record({
      ...auditActor(req),
      actionType: 'LOG_EXPORT',
      targetType: 'LOG',
      targetId: cat,
      actionDetail: { filters: query, total: result.total, exported: result.exported },
      result: ActionResult.SUCCESS,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(`logs-${cat}`, result.timeZone)}"`);
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Exported-Count', String(result.exported));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Exported-Count, Content-Disposition');
    res.send(result.csv);
  }

  @Get(':category/:id')
  @ApiOperation({ summary: '日誌詳情（已脫敏）' })
  detail(@Param('category') category: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.logs.detail(this.require(req, category, 'view'), id);
  }
}
