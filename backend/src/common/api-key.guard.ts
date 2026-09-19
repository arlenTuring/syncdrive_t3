import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PartnerAccessService } from '../partner-access/partner-access.service';

/**
 * 對外 API 的金鑰守門。
 *
 * 接受兩種金鑰：
 *
 * <ol>
 *   <li><strong>發放的金鑰</strong>——廠商以帳密向 <code>POST /syncdrive-api/auth/token</code>
 *       換得，帶有效期，逾時自動失效。這是正常路徑。</li>
 *   <li><strong>環境變數裡的固定金鑰</strong>（<code>VTMS_API_KEY</code>）——中心端自用
 *       與既有整合的相容路徑。它不會過期，所以只該留給我方內部工具。</li>
 * </ol>
 *
 * 未設定固定金鑰時：正式環境一律拒絕（fail-safe），開發環境放行並警告一次，
 * 避免本機被卡死。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private warnedOnce = false;

  constructor(
    private readonly configService: ConfigService,
    /*
     * 標成 Optional：這個守衛也用在不會載入 PartnerAccessModule 的測試情境裡。
     * 拿不到服務時退回「只認固定金鑰」，而不是讓整個請求因為缺少相依而 500。
     */
    @Optional() private readonly partnerAccess?: PartnerAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expected = this.configService.get<string>('VTMS_API_KEY', '').trim();
    const isProd =
      this.configService.get<string>('NODE_ENV', 'development') === 'production';

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-api-key')?.trim();

    if (provided && expected && provided === expected) return true;

    if (provided && this.partnerAccess) {
      if (await this.partnerAccess.verify(provided)) {
        (request as Request & { vehicleScope?: string[] }).vehicleScope =
          await this.partnerAccess.vehicleScope(provided);
        return true;
      }
    }

    if (!expected && !this.partnerAccess) {
      if (isProd) {
        throw new UnauthorizedException(
          'VTMS_API_KEY is not configured; refusing privileged command in production.',
        );
      }
      if (!this.warnedOnce) {
        this.logger.warn(
          'VTMS_API_KEY 未設定，開發模式下放行對外 API。正式環境請務必設定金鑰。',
        );
        this.warnedOnce = true;
      }
      return true;
    }

    throw new UnauthorizedException({ statusCode: 401, code: 'INVALID_API_KEY', message: 'x-api-key 缺少、不正確或已過期，請重新申請。' });
  }
}
