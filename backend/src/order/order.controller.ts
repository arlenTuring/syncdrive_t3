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

