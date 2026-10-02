import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DataAdminGuard } from './data-admin.guard';
import { DataAdminService, type ExecuteAdminQuery } from './data-admin.service';

@Controller('syncdrive-api/data-admin')
@UseGuards(DataAdminGuard)
export class DataAdminController {
  constructor(private readonly service: DataAdminService) {}

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
}
