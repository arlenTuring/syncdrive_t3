import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';

const ctxWithHeader = (key?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ header: (_: string) => key }),
    }),
  } as unknown as ExecutionContext);

const makeConfig = (env: Record<string, string>): ConfigService =>
  ({ get: (k: string, d?: string) => env[k] ?? d ?? '' } as unknown as ConfigService);

describe('ApiKeyGuard', () => {
  it('設定金鑰時，相符的 x-api-key 放行', async () => {
    const guard = new ApiKeyGuard(makeConfig({ VTMS_API_KEY: 'secret' }));
    await expect(guard.canActivate(ctxWithHeader('secret'))).resolves.toBe(true);
  });

  it('設定金鑰時，缺少或不符的 x-api-key 拒絕', async () => {
    const guard = new ApiKeyGuard(makeConfig({ VTMS_API_KEY: 'secret' }));
    await expect(guard.canActivate(ctxWithHeader('wrong'))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctxWithHeader(undefined))).rejects.toThrow(UnauthorizedException);
  });

  it('未設金鑰且為開發模式時放行', async () => {
    const guard = new ApiKeyGuard(makeConfig({ NODE_ENV: 'development' }));
    await expect(guard.canActivate(ctxWithHeader(undefined))).resolves.toBe(true);
  });

  it('未設金鑰但為 production 時拒絕（fail-safe）', async () => {
    const guard = new ApiKeyGuard(makeConfig({ NODE_ENV: 'production' }));
    await expect(guard.canActivate(ctxWithHeader('anything'))).rejects.toThrow(UnauthorizedException);
  });
});
