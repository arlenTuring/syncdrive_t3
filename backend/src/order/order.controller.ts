import { BadRequestException, Controller, Post, Get, Put, Body, Query, Param, Req, UseFilters } from '@nestjs/common';
import { OrderErrorFilter } from './order-error.filter';
import type { Request } from 'express';
import { OrderService } from './order.service';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
  ApiQuery,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
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
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  actual_start_time?: number;

  @ApiPropertyOptional({ description: '實際結束時刻，Epoch 毫秒' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  actual_end_time?: number;
}

@ApiUnauthorizedResponse({ description: '401 INVALID_API_KEY：金鑰缺漏、無效或過期' })
@ApiForbiddenResponse({ description: '403 VEHICLE_NOT_AUTHORIZED：非授權車輛的訂單／動作' })
@ApiTags('Operation Orders')
@UseFilters(OrderErrorFilter)
@Controller('syncdrive-api/order')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly auditService: AuditService,
  ) {}

  @Post('save')
  @ApiOperation({ summary: '建立新營運訂單（含 route_id → 站點動作實例化）' })
  @ApiBody({
    description: '訂單內容。PMS99 人工測試單請使用 line_kind=TEST，避免納入正式排班。',
    schema: {
      type: 'object',
      required: ['order_id', 'vehicle_code', 'trip_code', 'line_kind', 'planned_start', 'planned_end', 'payload'],
      properties: {
        order_id: { type: 'string', example: 'TEST-PMS99-20260918-001' },
        vehicle_code: { type: 'string', example: 'PMS99' },
        trip_code: { type: 'string', example: 'TEST-PMS99-20260918-001' },
        line_kind: { type: 'string', enum: ['MAINLINE', 'MAINTENANCE', 'TEST'], example: 'TEST' },
        priority_level: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
        planned_start: { type: 'integer', format: 'int64', description: 'Epoch 毫秒', example: 1789693200000 },
        planned_end: { type: 'integer', format: 'int64', description: 'Epoch 毫秒', example: 1789693320000 },
        payload: {
          type: 'object',
          additionalProperties: true,
          example: {
            source: 'manual_test',
            kind: 'passenger',
            test_route_id: 'route_1',
            route_name: 'N2W下行→T3下行',
            origin: { id: 'n2w_d_start', name: 'N2W下行出發', x: -14.96, y: 0 },
            destination: { id: 't3_d', name: 'T3下行', x: -882.31, y: -195.42 },
            stations: [
              { order: 1, station_id: 'n2w_d_start', station_name: 'N2W下行出發', role: 'origin' },
              { order: 2, station_id: 't3_d', station_name: 'T3下行', role: 'terminal' },
            ],
          },
        },
      },
    },
  })
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

  @Get('active')
  @ExternalApi('營運任務')
  @ApiOperation({ summary: '查詢本車未結案訂單（連線／重連／換證後對帳）', description: '包含 PENDING、PROCESSING、FAULTED；MQTT assign 僅通知 id，錯過通知可由本端點取回。依 API 金鑰的 vehicle_codes 授權。' })
  @ApiQuery({ name: 'vehicle_code', required: true, example: 'PMS99' })
  @ApiOkResponse({ description: '{ vehicle_code, items: 訂單陣列 }，無訂單時 items=[]' })
  @ApiBadRequestResponse({ description: '400 VEHICLE_CODE_REQUIRED：缺少 vehicle_code' })
  async activeOrders(@Query('vehicle_code') code: string, @Req() req: Request & { vehicleScope?: string[] }) {
    return this.orderService.activeOrders(code, req.vehicleScope);
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
  async queryOrder(@Query('id') id: string, @Req() req: Request & { vehicleScope?: string[] }) {
    await this.orderService.authorizeOrder(id, req.vehicleScope);
    return this.orderService.getOrderByIdWithCoordinates(id);
  }

  @Put('updateOrderProgress/:id')
  @ApiQuery({ name: 'status', enum: ['PROCESSING', 'END', 'FAULTED'], required: true })
  @ExternalApi('營運任務')
  @ApiOperation({
    summary: '回報訂單狀態',
    description:
      '本端點為訂單狀態之唯一權威來源。中心端之訂單狀態僅依本端點的 HTTP 成功回應變更，'
      + '不採信 MQTT 訊息中的狀態欄位。'
      + '允許之狀態轉移：PENDING → PROCESSING 或 FAULTED；PROCESSING → END 或 FAULTED；'
      + 'FAULTED → PROCESSING 或 END。END 為終態。'
      + '值域固定三個，不擴充：END 表營運契約了結，FAULTED 收納所有非正常結束'
      + '（拒絕、失敗、無法到達、中止、取消）。車端更細的結束分類屬自動化層語意，'
      + '走 event/report 上報，不往本端點加狀態值。'
      + '欄位定義見車端介接說明書 §五.2。',
  })
  @ApiOkResponse({ description: '更新後之訂單' })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        operating_at: { type: 'integer', format: 'int64', description: '車端共用營運時鐘上的事件時刻；省略時以中心接收時刻換算' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'status 值不合法，或不允許之狀態轉移' })
  @ApiNotFoundResponse({ description: '訂單不存在' })
  async updateOrderProgress(
    @Param('id') id: string,
    @Query('status') status: string,
    @Body() body: { operating_at?: number } | undefined,
    @Req() req: Request,
  ) {
    await this.orderService.authorizeOrder(id, (req as Request & { vehicleScope?: string[] }).vehicleScope);
    const result = await this.orderService.updateOrderStatus(id, status, {
      reporter: 'vehicle',
      operatingAt: body?.operating_at,
    });

    await this.auditService.write({
      sourceIp: req.ip,
      actionType: OperatorActionType.ORDER_UPDATE,
      targetVehicle: result.vehicleCode,
      actionDetail: { order_id: id, new_status: status },
      result: ActionResult.SUCCESS,
    });

    return result;
  }

  @Put('cancel/:id')
  @ApiOperation({
    summary: '中心端主動取消訂單（內部用，不對外）',
    description:
      '行控人員在班表部署清單裡按下取消。只允許 PENDING、PROCESSING 兩種狀態；'
      + 'END／FAULTED 已是終態，回 400。'
      + '本端點只負責發起：立刻在訂單 payload 寫下 cancel_requested_at 作為權威事實，'
      + '並發布 MQTT v1/vtms/{vehicle_code}/operation/cancel 作低延遲通知（retain false，'
      + '車端可能錯過）。訂單的實際結案仍由車端依既有協議呼叫'
      + 'updateOrderProgress?status=FAULTED，中心端這裡不代為轉狀態。'
      + '重複呼叫同一張已請求取消的單，冪等回傳、不重發 MQTT。',
  })
  @ApiOkResponse({ description: '更新後之訂單（payload 含 cancel_requested_at）' })
  @ApiBadRequestResponse({ description: '400 ORDER_ALREADY_CLOSED：訂單已是終態' })
  @ApiNotFoundResponse({ description: '訂單不存在' })
  async cancelOrder(@Param('id') id: string, @Req() req: Request) {
    const result = await this.orderService.requestCancel(id);

    await this.auditService.write({
      sourceIp: req.ip,
      actionType: OperatorActionType.ORDER_CANCEL,
      targetVehicle: result.vehicleCode,
      actionDetail: { order_id: id },
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
    await this.orderService.authorizeAction(actionId, (req as Request & { vehicleScope?: string[] }).vehicleScope);
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
