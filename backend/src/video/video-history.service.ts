import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, promises as fsp } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { readCookie } from '../access-control/access.guard';
import { AuthService, type AuthUser } from '../access-control/auth.service';
import { VideoJob, VideoRecordingSegment, VideoSource, VideoSourceRevision } from '../database/entities/video.entities';
import { maskedSourceUrl } from './source-address';
import { addressOf } from './video-config.service';
import { sessionHash } from './video-live.service';
import { VideoStorageService } from './video-storage.service';
import { EXPORT_SPAN_MAX_MS, PLAYBACK_SOURCES_MAX, PLAYBACK_SPAN_MAX_MS, videoConfig } from './video.config';
import { signToken, verifyToken, type VideoToken } from './video-secrets';

const PLAYBACK_TTL_MS = 30 * 60_000;
const EXPORT_TTL_MS = 60 * 60_000;
const AVAILABILITY_SPAN_MAX_MS = 31 * 86_400_000;
const MERGE_GAP_MS = 1_500;

export type TimelineItem = {
  kind: 'available' | 'gap' | 'expired' | 'failed' | 'recording';
  from: number;
  to: number;
  protected?: boolean;
  reason?: string | null;
};

const uuid = (raw: unknown, label: string) => {
  const v = String(raw ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new BadRequestException(`${label}不正確`);
  return v;
};

const epoch = (raw: unknown, label: string) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000_000_000_000) throw new BadRequestException(`${label}必須是 epoch 毫秒`);
  return Math.floor(n);
};

/**
 * 歷史影像：可用區間與缺段、播放 session、片段播放（Range／206）、下載任務、刪除與保護。
 *
 * - 只讀索引與需要的片段，不掃整個磁碟、不先拼大影片。
 * - 時間軸用真實狀態：有錄影、缺段、錄製中、已到期、失敗；缺段不拿上一幀假裝。
 * - 播放授權綁帳號 Session、來源與時間窗；manifest 與每個片段都檢查。
 * - 來源被移除或換鏡頭後，仍以穩定 sourceId 查得到舊歷史；載具關聯用當時的來源版本。
 */
@Injectable()
export class VideoHistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoHistoryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly workerId = `video-worker-${randomUUID().slice(0, 8)}`;

  constructor(private readonly dataSource: DataSource, private readonly storage: VideoStorageService, private readonly auth: AuthService) {}

  onModuleInit() {
    const cfg = videoConfig();
    if (!cfg.enabled || cfg.role === 'api') return;
    this.timer = setInterval(() => void this.runJobs(), 3_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private window(fromRaw: unknown, toRaw: unknown, max: number) {
    const from = epoch(fromRaw, '開始時間');
    const to = epoch(toRaw, '結束時間');
    if (to <= from) throw new BadRequestException('結束時間必須晚於開始時間');
    if (to - from > max) throw new BadRequestException(`查詢區間最長 ${Math.round(max / 3_600_000)} 小時`);
    return { from, to };
  }

  private sourceIds(raw: unknown) {
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((v) => String(v).trim()).filter(Boolean);
    if (!list.length) throw new BadRequestException('請選擇影像來源');
    if (list.length > PLAYBACK_SOURCES_MAX) throw new BadRequestException(`一次最多 ${PLAYBACK_SOURCES_MAX} 個來源`);
    return [...new Set(list.map((v) => uuid(v, '影像來源')))];
  }

  /** 依片段算時間軸（半開區間）：相鄰片段合併，中間的空白標缺段 */
  async timeline(sourceId: string, from: number, to: number, recordingNow: boolean): Promise<TimelineItem[]> {
    const segs: Array<{ start_at: string; end_at: string; status: string; protected_until: string | null; failure_reason: string | null }> = await this.dataSource.query(
      `SELECT start_at, end_at, status, protected_until, failure_reason FROM video_recording_segments
        WHERE source_id = $1 AND start_at < $3 AND end_at > $2 AND status <> 'DELETE_PENDING' ORDER BY start_at, id LIMIT 20000`,
      [sourceId, from, to],
    );
    const items: TimelineItem[] = [];
    const now = Date.now();
    const push = (item: TimelineItem) => {
      const last = items[items.length - 1];
      if (last && last.kind === item.kind && item.from - last.to <= MERGE_GAP_MS && Boolean(last.protected) === Boolean(item.protected)) last.to = Math.max(last.to, item.to);
      else items.push(item);
    };
    let cursor = from;
    for (const s of segs) {
      const start = Math.max(from, Number(s.start_at));
      const end = Math.min(to, Number(s.end_at));
      if (start - cursor > MERGE_GAP_MS) push({ kind: 'gap', from: cursor, to: start, reason: '沒有錄影（斷線、未要求錄影或空間不足）' });
      const kind = s.status === 'DELETED' ? 'expired' : s.status === 'FAILED' ? 'failed' : 'available';
      push({ kind, from: start, to: end, protected: s.protected_until !== null && Number(s.protected_until) > now, reason: kind === 'available' ? null : s.failure_reason });
      cursor = Math.max(cursor, end);
    }
    const tail = Math.min(to, now);
    if (tail - cursor > MERGE_GAP_MS) {
      // 來源目前正在錄：最後一段是「錄製中」（尚未完成索引，不宣稱可完整回放）
      if (recordingNow && to >= now - 120_000) push({ kind: 'recording', from: cursor, to: tail, reason: '錄製中，片段完成後可回放' });
      else push({ kind: 'gap', from: cursor, to: tail, reason: '沒有錄影（斷線、未要求錄影或空間不足）' });
    }
    return items;
  }

  /** 這段期間有效的來源版本（載具關聯以當時版本為準） */
  async revisionsIn(sourceId: string, from: number, to: number) {
    const revs = await this.dataSource.query(
      `SELECT * FROM video_source_revisions WHERE source_id = $1 AND valid_from < $3 AND (valid_to IS NULL OR valid_to > $2) ORDER BY valid_from`,
      [sourceId, from, to],
    );
    return revs.map((r: Record<string, any>) => ({
      revisionId: r.id,
      revisionNo: r.revision_no,
      vehicleCode: r.vehicle_code,
      cameraId: r.camera_id,
      location: r.location,
      validFrom: Number(r.valid_from),
      validTo: r.valid_to === null ? null : Number(r.valid_to),
      timestampBasis: r.timestamp_basis,
      maskedUrl: maskedSourceUrl(addressOf({ protocol: r.protocol, host: r.host, port: r.port, path: r.path, query: r.query, username: r.username }), Boolean(r.secret_ciphertext)),
    }));
  }

  async availability(query: Record<string, unknown>) {
    const ids = this.sourceIds(query.sourceIds);
    const { from, to } = this.window(query.from, query.to, AVAILABILITY_SPAN_MAX_MS);
    const sources = await this.dataSource.manager.find(VideoSource, { where: ids.map((id) => ({ id })) });
    if (sources.length !== ids.length) throw new NotFoundException('有影像來源不存在');
    return {
      from,
      to,
      sources: await Promise.all(
        sources.map(async (s) => ({
          sourceId: s.id,
          name: s.name,
          removed: s.deletedAt !== null,
          timeline: await this.timeline(s.id, from, to, Boolean((s.actualStatus as { recording?: boolean })?.recording)),
          revisions: await this.revisionsIn(s.id, from, to),
        })),
      ),
    };
  }

  /** 日曆：有錄影的日期（依網站時區） */
  async calendar(query: Record<string, unknown>) {
    const ids = this.sourceIds(query.sourceIds);
    const { from, to } = this.window(query.from, query.to, 62 * 86_400_000);
    const tz = typeof query.timeZone === 'string' && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(query.timeZone) ? query.timeZone : 'Asia/Taipei';
    const rows = await this.dataSource.query(
      `SELECT DISTINCT to_char(to_timestamp(start_at / 1000.0) AT TIME ZONE $4, 'YYYY-MM-DD') AS day FROM video_recording_segments
        WHERE source_id = ANY($1::uuid[]) AND start_at < $3 AND end_at > $2 AND status IN ('READY', 'REMOTE_READY', 'UPLOADING') ORDER BY 1`,
      [ids, from, to, tz],
    );
    return { days: rows.map((r: { day: string }) => r.day) };
  }

  async recordings(query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const { from, to } = this.window(query.from, query.to, AVAILABILITY_SPAN_MAX_MS);
    const params: unknown[] = [from, to];
    let filter = 's.start_at < $2 AND s.end_at > $1';
    if (query.sourceId) {
      params.push(uuid(query.sourceId, '影像來源'));
      filter += ` AND s.source_id = $${params.length}`;
    }
    // 舊呼叫者相容：以當時版本的載具關聯查
    if (query.vehicleCode) {
      params.push(String(query.vehicleCode).slice(0, 64));
      filter += ` AND r.vehicle_code = $${params.length}`;
    }
    const rows = await this.dataSource.query(
      `SELECT s.id, s.source_id, s.revision_id, s.start_at, s.end_at, s.status, s.bytes, s.protected_until, s.failure_reason, r.vehicle_code, src.name
         FROM video_recording_segments s JOIN video_source_revisions r ON r.id = s.revision_id JOIN video_sources src ON src.id = s.source_id
        WHERE ${filter} ORDER BY s.start_at DESC, s.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM video_recording_segments s JOIN video_source_revisions r ON r.id = s.revision_id WHERE ${filter}`, params);
    return {
      items: rows.map((r: Record<string, any>) => ({ id: r.id, sourceId: r.source_id, sourceName: r.name, revisionId: r.revision_id, vehicleCode: r.vehicle_code, start: Number(r.start_at), end: Number(r.end_at), status: r.status, bytes: r.bytes === null ? null : Number(r.bytes), protectedUntil: r.protected_until === null ? null : Number(r.protected_until), reason: r.failure_reason })),
      total: Number(total),
      page,
      pageSize,
    };
  }

  // ── 播放 ─────────────────────────────────────────────
  async createPlayback(input: { sourceIds?: unknown; from?: unknown; to?: unknown }, user: AuthUser, req: Request) {
    const ids = this.sourceIds(input.sourceIds);
    const { from, to } = this.window(input.from, input.to, PLAYBACK_SPAN_MAX_MS);
    const sources = await this.dataSource.manager.find(VideoSource, { where: ids.map((id) => ({ id })) });
    if (sources.length !== ids.length) throw new NotFoundException('有影像來源不存在');
    const exp = Date.now() + PLAYBACK_TTL_MS;
    return {
      from,
      to,
      expiresAt: exp,
      sessions: sources.map((s) => {
        const token = signToken({ kind: 'playback', sub: s.id, sid: sessionHash(readCookie(req)), uid: user.id, exp, from, to });
        return { sourceId: s.id, name: s.name, manifestUrl: `/syncdrive-api/video/playback/${token}/manifest` };
      }),
    };
  }

  private async authorizePlayback(token: string, req: Request, kind: VideoToken['kind'] = 'playback', permission = 'events.video-history.view') {
    const payload = verifyToken(token, kind);
    if (!payload) throw new ForbiddenException('播放授權已過期，請重新查詢');
    const cookie = readCookie(req);
    if (sessionHash(cookie) !== payload.sid) throw new ForbiddenException('播放授權與登入狀態不符');
    const session = await this.auth.authenticate(cookie);
    if (!session || session.user.id !== payload.uid || !session.user.permissions.includes(permission)) throw new ForbiddenException('權限不足');
    return payload;
  }

  async manifest(token: string, req: Request) {
    const p = await this.authorizePlayback(token, req);
    const from = Number(p.from);
    const to = Number(p.to);
    const source = await this.dataSource.manager.findOne(VideoSource, { where: { id: p.sub } });
    if (!source) throw new NotFoundException('找不到影像來源');
    const segs = await this.dataSource.manager
      .createQueryBuilder(VideoRecordingSegment, 's')
      .where('s.source_id = :id AND s.start_at < :to AND s.end_at > :from AND s.status IN (:...ok)', { id: p.sub, from, to, ok: ['READY', 'REMOTE_READY', 'UPLOADING'] })
      .orderBy('s.start_at', 'ASC').addOrderBy('s.id', 'ASC').limit(5000).getMany();
    return {
      sourceId: source.id,
      name: source.name,
      from,
      to,
      expiresAt: p.exp,
      segments: segs.map((s) => ({ id: s.id, revisionId: s.revisionId, start: s.startAt, end: s.endAt, codec: s.codec, timestampBasis: s.timestampBasis, url: `/syncdrive-api/video/playback/${token}/segments/${s.id}` })),
      timeline: await this.timeline(source.id, from, to, Boolean((source.actualStatus as { recording?: boolean })?.recording)),
      revisions: await this.revisionsIn(source.id, from, to),
    };
  }

  /** 片段檔：Range／206 串流；正式環境交給 nginx（X-Accel-Redirect），不讓 Node 讀整段進記憶體 */
  async sendSegment(token: string, segmentId: string, req: Request, res: Response) {
    const p = await this.authorizePlayback(token, req);
    const seg = await this.dataSource.manager.findOne(VideoRecordingSegment, { where: { id: uuid(segmentId, '片段') } });
    if (!seg || seg.sourceId !== p.sub || seg.startAt >= Number(p.to) || seg.endAt <= Number(p.from)) throw new NotFoundException('片段不在授權範圍內');
    if (!['READY', 'REMOTE_READY', 'UPLOADING'].includes(seg.status)) throw new NotFoundException('片段已到期或無法播放');
    this.storage.lease([seg.id]);
    this.sendFile(this.storage.localPath(seg.segmentKey), seg.segmentKey, res, 'video/mp4', null);
  }

  private sendFile(full: string, key: string, res: Response, type: string, downloadName: string | null) {
    const prefix = videoConfig().accelRedirectPrefix;
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (downloadName) res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    if (prefix) {
      res.setHeader('Content-Type', type);
      res.setHeader('X-Accel-Redirect', `${prefix.replace(/\/$/, '')}/${key}`);
      res.end();
      return;
    }
    res.sendFile(full, { headers: { 'Content-Type': type }, acceptRanges: true }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: '找不到影片檔' });
    });
  }

  // ── 下載 ─────────────────────────────────────────────
  async createExport(input: { sourceId?: unknown; from?: unknown; to?: unknown }, user: AuthUser) {
    const sourceId = uuid(input.sourceId, '影像來源');
    const { from, to } = this.window(input.from, input.to, EXPORT_SPAN_MAX_MS);
    const revs: VideoSourceRevision[] = await this.dataSource.manager
      .createQueryBuilder(VideoSourceRevision, 'r')
      .where('r.source_id = :id AND r.valid_from < :to AND (r.valid_to IS NULL OR r.valid_to > :from)', { id: sourceId, from, to })
      .getMany();
    if (!revs.length) throw new NotFoundException('這段期間沒有這個來源的錄影');
    if (revs.length > 1) throw new BadRequestException('這段期間來源設定有變更，請分段下載');
    const [{ n }] = await this.dataSource.query(`SELECT count(*)::int AS n FROM video_recording_segments WHERE source_id = $1 AND start_at < $3 AND end_at > $2 AND status = 'READY'`, [sourceId, from, to]);
    if (!Number(n)) throw new NotFoundException('這段期間沒有可下載的錄影');
    const now = Date.now();
    const job = await this.dataSource.manager.save(VideoJob, this.dataSource.manager.create(VideoJob, {
      kind: 'export', dedupeKey: null, status: 'queued', payload: { sourceId, mediaPath: revs[0].mediaPath, from, to, mode: 'fast' }, result: null, progress: '0', attempts: 0, maxAttempts: 2,
      leaseOwner: null, leaseUntil: null, error: null, createdBy: user.id, createdAt: now, updatedAt: now, expiresAt: now + EXPORT_TTL_MS,
    }));
    return this.presentJob(job, user);
  }

  async job(id: string, user: AuthUser) {
    const job = await this.dataSource.manager.findOne(VideoJob, { where: { id: uuid(id, '工作') } });
    if (!job || (job.createdBy !== user.id && job.kind === 'export')) throw new NotFoundException('找不到工作');
    return this.presentJob(job, user);
  }

  private presentJob(job: VideoJob, user: AuthUser) {
    const result = job.result as { fileName?: string; bytes?: number } | null;
    const ready = job.kind === 'export' && job.status === 'succeeded' && (job.expiresAt ?? 0) > Date.now();
    const token = ready ? signToken({ kind: 'export', sub: job.id, sid: '', uid: user.id, exp: job.expiresAt! }) : null;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: Number(job.progress),
      error: job.error,
      result: job.result,
      expiresAt: job.expiresAt,
      downloadUrl: token ? `/syncdrive-api/video/exports/${token}/${encodeURIComponent(result?.fileName ?? 'video.mp4')}` : null,
      note: job.kind === 'export' ? '快速模式依關鍵幀取範圍，實際起點可能比選擇的時間略早' : null,
    };
  }

  async download(token: string, req: Request, res: Response) {
    const payload = verifyToken(token, 'export');
    if (!payload) throw new ForbiddenException('下載連結已過期，請重新建立');
    const session = await this.auth.authenticate(readCookie(req));
    if (!session || session.user.id !== payload.uid || !session.user.permissions.includes('events.video-history.export')) throw new ForbiddenException('權限不足');
    const job = await this.dataSource.manager.findOne(VideoJob, { where: { id: payload.sub } });
    const result = job?.result as { fileName?: string } | null;
    if (!job || job.status !== 'succeeded' || !result?.fileName) throw new NotFoundException('下載檔不存在');
    const full = join(videoConfig().exportsDir, `${job.id}.mp4`);
    if (!existsSync(full)) throw new NotFoundException('下載檔已過期');
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(full, result.fileName);
  }

  // ── 刪除與保護 ───────────────────────────────────────
  private async scopeSegments(input: { sourceIds?: unknown; from?: unknown; to?: unknown }) {
    const ids = this.sourceIds(input.sourceIds);
    const { from, to } = this.window(input.from, input.to, 366 * 86_400_000);
    // 只處理完整落在區間內的片段，不動區間外的錄影
    const rows: Array<{ id: string; bytes: string | null; protected_until: string | null }> = await this.dataSource.query(
      `SELECT id, bytes, protected_until FROM video_recording_segments WHERE source_id = ANY($1::uuid[]) AND start_at >= $2 AND end_at <= $3 AND status IN ('READY', 'FAILED') LIMIT 100000`,
      [ids, from, to],
    );
    return { ids, from, to, rows };
  }

  async deletePreview(input: Record<string, unknown>) {
    const { rows } = await this.scopeSegments(input);
    const now = Date.now();
    const protectedRows = rows.filter((r) => r.protected_until !== null && Number(r.protected_until) > now);
    return {
      segments: rows.length - protectedRows.length,
      bytes: rows.filter((r) => !protectedRows.includes(r)).reduce((sum, r) => sum + Number(r.bytes ?? 0), 0),
      protectedSegments: protectedRows.length,
      note: '只刪除完整落在區間內的片段；受保護與播放中的片段不刪；事件、軌跡、設定與日誌不受影響',
    };
  }

  async createDeletion(input: Record<string, unknown>, user: AuthUser) {
    const { ids, from, to } = await this.scopeSegments(input);
    if (input.confirm !== true) throw new BadRequestException('請先預覽並確認');
    const now = Date.now();
    const job = await this.dataSource.manager.save(VideoJob, this.dataSource.manager.create(VideoJob, {
      kind: 'delete', dedupeKey: null, status: 'queued', payload: { sourceIds: ids, from, to }, result: null, progress: '0', attempts: 0, maxAttempts: 3,
      leaseOwner: null, leaseUntil: null, error: null, createdBy: user.id, createdAt: now, updatedAt: now, expiresAt: null,
    }));
    return this.presentJob(job, user);
  }

  async protect(input: Record<string, unknown>) {
    const ids = this.sourceIds(input.sourceIds);
    const { from, to } = this.window(input.from, input.to, 366 * 86_400_000);
    const until = input.until === null ? null : epoch(input.until, '保護期限');
    const result = await this.dataSource.query(
      `UPDATE video_recording_segments SET protected_until = $4, updated_at = $5 WHERE source_id = ANY($1::uuid[]) AND start_at < $3 AND end_at > $2 AND status IN ('READY', 'REMOTE_READY', 'UPLOADING')`,
      [ids, from, to, until, Date.now()],
    );
    return { updated: Array.isArray(result) ? Number(result[1] ?? 0) : 0, protectedUntil: until };
  }

  // ── 背景工作 ─────────────────────────────────────────
  async runJobs() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let i = 0; i < 5; i += 1) {
        const job = await this.claim();
        if (!job) break;
        await this.execute(job);
      }
      await this.cleanupExports();
    } catch (error) {
      this.logger.warn(`影像工作失敗：${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** 領工作：FOR UPDATE SKIP LOCKED＋lease；lease 過期的 running 工作可被重新領取 */
  private async claim(): Promise<VideoJob | null> {
    const now = Date.now();
    const rows = await this.dataSource.query(
      `UPDATE video_jobs SET status = 'running', lease_owner = $1, lease_until = $2, attempts = attempts + 1, updated_at = $3
        WHERE id = (SELECT id FROM video_jobs WHERE kind IN ('export', 'delete') AND (status = 'queued' OR (status = 'running' AND lease_until < $3)) AND attempts < max_attempts
                     ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id`,
      [this.workerId, now + 10 * 60_000, now],
    );
    const id = (Array.isArray(rows[0]) ? rows[0][0] : rows[0])?.id;
    return id ? this.dataSource.manager.findOne(VideoJob, { where: { id } }) : null;
  }

  private async finish(job: VideoJob, status: 'succeeded' | 'failed', patch: Partial<VideoJob>) {
    await this.dataSource.manager.update(VideoJob, { id: job.id }, { status, leaseOwner: null, leaseUntil: null, updatedAt: Date.now(), ...patch } as never);
  }

  private async execute(job: VideoJob) {
    try {
      if (job.kind === 'export') await this.executeExport(job);
      else if (job.kind === 'delete') {
        const p = job.payload as { sourceIds: string[]; from: number; to: number };
        const { rows } = await this.scopeSegments(p);
        const now = Date.now();
        const ids = rows.filter((r) => r.protected_until === null || Number(r.protected_until) <= now).map((r) => r.id);
        const deleted = await this.storage.deleteSegments(ids, '使用者手動刪除');
        await this.finish(job, 'succeeded', { progress: '100', result: { deleted, skipped: rows.length - deleted } });
      }
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await this.finish(job, job.attempts >= job.maxAttempts ? 'failed' : ('queued' as never), { error: message });
    }
  }

  /** 快速下載：向媒體服務取區間 fMP4（依關鍵幀），直接寫檔，不在記憶體組整段 */
  private async executeExport(job: VideoJob) {
    const p = job.payload as { sourceId: string; mediaPath: string; from: number; to: number };
    const cfg = videoConfig();
    await fsp.mkdir(cfg.exportsDir, { recursive: true });
    const full = join(cfg.exportsDir, `${job.id}.mp4`);
    const url = new URL(`${cfg.playbackUrl}/get`);
    url.searchParams.set('path', p.mediaPath);
    url.searchParams.set('start', new Date(p.from).toISOString());
    url.searchParams.set('duration', String((p.to - p.from) / 1000));
    url.searchParams.set('format', 'fmp4');
    const bytes = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(url, { headers: { Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}` }, timeout: 120_000 }, (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          res.resume();
          reject(new Error(`媒體服務回應 ${res.statusCode}`));
          return;
        }
        const out = createWriteStream(full);
        let size = 0;
        res.on('data', (c: Buffer) => (size += c.length));
        res.pipe(out);
        out.on('finish', () => resolve(size));
        out.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('下載逾時')));
      req.on('error', reject);
      req.end();
    });
    if (!bytes) throw new Error('沒有取得任何影像');
    const source = await this.dataSource.manager.findOne(VideoSource, { where: { id: p.sourceId } });
    const stamp = new Date(p.from).toISOString().replace(/[-:]/g, '').slice(0, 15);
    const fileName = `${(source?.name ?? 'video').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40)}_${stamp}.mp4`;
    await this.finish(job, 'succeeded', { progress: '100', result: { fileName, bytes } });
  }

  private async cleanupExports() {
    const expired: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM video_jobs WHERE kind = 'export' AND expires_at < $1 AND status IN ('succeeded', 'failed')`, [Date.now()]);
    for (const job of expired) {
      await fsp.rm(join(videoConfig().exportsDir, `${job.id}.mp4`), { force: true });
      await this.dataSource.manager.update(VideoJob, { id: job.id }, { status: 'expired', updatedAt: Date.now() });
    }
  }
}
