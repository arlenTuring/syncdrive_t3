import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard, AllowApiKey, PublicEndpoint, RequirePermission } from './access.guard';
import type { AuthService } from './auth.service';
import type { ApiKeyGuard } from '../common/api-key.guard';

@RequirePermission('system.datasource.view')
class ProtectedController {
  @PublicEndpoint()
  ping() {
    return { ok: true };
  }

  tables() {
    return [];
  }

  @AllowApiKey()
  simulator() {
    return [];
  }
}

function contextFor(handler: () => unknown, apiKey?: string): ExecutionContext {
  const request = { method: 'GET', headers: {}, header: (name: string) => name === 'x-api-key' ? apiKey : undefined };
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

  it('accepts a valid API key only on endpoints that explicitly allow it', async () => {
    const apiKey = { canActivate: jest.fn().mockResolvedValue(true) } as unknown as ApiKeyGuard;
    const apiKeyGuard = new AccessGuard(new Reflector(), auth, apiKey);
    const context = contextFor(ProtectedController.prototype.simulator, 'valid-key');
    await expect(apiKeyGuard.canActivate(context)).resolves.toBe(true);
    expect(apiKey.canActivate).toHaveBeenCalledWith(context);
  });
});
