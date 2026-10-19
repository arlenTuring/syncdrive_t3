import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fsp, statfsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DataSource, In } from 'typeorm';
import type { AuthUser } from '../access-control/auth.service';
import { VideoRecordingSegment, VideoSegmentObject, VideoSourceRevision, VideoStoragePolicy } from '../database/entities/video.entities';
import { bucketPolicy, deleteObject } from './gcs.client';
import { probeCapabilities } from './video-capabilities';
import { MediaMtxClient } from './mediamtx.client';
import { VideoConfigService } from './video-config.service';
import { VideoReconcilerService } from './video-reconciler.service';
import { GIB, MEDIA_PATH_PREFIX, segmentSeconds, videoConfig } from './video.config';

const DAY = 86_400_000;
const FILE_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{1,6})\.mp4$/;

export function parseSegmentStart(fileName: string): number | null {
  const m = FILE_RE.exec(fileName);
  if (!m) return null;
  // MediaMTX 以 UTC 命名（容器時區 UTC）；%f 是微秒
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + Math.floor(Number(m[7].padEnd(6, '0')) / 1000);
}

export type StorageNumbers = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  budgetBytes: number;
  minFreeBytes: number;
  allowedBytes: number;
  usagePct: number;
};

/**
 * 錄影索引、容量保護與保存政策。
 *
 * - 片段完成時由媒體服務 hook 通知建立索引；另每分鐘只掃描「最後索引之後」的新檔，補回漏掉的 hook。
 * - 片段可用（檔案存在、大小 > 0）才標 READY；寫入中的尾段不宣稱可完整回放。
 * - 容量：保留天數與容量上限先到先清；超過預算 85% 依最舊片段回收到 75%；
 *   最低剩餘空間失守且無法安全回收時暫停新錄影（即時監看照常），並在畫面顯示原因。
 * - 受保護片段與播放中的片段不自動刪除；刪除只動錄影，不動事件、軌跡、設定與日誌。
 */
@Injectable()
export class VideoStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoStorageService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused: { reason: string } | null = null;
  /** 播放／下載中的片段（短效 lease，避免回收時刪掉正在讀的檔） */
  private readonly leases = new Map<string, number>();
  private readonly watermarks = new Map<string, string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly media: MediaMtxClient,
    private readonly config: VideoConfigService,
    private readonly reconciler: VideoReconcilerService,
  ) {}

  onModuleInit() {
    const cfg = videoConfig();
    this.reconciler.storageGate = async () => (this.paused ? { ok: false, reason: this.paused.reason } : { ok: true, reason: null });
    if (!cfg.enabled || cfg.role === 'api') return;
    this.timer = setInterval(() => void this.maintenance(), 60_000);
    setTimeout(() => void this.maintenance(), 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  lease(segmentIds: string[], ttlMs = 120_000) {
    const until = Date.now() + ttlMs;
    for (const id of segmentIds) this.leases.set(id, Math.max(this.leases.get(id) ?? 0, until));
  }

  release(segmentIds: string[]) {
    for (const id of segmentIds) this.leases.delete(id);
  }

  private leased(id: string) {
    const until = this.leases.get(id);
    if (!until) return false;
    if (until < Date.now()) {
      this.leases.delete(id);
      return false;
    }
    return true;
  }

  localPath(segmentKey: string) {
    const root = videoConfig().recordingsDir;
    const full = join(root, segmentKey);
    if (!full.startsWith(root + sep)) throw new BadRequestException('錄影路徑不正確');
    return full;
  }

  // ── 索引 ─────────────────────────────────────────────
  /** hook：媒體服務回報某片段完成（容器內路徑），冪等 upsert */
  async indexFromHook(mediaPath: string, containerPath: string, durationRaw: string) {
    if (!mediaPath.startsWith(MEDIA_PATH_PREFIX) || !/^[a-z0-9_]+$/.test(mediaPath)) throw new BadRequestException('媒體路徑不正確');
    const prefix = `${videoConfig().mediamtxRecordingsDir.replace(/\/$/, '')}/`;
    if (!containerPath.startsWith(prefix)) throw new BadRequestException('片段路徑不正確');
    const key = containerPath.slice(prefix.length);
    if (!key.startsWith(`${mediaPath}/`) || key.includes('..')) throw new BadRequestException('片段路徑不正確');
    const duration = Number(durationRaw);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 3600) throw new BadRequestException('片段長度不正確');
    return this.indexSegment(mediaPath, key, duration * 1000);
  }

  async indexSegment(mediaPath: string, key: string, durationMs: number | null, endHint?: number) {
    const fileName = key.split('/').pop() ?? '';
    const start = parseSegmentStart(fileName);
    if (start === null) return null;
    const rev = await this.dataSource.manager.findOne(VideoSourceRevision, { where: { mediaPath } });
    if (!rev) return null;
    let bytes: number | null = null;
    try {
      bytes = (await fsp.stat(this.localPath(key))).size;
    } catch {
      bytes = null;
    }
    const ok = bytes !== null && bytes > 0;
    const end = durationMs !== null ? start + Math.round(durationMs) : endHint ?? start;
    const now = Date.now();
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO video_recording_segments (source_id, revision_id, segment_key, start_at, end_at, status, bytes, timestamp_basis, failure_reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT ON CONSTRAINT "UQ_VIDEO_SEGMENT_KEY" DO UPDATE SET end_at = GREATEST(video_recording_segments.end_at, EXCLUDED.end_at),
         bytes = EXCLUDED.bytes, status = CASE WHEN video_recording_segments.status IN ('WRITING', 'READY', 'FAILED') THEN EXCLUDED.status ELSE video_recording_segments.status END,
         failure_reason = EXCLUDED.failure_reason, updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [rev.sourceId, rev.id, key, start, Math.max(end, start), ok ? 'READY' : 'FAILED', bytes, rev.timestampBasis, ok ? null : '片段檔案不存在或是空的', now],
    );
    const id = rows[0]?.id;
    if (id && ok) {
      await this.dataSource.query(
        `INSERT INTO video_segment_objects (segment_id, rendition, storage_type, object_key, bytes, status, created_at, updated_at)
         VALUES ($1, 'original', 'local', $2, $3, 'READY', $4, $4)
         ON CONFLICT ON CONSTRAINT "UQ_VIDEO_SEGMENT_OBJECT" DO UPDATE SET bytes = EXCLUDED.bytes, updated_at = EXCLUDED.updated_at`,
        [id, key, bytes, now],
      );
    }
    return id ?? null;
  }

  /** 補漏：每條錄影路徑只看最後索引之後的新檔；最後一個檔若仍在寫入則跳過 */
  async scanRecordings() {
    const root = videoConfig().recordingsDir;
    if (!existsSync(root)) return 0;
    let indexed = 0;
    const dirs = (await fsp.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith(MEDIA_PATH_PREFIX));
    for (const dir of dirs) {
      let mark = this.watermarks.get(dir.name);
      if (mark === undefined) {
        const [row] = await this.dataSource.query(
          `SELECT max(s.segment_key) AS k FROM video_recording_segments s JOIN video_source_revisions r ON r.id = s.revision_id WHERE r.media_path = $1`,
          [dir.name],
        );
        mark = row?.k ?? '';
      }
      const files = (await fsp.readdir(join(root, dir.name))).filter((f) => FILE_RE.test(f)).sort();
      const fresh = files.filter((f) => `${dir.name}/${f}` > (mark ?? ''));
      if (!fresh.length) continue;
      const spans: Array<{ start: string; duration: number }> = await this.media.listRecordingSpans(dir.name, new Date((parseSegmentStart(fresh[0]) ?? Date.now()) - 1_000)).catch(() => []);
      for (const [i, f] of fresh.entries()) {
        const start = parseSegmentStart(f)!;
        const next = files[files.indexOf(f) + 1];
        const stat = await fsp.stat(join(root, dir.name, f)).catch(() => null);
        if (!stat) continue;
        if (!next && Date.now() - stat.mtimeMs < 90_000) break; // 還在寫入
        const span = spans.find((s) => Date.parse(s.start) <= start + 1_000 && Date.parse(s.start) + s.duration * 1000 > start);
        const spanEnd = span ? Date.parse(span.start) + span.duration * 1000 : null;
        const nextStart = next ? parseSegmentStart(next)! : null;
        const end = Math.min(...[spanEnd, nextStart, start + segmentSeconds() * 3 * 1000].filter((v): v is number => v !== null && v > start));
        await this.indexSegment(dir.name, `${dir.name}/${f}`, null, Number.isFinite(end) ? end : start);
        indexed += 1;
        mark = `${dir.name}/${f}`;
        if (i > 500) break; // 每次最多 500 個，避免一次掃太多
      }
      this.watermarks.set(dir.name, mark ?? '');
    }
    return indexed;
  }

  /** 已完成片段補算 checksum（背景、每次有限量） */
  async fillChecksums(limit = 20) {
    const rows = await this.dataSource.manager.find(VideoRecordingSegment, { where: { status: 'READY', checksum: null as never }, order: { startAt: 'ASC' }, take: limit });
    for (const seg of rows) {
      try {
        const hash = createHash('sha256');
        await new Promise<void>((resolve, reject) => createReadStream(this.localPath(seg.segmentKey)).on('data', (c) => hash.update(c)).on('end', () => resolve()).on('error', reject));
        await this.dataSource.manager.update(VideoRecordingSegment, { id: seg.id }, { checksum: `sha256:${hash.digest('hex')}`, updatedAt: Date.now() });
      } catch (error) {
        await this.dataSource.manager.update(VideoRecordingSegment, { id: seg.id }, { status: 'FAILED', failureReason: `無法讀取片段：${(error as Error).message}`.slice(0, 300), updatedAt: Date.now() });
      }
    }
  }

  // ── 容量 ─────────────────────────────────────────────
  async policy() {
    let row = await this.dataSource.manager.findOne(VideoStoragePolicy, { where: { id: 'default' } });
    if (!row) {
      await this.dataSource.createQueryBuilder().insert().into(VideoStoragePolicy).values({ id: 'default' }).orIgnore().execute();
      row = await this.dataSource.manager.findOneOrFail(VideoStoragePolicy, { where: { id: 'default' } });
    }
    return row;
  }

  async numbers(policy?: VideoStoragePolicy): Promise<StorageNumbers> {
    const p = policy ?? (await this.policy());
    const root = videoConfig().recordingsDir;
    await fsp.mkdir(root, { recursive: true }).catch(() => undefined);
    const fs = statfsSync(root);
    const totalBytes = Number(fs.blocks) * Number(fs.bsize);
    const freeBytes = Number(fs.bavail) * Number(fs.bsize);
    // 本機用量＝本機上仍存在的檔案（原檔＋壓縮成品）；只在雲端的片段不算
    const [{ used }] = await this.dataSource.query(`SELECT COALESCE(sum(bytes), 0)::bigint AS used FROM video_segment_objects WHERE storage_type = 'local' AND status = 'READY'`);
    const usedBytes = Number(used);
    let auto = p.autoBudgetBytes;
    if (!p.maxBytes && !auto) {
      // 首次自動預算：50 GiB 與「當時可用容量（含已用錄影）25%」較小者，記住快照
      auto = Math.floor(Math.min(50 * GIB, (freeBytes + usedBytes) * 0.25));
      await this.dataSource.manager.update(VideoStoragePolicy, { id: 'default' }, { autoBudgetBytes: auto });
    }
    const configured = p.maxBytes ?? auto ?? 50 * GIB;
    // GCS 模式：本機只是快取，另有快取上限時取較小者
    const budgetBytes = p.storageType === 'gcs' && p.localCacheMaxBytes ? Math.min(configured, p.localCacheMaxBytes) : configured;
    const minFreeBytes = p.minFreeBytes ?? Math.max(5 * GIB, Math.floor(totalBytes * 0.1));
    // 實際可分配：預算與「已用＋剩餘－最低保留」較小者（檔案系統的其他用量也算進去）
    const allowedBytes = Math.max(0, Math.min(budgetBytes, usedBytes + freeBytes - minFreeBytes));
    return { totalBytes, freeBytes, usedBytes, budgetBytes, minFreeBytes, allowedBytes, usagePct: allowedBytes ? Math.round((usedBytes / allowedBytes) * 1000) / 10 : 100 };
  }

  async status() {
    const p = await this.policy();
    const n = await this.numbers(p);
    const demand = await this.config.recordingDemand();
    const recordingSources = [...demand.values()].filter((d) => d.recording).length;
    // 平均碼率：最近 1 小時已完成片段的 bytes／秒，依來源平均後加總
    const [rate] = await this.dataSource.query(
      `SELECT COALESCE(sum(bps), 0)::float AS bps FROM (
         SELECT sum(bytes)::float / GREATEST(sum(end_at - start_at), 1) * 1000 AS bps FROM video_recording_segments
          WHERE status = 'READY' AND end_at > $1 GROUP BY source_id) x`,
      [Date.now() - 3_600_000],
    );
    const bytesPerDay = Number(rate.bps) * 86_400;
    const [{ earliest }] = await this.dataSource.query(`SELECT min(start_at) AS earliest FROM video_recording_segments WHERE status IN ('READY', 'REMOTE_READY', 'UPLOADING')`);
    return {
      policy: this.presentPolicy(p),
      ...n,
      recordingSources,
      estimatedBytesPerDay: bytesPerDay > 0 ? Math.round(bytesPerDay) : null,
      estimatedDays: bytesPerDay > 0 ? Math.round((n.allowedBytes / bytesPerDay) * 10) / 10 : null,
      earliestAvailableAt: earliest === null ? null : Number(earliest),
      // API 與 worker 可能是不同程序：以同一條件即時判斷，不依賴記憶體
      paused: this.paused ?? (n.usedBytes >= n.allowedBytes * 0.95 || n.freeBytes < n.minFreeBytes ? { reason: '空間不足' } : null),
      measuredAt: Date.now(),
    };
  }

  private presentPolicy(p: VideoStoragePolicy) {
    return {
      storageType: p.storageType,
      retentionDays: p.retentionDays,
      maxBytes: p.maxBytes,
      minFreeBytes: p.minFreeBytes,
      localCacheMaxBytes: p.localCacheMaxBytes,
      highWatermarkPct: p.highWatermarkPct,
      lowWatermarkPct: p.lowWatermarkPct,
      gcsBucket: p.gcsBucket,
      gcsPrefix: p.gcsPrefix,
      compression: p.compression,
      autoBudgetBytes: p.autoBudgetBytes,
      version: p.version,
    };
  }

  async updatePolicy(input: Record<string, unknown>, actor: AuthUser) {
    const expected = Number(input.expectedVersion);
    if (!Number.isInteger(expected) || expected < 1) throw new BadRequestException('缺少版本資訊，請重新整理');
    const int = (v: unknown, label: string, min: number, max: number) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${label}必須是 ${min}–${max}`);
      return n;
    };
    const bytes = (v: unknown, label: string) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label}不正確`);
      return Math.floor(n);
    };
    const current = await this.policy();
    const storageType = input.storageType === undefined ? current.storageType : input.storageType;
    if (storageType !== 'local' && storageType !== 'gcs') throw new BadRequestException('儲存位置只能是本機或 GCS');
    const gcsBucket = input.gcsBucket === undefined ? current.gcsBucket : input.gcsBucket ? String(input.gcsBucket).trim() : null;
    if (gcsBucket && !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(gcsBucket)) throw new BadRequestException('GCS bucket 名稱不正確');
    if (storageType === 'gcs' && !gcsBucket) throw new BadRequestException('使用 GCS 時請設定 bucket');
    const gcsPrefix = input.gcsPrefix === undefined ? current.gcsPrefix : input.gcsPrefix ? String(input.gcsPrefix).trim().replace(/^\/+|\/+$/g, '') : null;
    if (gcsPrefix && !/^[A-Za-z0-9._/-]{1,200}$/.test(gcsPrefix)) throw new BadRequestException('GCS 路徑前綴只能是英數與 ._-/');
    const compressionIn = (input.compression ?? current.compression) as Record<string, unknown>;
    const compression = {
      enabled: compressionIn.enabled === true,
      codec: compressionIn.codec === 'hevc' ? 'hevc' : 'av1',
      replaceOriginal: compressionIn.replaceOriginal === true,
      minSavingPct: int(compressionIn.minSavingPct ?? 15, '最低節省比例', 1, 90),
      minVmaf: int(compressionIn.minVmaf ?? 90, 'VMAF 門檻', 50, 100),
      maxConcurrency: int(compressionIn.maxConcurrency ?? 1, '壓縮並行數', 1, 4),
    } as VideoStoragePolicy['compression'];
    if (compression.enabled) {
      // 只有實際偵測到的編碼器與品質評估可用時才允許開啟
      const caps = await probeCapabilities(true);
      const encoder = compression.codec === 'av1' ? 'libsvtav1' : 'libx265';
      if (!caps.encoders[compression.codec].includes(encoder)) throw new BadRequestException(`此主機沒有 ${encoder} 編碼器，無法開啟壓縮`);
      if (!caps.vmaf) throw new BadRequestException('此主機沒有 VMAF 畫質評估工具（ffmpeg libvmaf 或 vmaf 程式），無法驗證畫質，不能開啟壓縮');
    }
    if (storageType === 'gcs' && (current.storageType !== 'gcs' || gcsBucket !== current.gcsBucket)) {
      try {
        await bucketPolicy(gcsBucket!);
      } catch (error) {
        throw new BadRequestException(`無法存取 GCS bucket：${(error as Error).message}`);
      }
    }
    const high = int(input.highWatermarkPct ?? current.highWatermarkPct, '高水位', 50, 99);
    const low = int(input.lowWatermarkPct ?? current.lowWatermarkPct, '低水位', 10, 98);
    if (low >= high) throw new BadRequestException('低水位必須小於高水位');
    const result = await this.dataSource.manager.update(VideoStoragePolicy, { id: 'default', version: expected }, {
      storageType,
      retentionDays: int(input.retentionDays ?? current.retentionDays, '保留天數', 1, 3650),
      maxBytes: input.maxBytes === undefined ? current.maxBytes : bytes(input.maxBytes, '影片最大用量'),
      minFreeBytes: input.minFreeBytes === undefined ? current.minFreeBytes : bytes(input.minFreeBytes, '最低剩餘容量'),
      localCacheMaxBytes: input.localCacheMaxBytes === undefined ? current.localCacheMaxBytes : bytes(input.localCacheMaxBytes, '本機快取上限'),
      highWatermarkPct: high,
      lowWatermarkPct: low,
      gcsBucket,
      gcsPrefix,
      compression: compression as never,
      version: expected + 1,
      updatedBy: actor.id,
      updatedAt: Date.now(),
    });
    if (!result.affected) throw new ConflictException('儲存政策已被其他人修改，請重新整理');
    this.config.changed('video_storage_policy');
    return this.status();
  }

  // ── 回收 ─────────────────────────────────────────────
  async maintenance() {
    try {
      await this.scanRecordings();
      await this.retention();
      await this.fillChecksums();
    } catch (error) {
      this.logger.warn(`錄影維護失敗：${(error as Error).message}`);
    }
  }

  /** 保存政策：到期刪除、高低水位回收、空間不足時暫停新錄影 */
  async retention(now = Date.now()) {
    const p = await this.policy();
    let deleted = 0;
    const expired = await this.dataSource.query(
      `SELECT id FROM video_recording_segments WHERE status IN ('READY', 'REMOTE_READY', 'FAILED') AND end_at < $1 AND (protected_until IS NULL OR protected_until < $2)
        ORDER BY start_at LIMIT 500`,
      [now - p.retentionDays * DAY, now],
    );
    deleted += await this.deleteSegments(expired.map((r: { id: string }) => r.id), '已超過保留天數');
    let n = await this.numbers(p);
    if (n.usedBytes > (n.allowedBytes * p.highWatermarkPct) / 100) {
      const target = (n.allowedBytes * p.lowWatermarkPct) / 100;
      // 先回收「雲端已有完整副本」的本機檔：片段仍可從雲端播放，不算刪除錄影
      for (let round = 0; round < 20 && n.usedBytes > target; round += 1) {
        const freed = await this.evictLocalCopies(n.usedBytes - target, now);
        if (!freed) break;
        n = await this.numbers(p);
      }
      // GCS 模式不刪尚未上傳的片段：仍超過就暫停新錄影，等上傳後再回收
      for (let round = 0; p.storageType === 'local' && round < 20 && n.usedBytes > target; round += 1) {
        const batch = await this.dataSource.query(
          `SELECT id, bytes FROM video_recording_segments WHERE status = 'READY' AND (protected_until IS NULL OR protected_until < $1)
            ORDER BY start_at LIMIT 200`,
          [now],
        );
        const ids: string[] = [];
        let freed = 0;
        for (const row of batch) {
          if (this.leased(row.id)) continue;
          ids.push(row.id);
          freed += Number(row.bytes ?? 0);
          if (n.usedBytes - freed <= target) break;
        }
        if (!ids.length) break;
        deleted += await this.deleteSegments(ids, '容量回收（超過錄影預算高水位）');
        n = await this.numbers(p);
      }
    }
    // 回收後仍超過 95% 或剩餘空間低於最低保留：暫停新錄影（即時監看照常）
    const wasPaused = Boolean(this.paused);
    this.paused = n.usedBytes >= n.allowedBytes * 0.95 || n.freeBytes < n.minFreeBytes ? { reason: '空間不足' } : null;
    if (wasPaused !== Boolean(this.paused)) {
      this.logger.warn(this.paused ? '錄影空間不足，暫停新錄影' : '錄影空間恢復，繼續錄影');
      this.reconciler.kick();
    }
    // 已刪除的索引保留 30 天供「已到期」顯示，之後清掉
    await this.dataSource.query(`DELETE FROM video_recording_segments WHERE status = 'DELETED' AND updated_at < $1`, [now - 30 * DAY]);
    return { deleted, paused: this.paused, ...n };
  }

  /** 刪除片段：DELETE_PENDING → 刪檔 → DELETED；只動錄影，不 cascade 到其他資料 */
  async deleteSegments(ids: string[], reason: string) {
    if (!ids.length) return 0;
    const segs = await this.dataSource.manager.find(VideoRecordingSegment, { where: { id: In(ids) } });
    let count = 0;
    for (const seg of segs) {
      if (this.leased(seg.id)) continue;
      await this.dataSource.manager.update(VideoRecordingSegment, { id: seg.id }, { status: 'DELETE_PENDING', updatedAt: Date.now() });
      try {
        const objects = await this.dataSource.manager.find(VideoSegmentObject, { where: { segmentId: seg.id } });
        await fsp.rm(this.localPath(seg.segmentKey), { force: true });
        for (const obj of objects.filter((o) => o.status !== 'DELETED')) {
          if (obj.storageType === 'local') await fsp.rm(this.localPath(obj.objectKey), { force: true });
          else {
            const bucket = (await this.policy()).gcsBucket;
            if (!bucket) throw new Error('雲端物件存在但未設定 bucket，無法刪除');
            await deleteObject(bucket, obj.objectKey, obj.generation);
          }
        }
        await this.dataSource.manager.update(VideoSegmentObject, { segmentId: seg.id }, { status: 'DELETED', updatedAt: Date.now() });
        await this.dataSource.manager.update(VideoRecordingSegment, { id: seg.id }, { status: 'DELETED', failureReason: reason.slice(0, 300), updatedAt: Date.now() });
        count += 1;
      } catch (error) {
        await this.dataSource.manager.update(VideoRecordingSegment, { id: seg.id }, { status: 'FAILED', failureReason: `刪除失敗：${(error as Error).message}`.slice(0, 300), updatedAt: Date.now() });
      }
    }
    return count;
  }

  /** 回收本機副本：只挑雲端已有同版本（rendition）完整物件的本機檔，最舊優先；回傳釋放的位元組 */
  async evictLocalCopies(wantBytes: number, now = Date.now()) {
    const rows: Array<{ id: string; segment_id: string; object_key: string; bytes: string }> = await this.dataSource.query(
      `SELECT l.id, l.segment_id, l.object_key, l.bytes FROM video_segment_objects l
         JOIN video_recording_segments s ON s.id = l.segment_id
        WHERE l.storage_type = 'local' AND l.status = 'READY' AND s.status = 'REMOTE_READY'
          AND EXISTS (SELECT 1 FROM video_segment_objects g WHERE g.segment_id = l.segment_id AND g.rendition = l.rendition AND g.storage_type = 'gcs' AND g.status = 'READY')
        ORDER BY s.start_at LIMIT 200`,
    );
    let freed = 0;
    for (const row of rows) {
      if (freed >= wantBytes) break;
      if (this.leased(row.segment_id)) continue;
      await fsp.rm(this.localPath(row.object_key), { force: true });
      await this.dataSource.manager.update(VideoSegmentObject, { id: row.id }, { status: 'DELETED', updatedAt: now });
      freed += Number(row.bytes ?? 0);
    }
    return freed;
  }

  relativeKey(fullPath: string) {
    return relative(videoConfig().recordingsDir, fullPath);
  }
}
