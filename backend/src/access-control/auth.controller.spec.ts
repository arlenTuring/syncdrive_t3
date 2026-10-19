import type { Request } from 'express';
import { isHttps } from './auth.controller';

const request = (proto: string | undefined, secure = false) =>
  ({ secure, header: (name: string) => (name === 'x-forwarded-proto' ? proto : undefined) }) as unknown as Request;

describe('isHttps（登入 cookie 是否標 Secure）', () => {
  it('部署機經 nginx 走 http 時不標 Secure，否則瀏覽器會丟掉登入 cookie', () => {
    expect(isHttps(request('http'))).toBe(false);
  });

  it('經 HTTPS 進來時標 Secure', () => {
    expect(isHttps(request('https'))).toBe(true);
    expect(isHttps(request('https, http'))).toBe(true);
  });

  it('沒有代理標頭時看連線本身', () => {
    expect(isHttps(request(undefined, false))).toBe(false);
    expect(isHttps(request(undefined, true))).toBe(true);
  });
});
