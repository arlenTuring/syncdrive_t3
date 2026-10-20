import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PublicEndpoint, RequirePermission, type AuthenticatedRequest } from '../access-control/access.guard';
import { AuditAction } from '../audit/audit-action.decorator';
import { DataSource } from 'typeorm';
import { VideoArchiveService } from './video-archive.service';
import { probeCapabilities } from './video-capabilities';
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

const VIEW = 'events.video.view';
const CONFIGURE = 'events.video.configure';
const RECORDING = 'events.video.recording-manage';
const HISTORY = 'events.video-history.view';

const perm = (req: AuthenticatedRequest) => ({ canManageRecording: user(req).permissions.includes(RECORDING) });

/**
 * 影像：兩個頁面共用的 API。
 * - 即時影像監控：監控標籤頁、版面、格子綁定來源（events.video.view 看、events.video.configure 改）。
 * - 影像資源管理：來源清單與設定（configure）、儲存錄影與全域儲存（recording-manage）、歷史（events.video-history.*）。
 * 每個方法都明確標示權限（方法上的設定會取代類別預設）。
 */
@ApiTags('Video')
@Controller('syncdrive-api/video')
@RequirePermission(VIEW)
export class VideoController {
  constructor(
    private readonly config: VideoConfigService,
    private readonly live: VideoLiveService,
    private readonly storage: VideoStorageService,
    private readonly history: VideoHistoryService,
    private readonly archive: VideoArchiveService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('bootstrap')
  @RequirePermission(VIEW)
  @ApiOperation({ summary: '即時影像監控初始資料：監控標籤頁與版面、安全來源選項（不含任何連線資訊）、錄影容量短狀態' })
  async bootstrap() {
    const [tabs, options, storage] = await Promise.all([this.config.listTabs(), this.config.sourceOptions({}), this.storage.status().catch(() => null)]);
    return { tabs, sources: options.items, storage: storage && { paused: storage.paused, usagePct: storage.usagePct, recordingSources: storage.recordingSources } };
  }

  // ── 監控標籤頁與版面 ──
  @Get('tabs')
  @RequirePermission(VIEW)
  tabs() {
    return this.config.listTabs();
  }

  @Post('tabs')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_TAB_CREATE', { target: (_req, result) => ({ id: (result as { id?: string })?.id, name: (result as { name?: string })?.name }) })
  @ApiOperation({ summary: '新增監控標籤頁：名稱＋版面草稿（1–12 格，0–10000 正規化座標，沒有來源也可存）' })
  createTab(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.createTab(body ?? {}, user(req));
  }

  @Post('tabs/reorder')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_TAB_REORDER')
  reorder(@Body() body: { ids?: unknown }) {
    return this.config.reorderTabs(body?.ids);
  }

  @Patch('tabs/:id')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_TAB_UPDATE')
  updateTab(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.config.updateTab(id, body ?? {});
  }

  @Put('tabs/:id/layout')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_LAYOUT_SAVE', { target: (req) => ({ id: (req.params as Record<string, string>).id }), detail: (req) => ({ tiles: Array.isArray((req.body as Record<string, unknown>)?.tiles) ? ((req.body as Record<string, unknown>).tiles as unknown[]).length : null }) })
  @ApiOperation({ summary: '保存版面：expectedVersion＋完整正規化矩形；同一交易增刪改格子，檢查邊界與重疊；不改來源綁定' })
  saveLayout(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.config.saveLayout(id, body ?? {});
  }

  @Patch('tabs/:id/tiles/:tileId/source')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_TILE_BIND', { target: (req) => ({ id: (req.params as Record<string, string>).tileId }), detail: (req) => ({ tabId: (req.params as Record<string, string>).id, sourceId: (req.body as Record<string, unknown>)?.sourceId ?? null }) })
  @ApiOperation({ summary: '只換這一格的來源（或清除）；不改版面、不改來源錄影' })
  bindTile(@Param('id') id: string, @Param('tileId') tileId: string, @Body() body: Record<string, unknown>) {
    return this.config.bindTileSource(id, tileId, body ?? {});
  }

  @Delete('tabs/:id')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_TAB_DELETE')
  deleteTab(@Param('id') id: string, @Query('expectedVersion') expected: string) {
    return this.config.deleteTab(id, expected);
  }

  @Post('tabs/:id/duplicate')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_TAB_CREATE')
  duplicate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.config.duplicateTab(id, user(req));
  }

  @Put('tabs/:id/tiles')
  @RequirePermission(CONFIGURE)
  @ApiOperation({ summary: '已停用：舊的整頁格子保存（含每格錄影開關）；回 400 CONTRACT_CHANGED' })
  saveTiles() {
    return this.config.saveTilesDeprecated();
  }

  // ── 全域預設與批次套用（影像資源管理 › 進階設定；作用對象是來源） ──
  @Get('defaults')
  @RequirePermission(CONFIGURE)
  defaults() {
    return this.config.getDefaults();
  }

  @Put('defaults')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_DEFAULTS_UPDATE', { detail: (req) => ({ fields: Object.keys((req.body as object) ?? {}) }) })
  updateDefaults(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.updateDefaults(body ?? {}, user(req));
  }

  @Post('defaults/preview-apply')
  @RequirePermission(CONFIGURE)
  @ApiOperation({ summary: '預覽全域預設套用到來源的差異（scope：sources／tags／all）' })
  previewApply(@Body() body: Record<string, unknown>) {
    return this.config.previewApply(body ?? {});
  }

  @Post('defaults/apply')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_DEFAULTS_APPLY', { detail: (req, result) => ({ scope: (req.body as Record<string, unknown>)?.scope, applied: (result as { applied?: unknown[] })?.applied?.length }) })
  apply(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.apply(body ?? {}, user(req));
  }

  // ── 連線範圍 ──
  @Get('settings')
  @RequirePermission(CONFIGURE)
  async settings() {
    const s = await this.config.settings();
    return { allowedNetworks: s.allowedNetworks, maxTabs: s.maxTabs, maxSources: s.maxSources, version: s.version };
  }

  @Put('settings')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_SETTINGS_UPDATE', { detail: (req) => ({ allowedNetworks: (req.body as Record<string, unknown>)?.allowedNetworks }) })
  updateSettings(@Body() body: Record<string, unknown>) {
    return this.config.updateSettings(body ?? {});
  }

  // ── 來源（影像資源管理） ──
  @Get('sources')
  @RequirePermission(CONFIGURE, RECORDING)
  @ApiOperation({ summary: '來源清單：分頁（page、pageSize）、q、tags（逗號分隔）、enabled、online（online／offline／unknown／disabled）；含 checkedAt／stale，不含密碼、不建立播放' })
  sources(@Query() query: Record<string, unknown>) {
    return this.config.querySources(query ?? {});
  }

  @Get('source-tags')
  @RequirePermission(VIEW, CONFIGURE, RECORDING, HISTORY)
  sourceTags() {
    return this.config.sourceTags();
  }

  @Get('source-options')
  @RequirePermission(VIEW, CONFIGURE, HISTORY)
  @ApiOperation({ summary: '安全來源選項（名稱、標籤、載具、位置、啟用與狀態）；給監控格子選單與歷史查詢，不含任何連線資訊' })
  sourceOptions(@Query() query: Record<string, unknown>) {
    return this.config.sourceOptions(query ?? {});
  }

  @Post('sources')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_SOURCE_CREATE', { target: (_req, result) => ({ id: (result as { id?: string })?.id, name: (result as { name?: string })?.name }), detail: (req) => ({ recordingEnabled: (req.body as Record<string, unknown>)?.recordingEnabled ?? true, tags: (req.body as Record<string, unknown>)?.tags }) })
  @ApiOperation({ summary: '新增來源；儲存錄影預設 true（需要錄影管理權限，否則整個拒絕）' })
  async createSource(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const id = await this.config.createSource(body ?? {}, user(req), perm(req));
    return this.config.getSource(id);
  }

  @Get('sources/:id')
  @RequirePermission(CONFIGURE, RECORDING)
  source(@Param('id') id: string) {
    return this.config.getSource(id);
  }

  @Patch('sources/:id')
  @RequirePermission(CONFIGURE, RECORDING)
  @AuditAction('VIDEO_SOURCE_UPDATE', { target: (req) => ({ id: (req.params as Record<string, string>).id }), detail: (req) => ({ fields: Object.keys((req.body as object) ?? {}).filter((k) => k !== 'connection'), connection: Boolean((req.body as Record<string, unknown>)?.connection), recordingEnabled: (req.body as Record<string, unknown>)?.recordingEnabled }) })
  updateSource(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    // 只有錄影管理權限的人只能改「儲存錄影」，不能動連線與其他設定
    if (!user(req).permissions.includes(CONFIGURE) && Object.keys(body ?? {}).some((k) => !['recordingEnabled', 'expectedVersion'].includes(k))) {
      throw new ForbiddenException('只能變更「儲存錄影」；修改來源設定需要影像設定權限');
    }
    return this.config.updateSource(id, body ?? {}, user(req), perm(req));
  }

  @Patch('sources/:id/enabled')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_SOURCE_ENABLE', { target: (req) => ({ id: (req.params as Record<string, string>).id }), detail: (req) => ({ enabled: (req.body as Record<string, unknown>)?.enabled }) })
  @ApiOperation({ summary: '清單直接啟停（expectedVersion＋enabled）；回設定已接受與目前實際狀態，網路協調非同步' })
  setEnabled(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.config.setEnabled(id, body ?? {});
  }

  @Post('sources/:id/duplicate')
  @RequirePermission(CONFIGURE)
  @HttpCode(201)
  @AuditAction('VIDEO_SOURCE_DUPLICATE', { target: (_req, result) => ({ id: (result as { id?: string })?.id, name: (result as { name?: string })?.name }), detail: (req) => ({ from: (req.params as Record<string, string>).id }) })
  @ApiOperation({ summary: '一鍵複製來源（expectedVersion＋requestId 冪等）；新 sourceId／revision／媒體路徑，不複製歷史' })
  duplicateSource(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return this.config.duplicateSource(id, body ?? {}, user(req), perm(req));
  }

  @Get('sources/:id/delete-impact')
  @RequirePermission(CONFIGURE)
  deleteImpact(@Param('id') id: string) {
    return this.config.deleteImpact(id);
  }

  @Delete('sources/:id')
  @RequirePermission(CONFIGURE)
  @AuditAction('VIDEO_SOURCE_DELETE')
  deleteSource(@Param('id') id: string, @Query('expectedVersion') expected: string) {
    return this.config.deleteSource(id, expected);
  }

  // ── 測試／預覽與即時 ──
  @Post('source-tests')
  @RequirePermission(CONFIGURE)
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
  @RequirePermission(VIEW)
  @ApiOperation({ summary: '取得即時播放資訊（WebRTC 優先、HLS 備援；短效權杖）' })
  liveSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.live.createLiveSession(id, user(req), req);
  }

  // ── 儲存與錄影政策 ──
  @Get('storage-status')
  @RequirePermission(VIEW, HISTORY, CONFIGURE, RECORDING)
  @ApiOperation({ summary: '錄影容量：用量、預算、最低剩餘、預估可存天數、最早可用時間、是否暫停' })
  async storageStatus() {
    const status = await this.storage.status();
    const gcs = status.policy.storageType === 'gcs' ? await this.archive.bucketStatus(status.policy.gcsBucket) : null;
    const [{ remote }] = await this.dataSource.query(`SELECT count(*)::int AS remote FROM video_recording_segments WHERE status = 'REMOTE_READY'`);
    return { ...status, gcs, remoteSegments: remote, compression: status.policy.compression.enabled ? await this.archive.compressionStats() : null };
  }

  @Get('capabilities')
  @RequirePermission('events.video.recording-manage')
  @ApiOperation({ summary: '實際偵測：可用編碼器（H.264／HEVC／AV1）、libvmaf、硬體加速、可用儲存位置' })
  capabilities(@Query('refresh') refresh?: string) {
    return probeCapabilities(refresh === '1');
  }

  @Get('storage-policy')
  @RequirePermission(VIEW, HISTORY, CONFIGURE, RECORDING)
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
