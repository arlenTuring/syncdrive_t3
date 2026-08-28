import { BadRequestException, Controller, Post, Get, Put, Body, Query, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrderService } from './order.service';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ExternalApi } from '../common/external-api.decorator';
import { AuditService } from '../audit/audit.service';
import { OperatorActionType, ActionResult } from '../database/entities/operator-action-log.entity';

class UpdateActionStatusDto {
  @ApiProperty({
    description: '動作狀態',
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
  })
  @IsString()
  status!: string;

  @ApiPropertyOptional({ description: '卡關或失敗之原因' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '實際開始時刻，Epoch 毫秒' })
  @IsOptional()
  @IsNumber()
  actual_start_time?: number;

  @ApiPropertyOptional({ description: '實際結束時刻，Epoch 毫秒' })
  @IsOptional()
  @IsNumber()
  actual_end_time?: number;
}

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
  @ExternalApi('營運任務')
  @ApiOperation({
    summary: '查詢訂單內容',
    description:
      '車端拉取任務內容。營運任務狀態協議 §四 階段一：收到 operation/assign 之後'
      + '以 order_id 取回完整任務（站點序列、各站動作、時刻）。',
  })
  async queryOrder(@Query('id') id?: string) {
    if (!id) {
      throw new BadRequestException('id is required');
    }
    return this.orderService.getOrderByIdWithCoordinates(id);
  }

  @Put('updateOrderProgress/:id')
  @ExternalApi('營運任務')
  @ApiOperation({
    summary: '更新訂單狀態 (SSOT)',
    description:
      '車端回報訂單契約狀態。營運任務狀態協議把這一支定為<strong>唯一真相來源</strong>'
      + '——中心端資料庫的狀態判定以本 API 的 HTTP 成功回傳為準，不採信 MQTT 訊息。',
  })
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
  @ExternalApi('營運任務')
  @ApiOperation({
    summary: '車端以 action_id 回報站點動作狀態',
    description:
      '節點任務（語音、開關門、聯鎖）的執行結果回報。營運任務狀態協議 §四 階段二。',
  })
  async updateActionStatus(
    @Param('actionId') actionId: string,
    @Body() body: UpdateActionStatusDto,
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

