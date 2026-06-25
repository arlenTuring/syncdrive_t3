import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * 中心端指令 API 金鑰守門。
 *
 * 安全關鍵端點（如 command/execute 可全車隊急停）必須驗證身分。
 * - 設定 VTMS_API_KEY 時：請求必須帶 `x-api-key` 標頭且相符，否則 401。
 * - 未設定時：僅在非 production 放行，並印出警告，避免開發環境被卡死；
 *   production 未設金鑰則一律拒絕（fail-safe）。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private warnedOnce = false;

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('VTMS_API_KEY', '').trim();
    const isProd =
      this.configService.get<string>('NODE_ENV', 'development') === 'production';

    if (!expected) {
      if (isProd) {
        throw new UnauthorizedException(
          'VTMS_API_KEY is not configured; refusing privileged command in production.',
        );
      }
      if (!this.warnedOnce) {
        this.logger.warn(
          'VTMS_API_KEY 未設定，開發模式下放行指令 API。正式環境請務必設定金鑰。',
        );
        this.warnedOnce = true;
      }
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-api-key')?.trim();
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing x-api-key header.');
    }
    return true;
  }
}
