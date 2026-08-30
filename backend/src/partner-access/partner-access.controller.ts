import { Body, Controller, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
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
  @ApiProperty({ description: '配發之帳號', example: 'partner' })
  @IsString()
  username!: string;

  @ApiProperty({ description: '配發之密碼' })
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
    description: '需取得 MQTT 用戶端憑證之車輛代號；未指定時回傳全部已簽發之車輛。',
    example: ['PMS-01', 'PMS-02'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicle_codes?: string[];
}

class MqttClientCertificateDto {
  @ApiProperty({ description: '車輛代號', example: 'PMS-01' })
  vehicle_code!: string;

  @ApiProperty({ description: '該車用戶端憑證，PEM 格式' })
  certificate!: string;

  @ApiProperty({ description: '憑證生效時間，Unix Epoch 毫秒', example: 1787889940000 })
  not_before!: number;

  @ApiProperty({
    description: '憑證失效時間，Unix Epoch 毫秒。等於本次申請金鑰的 expires_at',
    example: 1787976400000,
  })
  not_after!: number;

  @ApiProperty({ description: '該車用戶端私鑰，PEM 格式' })
  private_key!: string;
}

class MqttBundleDto {
  @ApiProperty({ description: 'MQTT broker 位址', example: '34.80.84.224' })
  host!: string;

  @ApiProperty({ description: 'MQTT broker 埠', example: 8883 })
  port!: number;

  @ApiProperty({ description: '固定為 true，連線採 TLS 雙向驗證', example: true })
  tls!: boolean;

  @ApiProperty({
    description: '根 CA 憑證，PEM 格式。設為 TLS 用戶端的信任錨點，用於驗證 broker',
  })
  ca_certificate!: string;

  @ApiProperty({
    description:
      '中介 CA 憑證，PEM 格式。車輛憑證的簽發者，接於 clients[].certificate 之後'
      + '組成送出的憑證鏈（葉子在前、中介在後）',
  })
  intermediate_certificate!: string;

  @ApiProperty({ description: '各車之用戶端憑證與私鑰', type: [MqttClientCertificateDto] })
  clients!: MqttClientCertificateDto[];
}

class IssuedTokenDto {
  @ApiProperty({ description: '呼叫各介面時帶入 x-api-key 標頭之值' })
  api_key!: string;

  @ApiProperty({ description: '固定為 ApiKey', example: 'ApiKey' })
  token_type!: string;

  @ApiProperty({ description: '簽發時間，Unix Epoch 毫秒', example: 1787890000000 })
  issued_at!: number;

  @ApiProperty({ description: '失效時間，Unix Epoch 毫秒', example: 1787976400000 })
  expires_at!: number;

  @ApiProperty({ description: '有效時長，分鐘', example: 1440 })
  expires_in_minutes!: number;

  @ApiProperty({ description: 'MQTT 連線資訊與用戶端憑證', type: MqttBundleDto })
  mqtt!: MqttBundleDto;
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
    summary: '申請 API 金鑰與 MQTT 用戶端憑證',
    description:
      '以配發之帳號密碼申請存取憑據。回應包含後續呼叫各介面所需的 `x-api-key`，'
      + '以及連線 MQTT broker 所需的 CA 憑證與各車之用戶端憑證與私鑰。'
      + '金鑰於 `expires_at` 之後失效，屆時重新呼叫本端點取得新金鑰。'
      + '金鑰值僅於本回應出現一次，中心端僅保存其雜湊值，無法回查。'
      + '欄位定義見介接說明書 §一。',
  })
  @ApiOkResponse({ description: 'API 金鑰與 MQTT 用戶端憑證', type: IssuedTokenDto })
  @ApiBadRequestResponse({
    description: 'ttl_minutes 逾值域，或 vehicle_codes 含未簽發之車輛代號',
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
