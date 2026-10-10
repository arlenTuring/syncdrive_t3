import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const DEGRADED_LEVELS = [1, 2, 3] as const;

export class CreateDegradedOperationPlanDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @IsIn(DEGRADED_LEVELS)
  level!: number;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  speed_limit_kmh!: number;
}

export class UpdateDegradedOperationPlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(DEGRADED_LEVELS)
  level?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  speed_limit_kmh?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ExecuteDegradedOperationDto extends CreateDegradedOperationPlanDto {
  @IsOptional()
  @IsString()
  source_plan_id?: string;

  @IsIn(['immediate', 'scheduled'])
  schedule_mode!: 'immediate' | 'scheduled';

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  scheduled_time?: string;

  @IsOptional()
  @IsString()
  time_zone?: string;

  @IsString()
  idempotency_key!: string;
}

export class AdjustExecutionDto {
  @Type(() => Number)
  @IsInt()
  @IsIn(DEGRADED_LEVELS)
  level!: number;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  speed_limit_kmh!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class UpdateExecutionContentDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @IsIn(DEGRADED_LEVELS)
  level!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class RestoreExecutionDto {
  @IsBoolean()
  personnel_and_vehicles_cleared!: boolean;

  @IsBoolean()
  alarms_cleared!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class SaveDraftDto {
  @IsObject()
  value!: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsIn(['open', 'cancelled', 'submitted'])
  status?: 'open' | 'cancelled' | 'submitted';
}

export class InteractionEventDto {
  @IsIn(['plan_selected', 'dialog_opened', 'dialog_cancelled'])
  action!: 'plan_selected' | 'dialog_opened' | 'dialog_cancelled';

  @IsOptional()
  @IsString()
  plan_id?: string;

  @IsOptional()
  @IsString()
  execution_id?: string;

  @IsOptional()
  @IsString()
  draft_key?: string;

  @IsOptional()
  @IsObject()
  detail?: Record<string, unknown>;
}

export class ExecutionVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
