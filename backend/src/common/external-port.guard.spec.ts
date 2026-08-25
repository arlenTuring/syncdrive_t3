import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExternalPortGuard } from './external-port.guard';

function makeContext(localPort: number) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        socket: { localPort },
        method: 'GET',
        url: '/syncdrive-api/operation-shift/list',
      }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

function makeGuard(isExternalRoute: boolean): ExternalPortGuard {
  const reflector = {
    getAllAndOverride: () => isExternalRoute,
  } as unknown as Reflector;
  return new ExternalPortGuard(reflector);
}

describe('ExternalPortGuard', () => {
  const original = process.env.EXTERNAL_PORT;
  afterEach(() => {
    if (original === undefined) delete process.env.EXTERNAL_PORT;
    else process.env.EXTERNAL_PORT = original;
  });

  it('未設定 EXTERNAL_PORT 時完全不作用', () => {
    delete process.env.EXTERNAL_PORT;
    expect(makeGuard(false).canActivate(makeContext(3000))).toBe(true);
  });

  it('內部 port 什麼都放行——我方前端也會用到對外那幾支', () => {
    process.env.EXTERNAL_PORT = '3100';
    expect(makeGuard(false).canActivate(makeContext(3000))).toBe(true);
    expect(makeGuard(true).canActivate(makeContext(3000))).toBe(true);
  });

  it('對外 port 只放行標記過的路由', () => {
    process.env.EXTERNAL_PORT = '3100';
    expect(makeGuard(true).canActivate(makeContext(3100))).toBe(true);
  });

  it('對外 port 打內部路由回 404，不是 403——不洩漏路徑存在', () => {
    process.env.EXTERNAL_PORT = '3100';
    expect(() => makeGuard(false).canActivate(makeContext(3100))).toThrow(
      NotFoundException,
    );
  });

  it('EXTERNAL_PORT 是無效值時視同沒設定', () => {
    process.env.EXTERNAL_PORT = 'abc';
    expect(makeGuard(false).canActivate(makeContext(3100))).toBe(true);
  });
});
