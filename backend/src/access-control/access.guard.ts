import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type AuthUser } from './auth.service';
import { SESSION_COOKIE } from './access.constants';

export const REQUIRE_PERMISSION = 'access:permission';
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRE_PERMISSION, permissions);

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
    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!permissions?.length) return true;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const session = await this.auth.authenticate(readCookie(request), request.header('x-csrf-token') ?? undefined, mutating);
    if (!session) throw new UnauthorizedException('請先登入');
    request.authUser = session.user;
    if (!permissions.some((permission) => session.user.permissions.includes(permission))) throw new ForbiddenException('權限不足');
    return true;
  }
}
