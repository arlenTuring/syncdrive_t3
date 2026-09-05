import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HttpsCertificateService,
  type HttpsCertificateStatus,
} from './https-certificate.service';
import { SystemFoundationSettingsService } from './system-foundation-settings.service';
import type { SystemFoundationSettings } from './system-foundation-settings';

class RotateHttpsCertificateDto {
  /** PEM 憑證（可含憑證鏈） */
  certificatePem!: string;
  /** PEM 私鑰；僅寫入伺服器，永不回傳 */
  privateKeyPem!: string;
}

@ApiTags('SystemFoundation')
@Controller('syncdrive-api/system/foundation')
export class SystemFoundationController {
  constructor(
    private readonly foundationSettings: SystemFoundationSettingsService,
    private readonly httpsCertificates: HttpsCertificateService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: '取得系統基礎設定（全系統共用；密碼已遮罩）' })
  async getSettings(): Promise<SystemFoundationSettings> {
    return this.foundationSettings.get();
  }

  @Put('settings')
  @ApiOperation({ summary: '儲存系統基礎設定（全系統共用）' })
  @ApiBody({ description: '系統基礎設定完整物件' })
  async putSettings(
    @Body() body: SystemFoundationSettings,
  ): Promise<SystemFoundationSettings> {
    return this.foundationSettings.save(body);
  }

  @Get('ssl/certificate')
  @ApiOperation({
    summary: '取得 HTTPS 傳輸憑證狀態（僅公開 metadata，不含私鑰）',
  })
  getCertificateStatus(): HttpsCertificateStatus {
    return this.httpsCertificates.getStatus();
  }

  @Put('ssl/certificate')
  @ApiOperation({
    summary: '上傳／輪替 HTTPS 憑證與私鑰（私鑰只寫入磁碟，回應不含私鑰）',
  })
  @ApiBody({ type: RotateHttpsCertificateDto })
  rotateCertificate(
    @Body() body: RotateHttpsCertificateDto,
  ): HttpsCertificateStatus {
    return this.httpsCertificates.rotate(
      body?.certificatePem ?? '',
      body?.privateKeyPem ?? '',
    );
  }
}
