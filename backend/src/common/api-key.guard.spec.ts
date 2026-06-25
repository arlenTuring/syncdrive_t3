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
  it('設定金鑰時，相符的 x-api-key 放行', () => {
    const guard = new ApiKeyGuard(makeConfig({ VTMS_API_KEY: 'secret' }));
    expect(guard.canActivate(ctxWithHeader('secret'))).toBe(true);
  });

  it('設定金鑰時，缺少或不符的 x-api-key 拒絕', () => {
    const guard = new ApiKeyGuard(makeConfig({ VTMS_API_KEY: 'secret' }));
    expect(() => guard.canActivate(ctxWithHeader('wrong'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctxWithHeader(undefined))).toThrow(UnauthorizedException);
  });

  it('未設金鑰且為開發模式時放行', () => {
    const guard = new ApiKeyGuard(makeConfig({ NODE_ENV: 'development' }));
    expect(guard.canActivate(ctxWithHeader(undefined))).toBe(true);
  });

  it('未設金鑰但為 production 時拒絕（fail-safe）', () => {
    const guard = new ApiKeyGuard(makeConfig({ NODE_ENV: 'production' }));
    expect(() => guard.canActivate(ctxWithHeader('anything'))).toThrow(UnauthorizedException);
  });
});
