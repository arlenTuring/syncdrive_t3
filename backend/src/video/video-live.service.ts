import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { Request, Response } from 'express';
import { readCookie } from '../access-control/access.guard';
import { AuthService, type AuthUser } from '../access-control/auth.service';
import type { VideoSourceRevision } from '../database/entities/video.entities';
import { MediaMtxClient } from './mediamtx.client';
import { probeRtsp } from './rtsp-probe';
import { buildSourceUrl, checkHostAllowed, defaultPort, maskedSourceUrl, type SourceAddress } from './source-address';
import { addressOf, VideoConfigService, type ConnectionInput } from './video-config.service';
import { SOURCE_TEST_CONCURRENCY, SOURCE_TEST_TTL_MS, TEST_PATH_PREFIX, videoConfig } from './video.config';
import { decryptSecret, signToken, verifyToken, type VideoToken } from './video-secrets';

const LIVE_TTL_MS = 10 * 60_000;
const SAFE_FILE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

type SourceTest = {
  id: string;
  mediaPath: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  status: 'connecting' | 'ready' | 'failed';
  error: string | null;
  tracks: string[];
  maskedUrl: string;
};

export const sessionHash = (cookie: string | null) => (cookie ? createHash('sha256').update(cookie).digest('hex').slice(0, 24) : '');

/**
 * 即時播放與「測試／預覽」。
 *
 * - 瀏覽器只拿到本系統的短效權杖網址，不會拿到攝影機位址或帳密，也不能指定任意 URL（媒體路徑由後端對應）。
 * - HLS 播放清單與所有子資源都經權杖檢查；播放清單另外確認登入 Session 仍有效（登出或撤權後無法續播）。
 * - WebRTC（WHEP）由後端轉送 SDP；媒體走媒體服務的 UDP，無法連通時前端自動改用 HLS。
 * - 測試／預覽用暫時路徑，有時限與並發上限，不錄影、不留下永久設定，也不影響正在播放的正式來源。
 */
@Injectable()
export class VideoLiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoLiveService.name);
  private readonly tests = new Map<string, SourceTest>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly media: MediaMtxClient, private readonly config: VideoConfigService, private readonly auth: AuthService) {}

  onModuleInit() {
    if (!videoConfig().enabled || videoConfig().role === 'worker') return;
    this.timer = setInterval(() => void this.cleanupTests(), 15_000);
    // 重啟後清掉上一次留下的測試路徑
    setTimeout(() => void this.cleanupTests(true), 3_000);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const test of this.tests.values()) await this.media.deletePath(test.mediaPath).catch(() => undefined);
  }

  private token(kind: VideoToken['kind'], sub: string, user: AuthUser, req: Request, ttl: number, extra: Record<string, unknown> = {}) {
    const exp = Date.now() + ttl;
    return { token: signToken({ kind, sub, sid: sessionHash(readCookie(req)), uid: user.id, exp, ...extra }), expiresAt: exp };
  }

  /** 取得即時播放資訊：WebRTC 優先、HLS 備援 */
  async createLiveSession(sourceId: string, user: AuthUser, req: Request) {
    const { source, revision } = await this.config.revisionFor(sourceId);
    if (!source.enabled) throw new BadRequestException('來源已停用');
    const { token, expiresAt } = this.token('live', revision.mediaPath, user, req, LIVE_TTL_MS, { src: source.id });
    return {
      sourceId,
      expiresAt,
      hlsUrl: `/syncdrive-api/video/live/${token}/index.m3u8`,
      whepUrl: `/syncdrive-api/video/live/${token}/whep`,
      status: source.actualStatus ?? {},
    };
  }

  // ── 測試／預覽 ───────────────────────────────────────
  private async cleanupTests(all = false) {
    const now = Date.now();
    for (const [id, test] of this.tests) {
      if (test.expiresAt < now) {
        this.tests.delete(id);
        await this.media.deletePath(test.mediaPath).catch(() => undefined);
      }
    }
    if (all) {
      try {
        const paths = await this.media.listConfigPaths();
        for (const p of paths) if (p.name.startsWith(TEST_PATH_PREFIX) && ![...this.tests.values()].some((t) => t.mediaPath === p.name)) await this.media.deletePath(p.name);
      } catch {
        /* 媒體服務不在：下次再清 */
      }
    }
  }

  async createTest(input: { connection?: ConnectionInput; sourceId?: unknown }, user: AuthUser, req: Request) {
    if ([...this.tests.values()].filter((t) => t.expiresAt > Date.now()).length >= SOURCE_TEST_CONCURRENCY) throw new BadRequestException('同時進行的測試太多，請稍後再試或先關閉其他預覽');
    const settings = await this.config.settings();
    let address: SourceAddress;
    let password: string | null;
    if (input.sourceId && !input.connection) {
      const { revision } = await this.config.revisionFor(String(input.sourceId));
      address = addressOf(revision);
      password = decryptSecret(revision.secretCiphertext);
    } else {
      let previous: VideoSourceRevision | null = null;
      if (input.sourceId) previous = (await this.config.revisionFor(String(input.sourceId))).revision;
      const resolved = await this.config.resolveConnection(input.connection, settings.allowedNetworks, previous);
      address = resolved.address;
      password = resolved.secret.kind === 'set' ? resolved.secret.value : resolved.secret.kind === 'keep' && previous ? decryptSecret(previous.secretCiphertext) : null;
    }
    const check = await checkHostAllowed(address.host, settings.allowedNetworks);
    if (!check.ok) throw new BadRequestException(check.reason);
    const masked = maskedSourceUrl(address, Boolean(password));
    // RTSP 先直接診斷，錯誤訊息可以分辨帳密錯誤、路徑不存在、逾時
    if (address.protocol === 'rtsp' || address.protocol === 'rtsps') {
      const ip = check.addresses[0];
      const probe = await probeRtsp({ host: ip, port: address.port ?? defaultPort(address.protocol), tls: address.protocol === 'rtsps', url: buildSourceUrl({ ...address, username: null }, null), username: address.username, password });
      if (!probe.ok) return { id: null, status: 'failed' as const, error: probe.message, maskedUrl: masked, tracks: [] };
    }
    const id = randomUUID();
    const mediaPath = `${TEST_PATH_PREFIX}${id.replace(/-/g, '')}`;
    const pinned = ['rtsp', 'rtmp', 'srt'].includes(address.protocol) ? check.addresses[0] : undefined;
    try {
      await this.media.addPath(mediaPath, { source: buildSourceUrl(address, password, pinned), sourceOnDemand: false, record: false, rtspTransport: 'tcp' });
    } catch {
      throw new ServiceUnavailableException('影像服務暫時無法使用，請稍後再試');
    }
    const test: SourceTest = { id, mediaPath, userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SOURCE_TEST_TTL_MS, status: 'connecting', error: null, tracks: [], maskedUrl: masked };
    this.tests.set(id, test);
    // 最多等 8 秒看是否接上；沒接上也回傳，前端可繼續查詢狀態
    for (let i = 0; i < 16; i += 1) {
      const rt = await this.media.getRuntimePath(mediaPath).catch(() => null);
      if (rt?.ready) {
        test.status = 'ready';
        test.tracks = rt.tracks;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (test.status !== 'ready') {
      test.status = 'failed';
      test.error = '連線逾時或來源格式無法播放：請確認位址、帳號密碼與影像編碼';
    }
    return this.presentTest(test, user, req);
  }

  private presentTest(test: SourceTest, user: AuthUser, req: Request) {
    const preview = test.status === 'ready' ? this.token('test', test.mediaPath, user, req, Math.max(1_000, test.expiresAt - Date.now())) : null;
    return {
      id: test.id,
      status: test.status,
      error: test.error,
      tracks: test.tracks,
      maskedUrl: test.maskedUrl,
      expiresAt: test.expiresAt,
      hlsUrl: preview ? `/syncdrive-api/video/live/${preview.token}/index.m3u8` : null,
      whepUrl: preview ? `/syncdrive-api/video/live/${preview.token}/whep` : null,
    };
  }

  async getTest(id: string, user: AuthUser, req: Request) {
    const test = this.tests.get(id);
    if (!test || test.userId !== user.id || test.expiresAt < Date.now()) throw new NotFoundException('測試已結束，請重新測試');
    if (test.status !== 'ready') {
      const rt = await this.media.getRuntimePath(test.mediaPath).catch(() => null);
      if (rt?.ready) {
        test.status = 'ready';
        test.error = null;
        test.tracks = rt.tracks;
      }
    }
    return this.presentTest(test, user, req);
  }

  async deleteTest(id: string, user: AuthUser) {
    const test = this.tests.get(id);
    if (!test || test.userId !== user.id) return { deleted: true };
    this.tests.delete(id);
    await this.media.deletePath(test.mediaPath).catch(() => undefined);
    return { deleted: true };
  }

  // ── 代理 ─────────────────────────────────────────────
  /** 驗證播放權杖；播放清單另外確認 Session（登出、停權、撤權後不能續播） */
  async authorize(token: string, req: Request, checkSession: boolean): Promise<VideoToken> {
    const payload = verifyToken(token, 'live') ?? verifyToken(token, 'test');
    if (!payload) throw new ForbiddenException('播放授權已過期，請重新開啟畫面');
    if (checkSession) {
      const cookie = readCookie(req);
      if (sessionHash(cookie) !== payload.sid) throw new ForbiddenException('播放授權與登入狀態不符');
      const session = await this.auth.authenticate(cookie);
      if (!session || session.user.id !== payload.uid || !session.user.permissions.includes('events.video.view')) throw new ForbiddenException('權限不足');
    }
    if (payload.kind === 'test' && ![...this.tests.values()].some((t) => t.mediaPath === payload.sub && t.expiresAt > Date.now())) throw new ForbiddenException('預覽已結束');
    return payload;
  }

  /** HLS：播放清單與分段都經過這裡（串流轉送，不整段讀進記憶體） */
  async proxyHls(token: string, file: string, req: Request, res: Response) {
    if (!SAFE_FILE.test(file)) throw new NotFoundException();
    const payload = await this.authorize(token, req, file.endsWith('.m3u8'));
    const target = new URL(`${videoConfig().hlsUrl}/${payload.sub}/${file}`);
    for (const [key, value] of Object.entries(req.query)) if (typeof value === 'string' && /^_HLS_(msn|part|skip)$/.test(key)) target.searchParams.set(key, value);
    await this.pipe(target, 'GET', req, res, null);
  }

  /** WebRTC（WHEP）：轉送 SDP offer／answer 與 ICE 更新 */
  async proxyWhep(token: string, rest: string, req: Request, res: Response, body: string | null) {
    if (rest && !SAFE_FILE.test(rest)) throw new NotFoundException();
    const payload = await this.authorize(token, req, req.method === 'POST');
    const target = new URL(`${videoConfig().webrtcUrl}/${payload.sub}/whep${rest ? `/${rest}` : ''}`);
    await this.pipe(target, req.method, req, res, body, (location) => {
      // 媒體服務回的 session 位置改寫成本系統的權杖網址
      const tail = location.split('/whep/')[1];
      return tail ? `/syncdrive-api/video/live/${token}/whep/${tail}` : null;
    });
  }

  private pipe(target: URL, method: string, req: Request, res: Response, body: string | null, rewriteLocation?: (l: string) => string | null) {
    const { user, password } = videoConfig();
    return new Promise<void>((resolve) => {
      const headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
      for (const h of ['content-type', 'if-match', 'range', 'accept']) if (req.headers[h]) headers[h] = String(req.headers[h]);
      if (body !== null) headers['content-length'] = String(Buffer.byteLength(body));
      const upstream = httpRequest(target, { method, headers, timeout: 15_000 }, (up: IncomingMessage) => {
        res.status(up.statusCode ?? 502);
        for (const h of ['content-type', 'content-length', 'cache-control', 'etag', 'accept-patch', 'link', 'content-range', 'accept-ranges']) if (up.headers[h]) res.setHeader(h, up.headers[h] as string);
        const location = up.headers.location;
        if (location && rewriteLocation) {
          const next = rewriteLocation(location);
          if (next) res.setHeader('Location', next);
        }
        up.pipe(res);
        up.on('end', resolve);
        up.on('error', () => resolve());
      });
      upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
      upstream.on('error', () => {
        if (!res.headersSent) res.status(502).json({ message: '影像服務暫時無法連線' });
        resolve();
      });
      req.on('close', () => upstream.destroy());
      if (body !== null) upstream.write(body);
      upstream.end();
    });
  }
}
