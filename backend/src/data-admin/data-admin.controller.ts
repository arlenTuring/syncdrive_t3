import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DataAdminGuard } from './data-admin.guard';
import { DataAdminService, type ExecuteAdminQuery } from './data-admin.service';
import { LiveDataResetService } from './live-data-reset.service';

@Controller('syncdrive-api/data-admin')
@UseGuards(DataAdminGuard)
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
  execute(@Body() body: ExecuteAdminQuery, @Req() request: Request) {
    return this.service.execute(body, {
      operatorId: String(request.headers['x-syncdrive-operator'] ?? 'unknown'),
      sourceIp: request.ip,
    });
  }

  @Post('executions/:requestId/cancel')
  cancel(@Param('requestId') requestId: string) {
    return this.service.cancel(requestId);
  }

  @Get('live-reset/preview')
  liveResetPreview() {
    return this.liveReset.preview();
  }

  @Post('live-reset/execute')
  liveResetExecute(@Body() body: { vehicleCodes: string[] }) {
    return this.liveReset.execute(body.vehicleCodes);
  }

  @Post('live-reset/resume')
  liveResetResume(@Body() body: { vehicleCodes: string[] }) {
    return this.liveReset.resume(body.vehicleCodes);
  }
}
