import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard, PublicEndpoint, RequirePermission } from './access.guard';
import type { AuthService } from './auth.service';

@RequirePermission('system.datasource.view')
class ProtectedController {
  @PublicEndpoint()
  ping() {
    return { ok: true };
  }

  tables() {
    return [];
  }
}

function contextFor(handler: () => unknown): ExecutionContext {
  const request = { method: 'GET', headers: {}, header: () => undefined };
  return {
    getHandler: () => handler,
    getClass: () => ProtectedController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AccessGuard', () => {
  // 沒有登入工作階段（啟動腳本、容器 healthcheck）
  const auth = { authenticate: jest.fn().mockResolvedValue(null) } as unknown as AuthService;
  const guard = new AccessGuard(new Reflector(), auth);

  it('lets a health check marked PublicEndpoint through without a session, even on a protected controller', async () => {
    await expect(guard.canActivate(contextFor(ProtectedController.prototype.ping))).resolves.toBe(true);
  });

  it('still requires a session for the other endpoints of that controller', async () => {
    await expect(guard.canActivate(contextFor(ProtectedController.prototype.tables))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
