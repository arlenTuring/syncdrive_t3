import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../access-control/access.guard';
import { auditActor } from '../audit/audit-action.decorator';
import { AuditService } from '../audit/audit.service';
import { ActionResult } from '../database/entities/operator-action-log.entity';
import { ScheduledOrderService } from './scheduled-order.service';

@Controller('syncdrive-api/order/schedule')
export class ScheduledOrderController {
  constructor(
    private readonly scheduledOrders: ScheduledOrderService,
    private readonly audit: AuditService,
  ) {}

  @Get('options')
  @RequirePermission('service.scheduled-orders.view')
  options() {
    return this.scheduledOrders.options();
  }

  @Get('calendar')
  @RequirePermission('service.scheduled-orders.view')
  calendar(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('vehicle_code') vehicleCode?: string,
    @Query('limit_per_group') limitPerGroup?: string,
  ) {
    return this.scheduledOrders.calendar(
      Number(from),
      Number(to),
      vehicleCode?.trim() || undefined,
      limitPerGroup == null ? 20 : Number(limitPerGroup),
    );
  }

  @Get('detail')
  @RequirePermission('service.scheduled-orders.view')
  detail(@Query('source') source: string, @Query('id') id: string) {
    return this.scheduledOrders.detail(
      source === 'schedule' || source === 'plan' ? source : 'order',
      id,
    );
  }

  @Get('records/options')
  @RequirePermission('service.order-records.view')
  recordOptions() {
    return this.scheduledOrders.recordOptions();
  }

  @Get('records')
  @RequirePermission('service.order-records.view')
  records(
    @Query('keyword') keyword?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicle_code') vehicleCode?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('sort_by') sortBy?: string,
    @Query('direction') direction?: string,
    @Query('snapshot') snapshot?: string,
  ) {
    return this.scheduledOrders.records({
      keyword,
      from: Number(from),
      to: Number(to),
      vehicleCode,
      category,
      page: Number(page),
      pageSize: Number(pageSize),
      sortBy,
      direction,
      snapshot: snapshot == null ? undefined : Number(snapshot),
    });
  }

  @Get('records/detail')
  @RequirePermission('service.order-records.view')
  recordDetail(@Query('id') id: string) {
    return this.scheduledOrders.detail('order', id);
  }

  @Post()
  @RequirePermission(
    'operations.dispatch.create',
    'service.scheduled-orders.create',
  )
  async create(
    @Body()
    body: {
      request_key?: string;
      display_name?: string;
      vehicle_code?: string;
      route_id?: string;
      planned_start?: number;
    },
    @Req() req: Request,
  ) {
    const actor = auditActor(req);
    const result = await this.scheduledOrders.create(body, actor.operatorId);
    await this.audit.write({
      ...actor,
      actionType: 'SCHEDULED_ORDER_CREATE',
      targetType: 'SCHEDULED_ORDER',
      targetId: result.schedule_id,
      targetName: result.display_name,
      targetVehicle: result.vehicle_code,
      correlationId: result.schedule_id,
      actionDetail: {
        route_id: result.route_id,
        planned_start: result.planned_start,
      },
      result: ActionResult.SUCCESS,
    });
    return result;
  }
}
