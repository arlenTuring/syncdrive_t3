import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import {
  isLoopbackAddress,
  scheduleWhitepaperDevMiddleware,
} from './schedule-whitepaper.dev';

function call(path: string, remoteAddress: string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'whitepaper-'));
  writeFileSync(join(dir, '排班引擎算法全覽-審核.html'), '<html></html>');
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
    setHeader: jest.fn(),
    sendFile: jest.fn(),
  };
  const next = jest.fn();
  scheduleWhitepaperDevMiddleware(dir)(
    { path, method: 'GET', socket: { remoteAddress } } as unknown as Request,
    res as unknown as Response,
    next as NextFunction,
  );
  return { res, next };
}

describe('排班白皮書本機入口', () => {
  it('本機連線可以打開白皮書', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const { res } = call('/schedule-whitepaper/', address);
      expect(res.sendFile).toHaveBeenCalled();
    }
  });

  it('非本機連線當作不存在，不送檔', () => {
    for (const address of ['192.168.1.20', '::ffff:10.0.0.5', '2001:db8::1', undefined]) {
      const { res, next } = call('/schedule-whitepaper/', address);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.sendFile).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('其他路徑一律交給後面的路由，不論連線來源', () => {
    const { res, next } = call('/api/docs', '192.168.1.20');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('loopback 判斷不吃偽裝的字串', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('1127.0.0.1')).toBe(false);
    expect(isLoopbackAddress('::ffff:192.168.0.1')).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });
});
