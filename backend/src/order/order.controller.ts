import { BadRequestException, Controller, Post, Get, Put, Body, Query, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrderService } from './order.service';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
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
    summary: '依訂單編號取得任務內容',
    description:
      '取得指定訂單之站序、各站計畫時刻與起訖點座標。'
      + '`operation/assign` 僅傳遞訂單編號，任務內容以本端點取得。'
      + '中心端不提供路徑，路徑由車端依站序與場域座標自行規劃。'
      + '欄位定義見車端介接說明書 §五.1。',
  })
  @ApiOkResponse({ description: '訂單內容' })
  @ApiBadRequestResponse({ description: '缺少 id 參數' })
  @ApiNotFoundResponse({ description: '訂單不存在' })
  async queryOrder(@Query('id') id?: string) {
    if (!id) {
      throw new BadRequestException('id is required');
    }
    return this.orderService.getOrderByIdWithCoordinates(id);
  }

  @Put('updateOrderProgress/:id')
  @ExternalApi('營運任務')
  @ApiOperation({
    summary: '回報訂單狀態',
    description:
      '本端點為訂單狀態之唯一權威來源。中心端之訂單狀態僅依本端點的 HTTP 成功回應變更，'
      + '不採信 MQTT 訊息中的狀態欄位。'
      + '允許之狀態轉移：PENDING → PROCESSING；PROCESSING → END 或 FAULTED；'
      + 'FAULTED → PROCESSING 或 END。END 為終態。'
      + '欄位定義見車端介接說明書 §五.2。',
  })
  @ApiOkResponse({ description: '更新後之訂單' })
  @ApiBadRequestResponse({ description: 'status 值不合法，或不允許之狀態轉移' })
  @ApiNotFoundResponse({ description: '訂單不存在' })
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
    summary: '回報站點動作執行結果',
    description:
      '回報站點動作（發車前語音、開關門、路口聯鎖、精準對位停靠）之執行結果。'
      + '動作代碼與觸發時機見營運任務狀態協議 §六.1，欄位定義見車端介接說明書 §五.3。',
  })
  @ApiOkResponse({ description: '更新後之動作狀態' })
  @ApiBadRequestResponse({ description: 'status 值不合法' })
  @ApiNotFoundResponse({ description: '動作識別碼不存在' })
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

