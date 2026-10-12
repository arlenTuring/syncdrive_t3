import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ACCOUNT_NAME_PATTERN } from './access.constants';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class LoginDto {
  @Transform(trim) @IsString() @Matches(ACCOUNT_NAME_PATTERN) account_name: string;
  @IsString() password: string;
}

export class AccountQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) keyword?: string;
  @IsOptional() @IsIn(['account_name', 'display_name', 'roles']) sort_by: 'account_name' | 'display_name' | 'roles' = 'account_name';
  @IsOptional() @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'asc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page_size = 20;
  @IsOptional() @IsUUID('4') role_id?: string;
}

export class CreateAccountDto {
  @Transform(trim) @IsString() @Matches(ACCOUNT_NAME_PATTERN) account_name: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) display_name: string;
  @IsString() password: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsUUID('4', { each: true }) role_ids: string[];
}

export class ResetPasswordDto {
  @IsString() password: string;
}

export class RoleQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) keyword?: string;
  @IsOptional() @IsIn(['display_name', 'user_count']) sort_by: 'display_name' | 'user_count' = 'display_name';
  @IsOptional() @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'asc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page_size = 20;
}

export class SaveRoleDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) display_name: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) permission_ids: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expected_updated_at?: number;
}

export class UpdateAccountRolesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsUUID('4', { each: true }) role_ids: string[];
}
