import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type AuthUser } from './auth.service';
import { SESSION_COOKIE } from './access.constants';

export const REQUIRE_PERMISSION = 'access:permission';
export const RequirePermission = (permission: string) => SetMetadata(REQUIRE_PERMISSION, permission);

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
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permission = this.reflector.getAllAndOverride<string>(REQUIRE_PERMISSION, [context.getHandler(), context.getClass()]);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const session = await this.auth.authenticate(readCookie(request), request.header('x-csrf-token') ?? undefined, mutating);
    if (!session) throw new UnauthorizedException('請先登入');
    request.authUser = session.user;
    if (permission && !session.user.permissions.includes(permission)) throw new ForbiddenException('沒有執行此操作的權限');
    return true;
  }
}
