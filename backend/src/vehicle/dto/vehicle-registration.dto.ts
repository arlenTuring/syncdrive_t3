import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { REGISTERED_VEHICLE_CODE_PATTERN } from '../../common/vehicle-codes';

const trim = ({ value }: { value: unknown }) => String(value ?? '').trim();

export class VehicleRegistrationQueryDto {
  @IsOptional() @IsString() @MaxLength(80) @Transform(trim) keyword = '';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @IsOptional() @IsIn(['name', 'mileage', 'connection', 'service', 'createdAt'])
  sortBy: 'name' | 'mileage' | 'connection' | 'service' | 'createdAt' = 'createdAt';
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection: 'asc' | 'desc' = 'desc';
}

export class CreateVehicleDto {
  @IsString() @Transform(trim) @MaxLength(40)
  @Matches(REGISTERED_VEHICLE_CODE_PATTERN, { message: '載具名稱只能使用英文字母、數字、底線或連字號，且不可為 all' })
  displayName!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(999999999) initialMileageKm = 0;
}

export class VehicleIdentityAvailabilityDto {
  @IsString() @Transform(trim) @MaxLength(40)
  @Matches(REGISTERED_VEHICLE_CODE_PATTERN, { message: '載具名稱只能使用英文字母、數字、底線或連字號，且不可為 all' })
  value!: string;
}

export class UpdateVehicleDto {
  @IsString() @Transform(trim) @MaxLength(80) displayName!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(999999999) initialMileageKm!: number;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class UpdateVehicleServiceDto {
  @IsBoolean() serviceEnabled!: boolean;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class VehicleIdDto {
  @IsUUID() id!: string;
}
