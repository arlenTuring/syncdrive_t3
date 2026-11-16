import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import type { Request, Response } from 'express';
import { sameServerRedirect, VideoLiveService } from './video-live.service';

/**
 * HLS 轉送：媒體服務（MediaMTX 1.21）第一次回播放清單前會先 302 到 ?cookieCheck=1。
 * 這個導向以前原封不動回給瀏覽器、又沒帶 Location，瀏覽器的 HLS 播放器停在 302；
 * WebRTC 的 UDP 不通時（GCP 防火牆沒開 8189）整格就是「影像中斷」（2026-11-17 GCP 實測）。
 */

type Captured = { status: number; headers: Record<string, string>; body: string };

function fakeResponse(): { res: Response; done: Promise<Captured> } {
  const stream = new PassThrough();
  const captured: Captured = { status: 0, headers: {}, body: '' };
  const target = stream as unknown as Response & { headersSent: boolean };
  target.headersSent = false;
  (target as unknown as { status: (code: number) => unknown }).status = (code: number) => {
    captured.status = code;
    return target;
  };
  (target as unknown as { setHeader: (k: string, v: string) => unknown }).setHeader = (k: string, v: string) => {
    captured.headers[k.toLowerCase()] = v;
    return target;
  };
  (target as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => {
    stream.end(JSON.stringify(v));
    return target;
  };
  const done = new Promise<Captured>((resolve) => {
    stream.on('data', (chunk) => { captured.body += String(chunk); });
    stream.on('end', () => resolve(captured));
  });
  return { res: target, done };
}

function fakeRequest(): Request {
  const req = new PassThrough() as unknown as Request;
  (req as unknown as { headers: Record<string, string> }).headers = {};
  return req;
}

describe('HLS 轉送', () => {
  let server: Server;
  let base: string;
  const seen: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'http://media');
      if (url.pathname === '/vs_a/index.m3u8' && !url.searchParams.has('cookieCheck')) {
        res.writeHead(302, { Location: '/vs_a/index.m3u8?cookieCheck=1' });
        res.end();
        return;
      }
      if (url.pathname === '/vs_a/index.m3u8') {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\nvideo1_stream.m3u8?session=abc-123\n');
        return;
      }
      if (url.pathname === '/vs_a/elsewhere') {
        res.writeHead(302, { Location: 'http://other-host/vs_a/index.m3u8' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const pipe = (service: VideoLiveService, target: URL, prefix?: string) => {
    const { res, done } = fakeResponse();
    const run = (service as unknown as {
      pipe: (t: URL, m: string, q: Request, r: Response, b: null, w: undefined, f?: string) => Promise<void>;
    }).pipe(target, 'GET', fakeRequest(), res, null, undefined, prefix);
    return run.then(() => done);
  };

  const service = new VideoLiveService({} as never, {} as never, {} as never);

  it('媒體服務導到同一條路徑的 ?cookieCheck=1：在後端跟過去，瀏覽器直接拿到播放清單', async () => {
    seen.length = 0;
    const result = await pipe(service, new URL(`${base}/vs_a/index.m3u8`), '/vs_a/');
    expect(result.status).toBe(200);
    expect(result.body).toContain('video1_stream.m3u8?session=abc-123');
    expect(seen).toEqual(['/vs_a/index.m3u8', '/vs_a/index.m3u8?cookieCheck=1']);
  });

  it('導向別台主機不跟（原樣回 302）', async () => {
    const result = await pipe(service, new URL(`${base}/vs_a/elsewhere`), '/vs_a/');
    expect(result.status).toBe(302);
  });

  it('只認同一台、同一條路徑', () => {
    const from = new URL('http://mediamtx:8888/vs_a/index.m3u8');
    expect(sameServerRedirect(from, '/vs_a/index.m3u8?cookieCheck=1', '/vs_a/')?.href)
      .toBe('http://mediamtx:8888/vs_a/index.m3u8?cookieCheck=1');
    expect(sameServerRedirect(from, '/vs_b/index.m3u8', '/vs_a/')).toBeNull();
    expect(sameServerRedirect(from, 'http://evil/vs_a/x', '/vs_a/')).toBeNull();
    expect(sameServerRedirect(from, undefined, '/vs_a/')).toBeNull();
  });
});
