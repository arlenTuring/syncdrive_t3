import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class VehicleRealtimeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => String(value ?? '').trim())
  keyword = '';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(['name', 'speed', 'battery', 'connection', 'gear', 'updatedAt'])
  sortBy: 'name' | 'speed' | 'battery' | 'connection' | 'gear' | 'updatedAt' = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'asc';
}
