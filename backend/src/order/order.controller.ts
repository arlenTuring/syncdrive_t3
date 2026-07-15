import { Controller, Post, Get, Put, Body, Query, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrderService } from './order.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';
import { OperatorActionType, ActionResult } from '../database/entities/operator-action-log.entity';

@ApiTags('Operation Orders')
@Controller('syncdrive-api/order')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly auditService: AuditService,
  ) {}

  @Post('save')
  @ApiOperation({ summary: '建立新營運訂單（含 route_id → 站點動作實例化）' })
  async saveOrder(@Body() createOrderDto: Record<string, unknown>, @Req() req: Request) {
    const result = await this.orderService.createOrder(createOrderDto as Parameters<OrderService['createOrder']>[0]);

    await this.auditService.write({
      sourceIp: req.ip,
      actionType: OperatorActionType.ORDER_CREATE,
      targetVehicle: String(createOrderDto.vehicle_code ?? ''),
      actionDetail: {
        order_id: result.id,
        trip_code: result.tripCode,
        route_id: result.routeId,
        priority_level: result.priorityLevel,
      },
      result: ActionResult.SUCCESS,
    });

    return result;
  }

  @Get('list')
  @ApiOperation({ summary: '班次運行紀錄列表（分頁、篩選）' })
  async listOrders(
    @Query('tab') tab?: string,
    @Query('keyword') keyword?: string,
    @Query('execution_status') execution_status?: string,
    @Query('vehicle_code') vehicle_code?: string,
    @Query('planned_start_from') planned_start_from?: string,
    @Query('planned_start_to') planned_start_to?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
  ) {
    return this.orderService.listOrders({
      tab: tab === 'maintenance' ? 'maintenance' : 'mainline',
      keyword,
      execution_status: execution_status as
        | 'pending'
        | 'running'
        | 'delayed'
        | 'faulted'
        | 'completed'
        | 'all'
        | undefined,
      vehicle_code,
      planned_start_from,
      planned_start_to,
      page: page ? Number(page) : undefined,
      page_size: page_size ? Number(page_size) : undefined,
    });
  }

  @Get('detail')
  @ApiOperation({ summary: '班次運行紀錄詳情（含站點動作與 task_group）' })
  async orderDetail(@Query('id') id: string) {
    return this.orderService.getOrderDetail(id);
  }

  @Get('queryById')
  @ApiOperation({ summary: '查詢訂單內容' })
  async queryOrder(@Query('id') id: string) {
    return this.orderService.getOrderById(id);
  }

  @Put('updateOrderProgress/:id')
  @ApiOperation({ summary: '更新訂單狀態 (SSOT)' })
  async updateOrderProgress(
    @Param('id') id: string,
    @Query('status') status: string,
    @Req() req: Request,
  ) {
    const result = await this.orderService.updateOrderStatus(id, status);

    await this.auditService.write({
      sourceIp: req.ip,
      actionType: OperatorActionType.ORDER_UPDATE,
      targetVehicle: result.vehicleCode,
      actionDetail: { order_id: id, new_status: status },
      result: ActionResult.SUCCESS,
    });

    return result;
  }

  @Put('action/:actionId')
  @ApiOperation({ summary: '車端以 action_id 回報站點動作狀態' })
  async updateActionStatus(
    @Param('actionId') actionId: string,
    @Body() body: { status: string; note?: string; actual_start_time?: number; actual_end_time?: number },
    @Req() req: Request,
  ) {
    const result = await this.orderService.updateActionStatus(actionId, body);

    await this.auditService.write({
      sourceIp: req.ip,
      actionType: OperatorActionType.ORDER_UPDATE,
      targetVehicle: actionId,
      actionDetail: { action_id: actionId, status: body.status },
      result: ActionResult.SUCCESS,
    });

    return result;
  }
}

