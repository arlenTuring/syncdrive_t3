import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeyGuard } from '../common/api-key.guard';
import { ExternalPortGuard } from '../common/external-port.guard';
import { AuthService, type AuthUser } from './auth.service';
import { SESSION_COOKIE } from './access.constants';

export const REQUIRE_PERMISSION = 'access:permission';
export const ALLOW_API_KEY = 'access:allow-api-key';
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRE_PERMISSION, permissions);
/** 內部整合端點可用有效 x-api-key，未帶金鑰時仍走原本的瀏覽器 Session 權限。 */
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY, true);
/**
 * 不需登入的端點（覆蓋類別上的 RequirePermission）。只給健康檢查這類不含資料的端點用：
 * 本機啟動腳本與部署機容器的 healthcheck 沒有登入工作階段，被擋成 401 就會把正常的後端判成沒就緒。
 */
export const PublicEndpoint = () => SetMetadata(REQUIRE_PERMISSION, []);

export type AuthenticatedRequest = Request & { authUser?: AuthUser };

export function readCookie(request: Request, name = SESSION_COOKIE): string | null {
  const raw = request.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Optional() private readonly apiKey?: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext) {
    // APP_GUARD 比 main.ts 的全域守衛先跑：對外 port 上未開放的路由要先回 404（不洩漏路徑存在），
    // 不能先被登入檢查回成 401
    if (!new ExternalPortGuard(this.reflector).canActivate(context)) return false;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!permissions?.length) return true;
    const allowApiKey = this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY, [context.getHandler(), context.getClass()]);
    if (allowApiKey && request.header('x-api-key') && this.apiKey) return this.apiKey.canActivate(context);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const session = await this.auth.authenticate(readCookie(request), request.header('x-csrf-token') ?? undefined, mutating);
    if (!session) throw new UnauthorizedException('請先登入');
    request.authUser = session.user;
    if (!permissions.some((permission) => session.user.permissions.includes(permission))) throw new ForbiddenException('權限不足');
    return true;
  }
}
