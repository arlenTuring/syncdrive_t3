import { Controller, Post, Body, Req, BadRequestException, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import { CommandService } from './command.service';
import { ExecuteCommandDto } from './dto/execute-command.dto';
import { CommandType } from '../database/entities/command-log.entity';
import { AuditService } from '../audit/audit.service';
import { OperatorActionType, ActionResult } from '../database/entities/operator-action-log.entity';
import { VTMS_VEHICLE_CODE_OR_ALL_PATTERN } from '../common/vehicle-codes';
import { ApiKeyGuard } from '../common/api-key.guard';

@ApiTags('Command & Event (P4)')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
// 安全關鍵端點：嚴格白名單，拒絕協議外的多餘欄位
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('syncdrive-api/command')
export class CommandController {
  constructor(
    private readonly commandService: CommandService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 中心端下發動態控制指令
   * 支援兩種 vehicle_code：
   *   - 特定車輛：'PMS-01' ~ 'PMS-11'
   *   - 全車隊廣播：'all'
   * 對應 Topic: v1/vtms/{vehicle_code}/command/execute (retain: false)
   */
  @Post('execute')
  @ApiOperation({ summary: '下發動態控制指令 (中心 → 車端 / 廣播)' })
  @ApiBody({
    schema: {
      example: {
        vehicle_code: 'PMS-05',
        action: 'EMERGENCY_STOP',
        params: { deceleration: 'MAX', hazard_light: true },
      },
    },
  })
  async executeCommand(@Body() dto: ExecuteCommandDto, @Req() req: Request) {
    const { vehicle_code, action } = dto;
    const sourceIp = req.ip || req.socket.remoteAddress;

    // 驗證 vehicle_code 格式：允許 'all' 或 'PMS-01'~'PMS-11'
    const validVehicleCode = VTMS_VEHICLE_CODE_OR_ALL_PATTERN.test(vehicle_code);
    if (!validVehicleCode) {
      // 稽核：驗證失敗的操作也要留紀錄
      await this.auditService.write({
        sourceIp,
        actionType: OperatorActionType.COMMAND_DISPATCH,
        targetVehicle: vehicle_code,
        actionDetail: { action, params: dto.params },
        result: ActionResult.REJECTED,
        failureReason: `Invalid vehicle_code: '${vehicle_code}'`,
      });
      throw new BadRequestException(
        `Invalid vehicle_code: '${vehicle_code}'. Must be 'all' or PMS-01~PMS-11.`
      );
    }

    // 驗證 action 是否為規格書允許的合法指令
    const validActions = Object.values(CommandType) as string[];
    if (!validActions.includes(action)) {
      await this.auditService.write({
        sourceIp,
        actionType: OperatorActionType.COMMAND_DISPATCH,
        targetVehicle: vehicle_code,
        actionDetail: { action, params: dto.params },
        result: ActionResult.REJECTED,
        failureReason: `Invalid action: '${action}'`,
      });
      throw new BadRequestException(
        `Invalid action: '${action}'. Allowed: ${validActions.join(', ')}`
      );
    }

    const result = await this.commandService.executeCommand(dto);

    // 規格書 §系統操作紀錄：成功下發後留下稽核紀錄
    await this.auditService.write({
      sourceIp,
      actionType: OperatorActionType.COMMAND_DISPATCH,
      targetVehicle: vehicle_code,
      actionDetail: {
        command_id: result.commandId,
        action,
        params: dto.params || {},
      },
      result: ActionResult.SUCCESS,
    });

    return {
      success: true,
      command_id: result.commandId,
      vehicle_code: result.vehicleCode,
      action: result.action,
      sent_at: result.sentAt,
      message: vehicle_code === 'all'
        ? `Broadcast command '${action}' published to all vehicles.`
        : `Command '${action}' published to ${vehicle_code}.`,
    };
  }
}
