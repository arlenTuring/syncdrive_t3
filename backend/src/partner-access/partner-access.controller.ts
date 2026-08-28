import { Body, Controller, Post, Req } from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { SetMetadata } from '@nestjs/common';
import { EXTERNAL_API_METADATA_KEY, EXTERNAL_API_TAG_PREFIX } from '../common/external-api.decorator';
import {
  DEFAULT_TTL_MINUTES,
  MAX_TTL_MINUTES,
  MIN_TTL_MINUTES,
  PartnerAccessService,
} from './partner-access.service';

class IssueTokenDto {
  @ApiProperty({ description: '我方配發的帳號', example: 'partner' })
  @IsString()
  username!: string;

  @ApiProperty({ description: '我方配發的密碼' })
  @IsString()
  password!: string;

  @ApiPropertyOptional({
    description: `金鑰有效時長，單位分鐘。預設 ${DEFAULT_TTL_MINUTES}（24 小時），`
      + `可指定 ${MIN_TTL_MINUTES}～${MAX_TTL_MINUTES}。`,
    default: DEFAULT_TTL_MINUTES,
    minimum: MIN_TTL_MINUTES,
    maximum: MAX_TTL_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_TTL_MINUTES)
  @Max(MAX_TTL_MINUTES)
  ttl_minutes?: number;

  @ApiPropertyOptional({
    description: '要取得 MQTT 用戶端憑證的車輛代號；未指定時回傳全部已簽發的車輛。',
    example: ['PMS-01', 'PMS-02'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicle_codes?: string[];
}

/**
 * 對外存取憑據的發放。
 *
 * <strong>這一支不掛 ApiKeyGuard</strong>——它是取得金鑰的入口，要求先有金鑰才能
 * 取得金鑰是說不通的。身分由請求內容裡的帳密決定。它仍然標記為對外端點，
 * 所以在對外 port 上打得到、也會出現在對外文件裡。
 */
@ApiTags(`${EXTERNAL_API_TAG_PREFIX}｜存取憑據`)
@Controller('syncdrive-api/auth')
export class PartnerAccessController {
  constructor(private readonly service: PartnerAccessService) {}

  @Post('token')
  @SetMetadata(EXTERNAL_API_METADATA_KEY, true)
  @ApiOperation({
    summary: '以帳號密碼換取 API 金鑰與 MQTT 用戶端憑證',
    description:
      '回應同時包含後續呼叫對外 API 所需的 `x-api-key`，以及連線 MQTT broker 所需的 '
      + 'CA 憑證與各車的用戶端憑證與私鑰。金鑰在 `expires_at` 之後失效，屆時重新呼叫本端點取得新的一把。'
      + '金鑰僅在本回應中出現一次，中心端只保存其雜湊值，無法再次查詢。',
  })
  @ApiUnauthorizedResponse({ description: '帳號或密碼不正確' })
  async issue(@Body() body: IssueTokenDto, @Req() request: Request) {
    return this.service.issue({
      username: body.username,
      password: body.password,
      ttlMinutes: body.ttl_minutes,
      vehicleCodes: body.vehicle_codes,
      sourceIp: request.ip,
    });
  }
}
