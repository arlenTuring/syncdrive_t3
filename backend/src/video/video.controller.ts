import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PublicEndpoint, RequirePermission, type AuthenticatedRequest } from '../access-control/access.guard';
import { AuditAction } from '../audit/audit-action.decorator';
import { VideoConfigService } from './video-config.service';
import { VideoHistoryService } from './video-history.service';
import { VideoLiveService } from './video-live.service';
import { VideoStorageService } from './video-storage.service';
import { videoConfig } from './video.config';
import { safeEqual } from './video-secrets';

const user = (req: AuthenticatedRequest) => {
  if (!req.authUser) throw new ForbiddenException('請先登入');
  return req.authUser;
};

/**
 * 影像監控：標籤頁、格子、來源、全域預設、連線範圍、測試／預覽與即時播放。
 * 檢視需要 events.video.view；修改連線與標籤需要 events.video.configure。
 */
@ApiTags('Video')
@Controller('syncdrive-api/video')
@RequirePermission('events.video.view')
export class VideoController {
  constructor(
    private readonly config: VideoConfigService,
    private readonly live: VideoLiveService,
    private readonly storage: VideoStorageService,
    private readonly history: VideoHistoryService,
  ) {}

  @Get('bootstrap')
  @ApiOperation({ summary: '監控頁初始資料：標籤與格子、來源（遮蔽帳密）、全域預設（不含密碼）、連線範圍' })
  async bootstrap() {
    const [tabs, sources, defaults, settings, storage] = await Promise.all([this.config.listTabs(), this.config.listSources(), this.config.getDefaults(), this.config.settings(), this.storage.status().catch(() => null)]);
    return { tabs, sources, defaults, settings: { allowedNetworks: settings.allowedNetworks, maxTabs: settings.maxTabs, maxSources: settings.maxSources, version: settings.version }, storage };
  }

  // ── 標籤與格子 ──
  @Get('tabs')
  tabs() {
    return this.config.listTabs();
  }

  @Post('tabs')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_TAB_CREATE')
  createTab(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.createTab(body ?? {}, user(req));
  }

  @Post('tabs/reorder')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_TAB_REORDER')
  reorder(@Body() body: { ids?: unknown }) {
    return this.config.reorderTabs(body?.ids);
  }

  @Get('tabs/:id/tile-count-preview')
  tileCountPreview(@Param('id') id: string, @Query('tileCount') tileCount: string) {
    return this.config.previewTileCount(id, tileCount);
  }

  @Patch('tabs/:id')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_TAB_UPDATE')
  updateTab(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.config.updateTab(id, body ?? {});
  }

  @Delete('tabs/:id')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_TAB_DELETE')
  deleteTab(@Param('id') id: string, @Query('expectedVersion') expected: string) {
    return this.config.deleteTab(id, expected);
  }

  @Post('tabs/:id/duplicate')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_TAB_CREATE')
  duplicate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.config.duplicateTab(id, user(req));
  }

  @Put('tabs/:id/tiles')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_TILES_SAVE')
  saveTiles(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.config.saveTiles(id, body ?? {});
  }

  // ── 全域預設與批次套用 ──
  @Get('defaults')
  defaults() {
    return this.config.getDefaults();
  }

  @Put('defaults')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_DEFAULTS_UPDATE', { detail: (req) => ({ fields: Object.keys((req.body as object) ?? {}) }) })
  updateDefaults(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.updateDefaults(body ?? {}, user(req));
  }

  @Post('defaults/preview-apply')
  @RequirePermission('events.video.configure')
  previewApply(@Body() body: Record<string, unknown>) {
    return this.config.previewApply(body ?? {});
  }

  @Post('defaults/apply')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_DEFAULTS_APPLY', { detail: (req, result) => ({ scope: (req.body as Record<string, unknown>)?.scope, overwrite: (req.body as Record<string, unknown>)?.overwrite, applied: (result as { applied?: unknown[] })?.applied?.length }) })
  apply(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.apply(body ?? {}, user(req));
  }

  // ── 連線範圍 ──
  @Get('settings')
  async settings() {
    const s = await this.config.settings();
    return { allowedNetworks: s.allowedNetworks, maxTabs: s.maxTabs, maxSources: s.maxSources, version: s.version };
  }

  @Put('settings')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_SETTINGS_UPDATE', { detail: (req) => ({ allowedNetworks: (req.body as Record<string, unknown>)?.allowedNetworks }) })
  updateSettings(@Body() body: Record<string, unknown>) {
    return this.config.updateSettings(body ?? {});
  }

  // ── 來源 ──
  @Get('sources')
  sources(@Query('includeDeleted') includeDeleted?: string) {
    return this.config.listSources(includeDeleted === 'true');
  }

  @Post('sources')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_SOURCE_CREATE', { target: (_req, result) => ({ id: (result as { id?: string })?.id, name: (result as { name?: string })?.name }) })
  async createSource(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const id = await this.config.createSource(body ?? {}, user(req));
    return this.config.getSource(id);
  }

  @Get('sources/:id')
  source(@Param('id') id: string) {
    return this.config.getSource(id);
  }

  @Patch('sources/:id')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_SOURCE_UPDATE')
  updateSource(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.updateSource(id, body ?? {}, user(req));
  }

  @Delete('sources/:id')
  @RequirePermission('events.video.configure')
  @AuditAction('VIDEO_SOURCE_DELETE')
  deleteSource(@Param('id') id: string, @Query('expectedVersion') expected: string) {
    return this.config.deleteSource(id, expected);
  }

  // ── 測試／預覽與即時 ──
  @Post('source-tests')
  @RequirePermission('events.video.configure')
  @ApiOperation({ summary: '暫時測試連線並預覽（不錄影、有時限）' })
  createTest(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.live.createTest(body ?? {}, user(req), req);
  }

  @Get('source-tests/:id')
  @RequirePermission('events.video.configure')
  getTest(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.live.getTest(id, user(req), req);
  }

  @Delete('source-tests/:id')
  @RequirePermission('events.video.configure')
  deleteTest(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.live.deleteTest(id, user(req));
  }

  @Post('sources/:id/live-sessions')
  @ApiOperation({ summary: '取得即時播放資訊（WebRTC 優先、HLS 備援；短效權杖）' })
  liveSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.live.createLiveSession(id, user(req), req);
  }

  // ── 儲存與錄影政策 ──
  @Get('storage-status')
  @RequirePermission('events.video.view', 'events.video-history.view')
  @ApiOperation({ summary: '錄影容量：用量、預算、最低剩餘、預估可存天數、最早可用時間、是否暫停' })
  storageStatus() {
    return this.storage.status();
  }

  @Get('storage-policy')
  @RequirePermission('events.video.view', 'events.video-history.view')
  async storagePolicy() {
    return (await this.storage.status()).policy;
  }

  @Put('storage-policy')
  @RequirePermission('events.video.recording-manage')
  @AuditAction('VIDEO_STORAGE_POLICY', { detail: (req) => ({ ...(req.body as object) }) })
  updateStoragePolicy(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.storage.updatePolicy(body ?? {}, user(req));
  }

  // ── 歷史影像 ──
  @Get('recordings/availability')
  @RequirePermission('events.video-history.view')
  @ApiOperation({ summary: '可用區間與缺段（sourceIds 最多 12、區間最長 31 天）' })
  availability(@Query() query: Record<string, unknown>) {
    return this.history.availability(query);
  }

  @Get('recordings/calendar')
  @RequirePermission('events.video-history.view')
  calendar(@Query() query: Record<string, unknown>) {
    return this.history.calendar(query);
  }

  @Get('recordings')
  @RequirePermission('events.video-history.view')
  @ApiOperation({ summary: '錄影片段清單（分頁；支援舊的 vehicleCode 條件，以當時來源版本的載具關聯查）' })
  recordings(@Query() query: Record<string, unknown>) {
    return this.history.recordings(query);
  }

  @Post('playback-sessions')
  @RequirePermission('events.video-history.view')
  @ApiOperation({ summary: '建立歷史播放（最多 12 來源、24 小時）' })
  playback(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.history.createPlayback(body ?? {}, user(req), req);
  }

  @Post('exports')
  @RequirePermission('events.video-history.export')
  @AuditAction('VIDEO_EXPORT', { detail: (req) => ({ ...(req.body as object) }), correlation: (_req, result) => (result as { id?: string })?.id })
  createExport(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.history.createExport(body ?? {}, user(req));
  }

  @Get('jobs/:id')
  @RequirePermission('events.video-history.view', 'events.video-history.export', 'events.video-history.delete')
  job(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.history.job(id, user(req));
  }

  @Post('recordings/delete-preview')
  @RequirePermission('events.video-history.delete')
  deletePreview(@Body() body: Record<string, unknown>) {
    return this.history.deletePreview(body ?? {});
  }

  @Post('recordings/deletions')
  @RequirePermission('events.video-history.delete')
  @AuditAction('VIDEO_RECORDING_DELETE', { detail: (req) => ({ ...(req.body as object) }), correlation: (_req, result) => (result as { id?: string })?.id })
  deletion(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.history.createDeletion(body ?? {}, user(req));
  }

  @Post('recordings/protect')
  @RequirePermission('events.video.recording-manage')
  @AuditAction('VIDEO_RECORDING_PROTECT', { detail: (req) => ({ ...(req.body as object) }) })
  protect(@Body() body: Record<string, unknown>) {
    return this.history.protect(body ?? {});
  }
}

/** 歷史播放與下載：短效權杖網址（綁帳號 Session、來源與時間窗），每次都重新確認權限 */
@ApiTags('Video')
@Controller('syncdrive-api/video')
@PublicEndpoint()
export class VideoMediaController {
  constructor(private readonly history: VideoHistoryService, private readonly storage: VideoStorageService) {}

  @Get('playback/:token/manifest')
  manifest(@Param('token') token: string, @Req() req: Request) {
    return this.history.manifest(token, req);
  }

  @Get('playback/:token/segments/:id')
  async segment(@Param('token') token: string, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.history.sendSegment(token, id, req, res);
  }

  @Get('exports/:token/:name')
  async download(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await this.history.download(token, req, res);
  }

  /** 媒體服務的片段完成通知（只接受部署設定的共享密鑰；不經瀏覽器） */
  @Get('internal/segment-complete')
  async segmentComplete(@Req() req: Request, @Query('path') path: string, @Query('segment') segment: string, @Query('duration') duration: string) {
    const secret = videoConfig().hookSecret;
    const given = String(req.headers['x-video-hook-secret'] ?? '');
    if (!secret || !safeEqual(given, secret)) throw new ForbiddenException();
    const id = await this.storage.indexFromHook(String(path ?? ''), String(segment ?? ''), String(duration ?? ''));
    return { indexed: Boolean(id) };
  }
}

function readRaw(req: Request, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new ForbiddenException('內容太大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const joinParam = (v: unknown) => (Array.isArray(v) ? v.join('/') : String(v ?? ''));

/**
 * 播放代理：瀏覽器以短效權杖網址取得 HLS 與 WebRTC，不需要也拿不到攝影機位址。
 * 權杖本身就是授權（綁帳號 Session 與到期），所以不走一般的權限守衛；播放清單仍會重新確認 Session。
 */
@ApiTags('Video')
@Controller('syncdrive-api/video/live')
@PublicEndpoint()
export class VideoLiveProxyController {
  constructor(private readonly live: VideoLiveService) {}

  @Post(':token/whep')
  async whepOffer(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const body = typeof req.body === 'string' ? req.body : await readRaw(req);
    await this.live.proxyWhep(token, '', req, res, body);
  }

  @Patch(':token/whep/*rest')
  async whepPatch(@Param('token') token: string, @Param('rest') rest: unknown, @Req() req: Request, @Res() res: Response) {
    await this.live.proxyWhep(token, joinParam(rest), req, res, await readRaw(req));
  }

  @Delete(':token/whep/*rest')
  async whepDelete(@Param('token') token: string, @Param('rest') rest: unknown, @Req() req: Request, @Res() res: Response) {
    await this.live.proxyWhep(token, joinParam(rest), req, res, null);
  }

  @Get(':token/*file')
  async hls(@Param('token') token: string, @Param('file') file: unknown, @Req() req: Request, @Res() res: Response) {
    await this.live.proxyHls(token, joinParam(file), req, res);
  }
}
