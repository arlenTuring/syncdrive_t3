import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { type AuthenticatedRequest, RequirePermission } from '../access-control/access.guard';
import { DataAdminService, type ExecuteAdminQuery } from './data-admin.service';
import { LiveDataResetService } from './live-data-reset.service';
import { DataRetentionService } from './data-retention.service';

@Controller('syncdrive-api/data-admin')
@RequirePermission('system.data-admin.view')
export class DataAdminController {
  constructor(
    private readonly service: DataAdminService,
    private readonly liveReset: LiveDataResetService,
    private readonly retention: DataRetentionService,
  ) {}

  @Get('retention/categories')
  retentionCategories() { return this.retention.categories(); }

  @Get('retention/overview')
  retentionOverview() { return this.retention.overview(); }

  @Get('retention/policies')
  retentionPolicies() { return this.retention.policies(); }

  @Post('cleanup/preview')
  @RequirePermission('system.data-admin.cleanup')
  cleanupPreview(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.retention.preview(body, request.authUser!.id);
  }

  @Post('cleanup/plans/:planId/execute')
  @RequirePermission('system.data-admin.cleanup')
  cleanupExecute(@Param('planId') planId: string, @Req() request: AuthenticatedRequest) {
    return this.retention.execute(planId, request.authUser!.id);
  }

  @Get('cleanup/jobs')
  cleanupJobs(@Query('limit') limit?: string) { return this.retention.jobs(Number(limit ?? 50)); }

  @Post('cleanup/jobs/:jobId/stop')
  @RequirePermission('system.data-admin.cleanup')
  cleanupStop(@Param('jobId') jobId: string) { return this.retention.stop(jobId); }

  @Post('retention/policies/:category/preview')
  @RequirePermission('system.data-admin.policy')
  policyPreview(@Param('category') category: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.retention.previewPolicy(category, body, request.authUser!.id);
  }

  @Put('retention/policies/:category')
  @RequirePermission('system.data-admin.policy')
  policySave(@Param('category') category: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.retention.savePolicy(category, body, request.authUser!.id);
  }

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
