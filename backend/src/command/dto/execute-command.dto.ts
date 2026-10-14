import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { CommandType } from '../../database/entities/command-log.entity';
import { REGISTERED_VEHICLE_CODE_OR_ALL_PATTERN } from '../../common/vehicle-codes';

/**
 * 中心端 → 車端 動態控制指令的請求格式。
 * 集中以 class-validator 強制協議約束，取代散落於 controller 的手寫驗證。
 */
export class ExecuteCommandDto {
  @ApiProperty({ example: 'yard-shuttle_7', description: "'all' 或已登錄的載具通訊身分" })
  @IsString()
  @Matches(REGISTERED_VEHICLE_CODE_OR_ALL_PATTERN, {
    message: "vehicle_code 必須為 'all' 或有效的已註冊通訊身分",
  })
  vehicle_code: string;

  @ApiProperty({ enum: CommandType, example: CommandType.EMERGENCY_STOP })
  @IsEnum(CommandType, {
    message: `action 必須為下列之一：${Object.values(CommandType).join(', ')}`,
  })
  action: CommandType;

  @ApiPropertyOptional({
    example: { deceleration: 'MAX', hazard_light: true },
    description: '指令參數，依 action 而定',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, any>;
}
