import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { type AuthenticatedRequest, RequirePermission } from '../access-control/access.guard';
import { DataAdminService, type ExecuteAdminQuery } from './data-admin.service';
import { LiveDataResetService } from './live-data-reset.service';

@Controller('syncdrive-api/data-admin')
@RequirePermission('system.data-admin.view')
export class DataAdminController {
  constructor(
    private readonly service: DataAdminService,
    private readonly liveReset: LiveDataResetService,
  ) {}

  @Get('metadata')
  metadata() {
    return this.service.metadata();
  }

  @Get('sample')
  sample(
    @Query('schema') schema = 'public',
    @Query('table') table: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.sample(schema, table, Number(limit ?? 20));
  }

  @Get('previews/order-cleanup')
  orderCleanupPreview() {
    return this.service.orderCleanupPreview();
  }

  @Post('execute')
  @RequirePermission('system.data-admin.execute')
  execute(@Body() body: ExecuteAdminQuery, @Req() request: AuthenticatedRequest) {
    return this.service.execute(body, {
      operatorId: request.authUser!.id,
      sourceIp: request.ip,
    });
  }

  @Post('executions/:requestId/cancel')
  @RequirePermission('system.data-admin.execute')
  cancel(@Param('requestId') requestId: string) {
    return this.service.cancel(requestId);
  }

  @Get('live-reset/preview')
  liveResetPreview() {
    return this.liveReset.preview();
  }

  @Post('live-reset/execute')
  @RequirePermission('system.data-admin.execute')
  liveResetExecute(@Body() body: { vehicleCodes: string[] }) {
    return this.liveReset.execute(body.vehicleCodes);
  }

  @Post('live-reset/resume')
  @RequirePermission('system.data-admin.execute')
  liveResetResume(@Body() body: { vehicleCodes: string[] }) {
    return this.liveReset.resume(body.vehicleCodes);
  }
}
