import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import { DataSource } from 'typeorm';
import { VideoJob, VideoRecordingSegment, VideoSegmentObject, type CompressionPolicy } from '../database/entities/video.entities';
import { bucketPolicy, objectMeta, uploadFile } from './gcs.client';
import { probeCapabilities, run } from './video-capabilities';
import { VideoStorageService } from './video-storage.service';
import { GIB, videoConfig } from './video.config';

/** 壓縮成品放在原片段旁，檔名不符合媒體服務的命名規則，不會被當成錄影或被掃描重複索引 */
export const renditionKey = (segmentKey: string, codec: string) => `${segmentKey}.${codec}.mp4`;

export const ENCODER_ARGS: Record<CompressionPolicy['codec'], { encoder: string; args: string[] }> = {
  // SVT-AV1：preset 8 在 CPU 與壓縮率之間取平衡；crf 35 對監視器畫面通常 VMAF ≥ 90
  av1: { encoder: 'libsvtav1', args: ['-preset', '8', '-crf', '35', '-g', '240', '-pix_fmt', 'yuv420p'] },
  // x265：medium＋crf 28；hvc1 tag 讓 Safari 可播放
  hevc: { encoder: 'libx265', args: ['-preset', 'medium', '-crf', '28', '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p'] },
};

export async function fileDigest(file: string, algorithm: 'md5' | 'sha256') {
  const hash = createHash(algorithm);
  await new Promise<void>((resolve, reject) => createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve()).on('error', reject));
  return hash;
}

/** 從 libvmaf 的輸出取平均分數 */
export function parseVmaf(stderr: string): number | null {
  const m = /VMAF score[:=]\s*([\d.]+)/i.exec(stderr);
  return m ? Number(m[1]) : null;
}

/**
 * 雲端保存與高效率壓縮（只在 worker 執行）。
 *
 * - GCS：已完成且算好 checksum 的片段上傳（不覆寫既有物件），以 md5 驗證後才標 REMOTE_READY；
 *   之後本機副本可依容量回收，播放時改從雲端串流。
 * - 壓縮（預設關閉）：背景低優先權、限制並行；節省比例與 VMAF 都達標且可完整解碼才保留，
 *   預設保留原檔，只有明確開啟「取代原檔」才在驗證後刪原檔。
 */
@Injectable()
export class VideoArchiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoArchiveService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly workerId = `video-archive-${randomUUID().slice(0, 8)}`;
  private bucketInfo: { bucket: string; at: number; value: Record<string, unknown> } | null = null;

  constructor(private readonly dataSource: DataSource, private readonly storage: VideoStorageService) {}

  onModuleInit() {
    const cfg = videoConfig();
    if (!cfg.enabled || cfg.role === 'api') return;
    this.timer = setInterval(() => void this.tick(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const policy = await this.storage.policy();
      if (policy.storageType === 'gcs' && policy.gcsBucket) await this.uploadPending(policy.gcsBucket, policy.gcsPrefix);
      if (policy.compression?.enabled) {
        // 磁碟壓力時暫停背景壓縮：重新編碼需要額外空間，不能把剩餘空間擠到最低保留以下
        const n = await this.storage.numbers(policy);
        if (n.freeBytes < n.minFreeBytes + GIB) {
          this.logger.warn('剩餘空間接近最低保留，暫停背景壓縮');
          return;
        }
        await this.enqueueCompression(policy.compression);
        await this.runCompression(policy.compression);
      }
    } catch (error) {
      this.logger.warn(`雲端／壓縮工作失敗：${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  // ── GCS ─────────────────────────────────────────────
  gcsName(prefix: string | null, objectKey: string) {
    return prefix ? `${prefix}/${objectKey}` : objectKey;
  }

  /** 上傳尚未在雲端的本機副本（原檔與壓縮成品各自一個物件） */
  async uploadPending(bucket: string, prefix: string | null, limit = 10) {
    const rows: Array<{ object_id: string; segment_id: string; rendition: string; object_key: string; bytes: string }> = await this.dataSource.query(
      `SELECT o.id AS object_id, o.segment_id, o.rendition, o.object_key, o.bytes FROM video_segment_objects o
         JOIN video_recording_segments s ON s.id = o.segment_id
        WHERE o.storage_type = 'local' AND o.status = 'READY' AND s.status IN ('READY', 'REMOTE_READY') AND s.checksum IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM video_segment_objects g WHERE g.segment_id = o.segment_id AND g.rendition = o.rendition AND g.storage_type = 'gcs' AND g.status = 'READY')
        ORDER BY s.start_at LIMIT $1`,
      [limit],
    );
    let uploaded = 0;
    for (const row of rows) {
      const segmentId = row.segment_id;
      const local = this.storage.localPath(row.object_key);
      const name = this.gcsName(prefix, row.object_key);
      await this.dataSource.query(`UPDATE video_recording_segments SET status = 'UPLOADING', updated_at = $2 WHERE id = $1 AND status = 'READY'`, [segmentId, Date.now()]);
      this.storage.lease([segmentId], 15 * 60_000);
      try {
        const stat = await fsp.stat(local);
        const md5 = (await fileDigest(local, 'md5')).digest('base64');
        let meta: { generation: string; md5Hash: string; size: number };
        try {
          meta = await uploadFile(bucket, name, local, stat.size);
        } catch (error) {
          // 412：前一次已上傳成功但沒來得及記錄，查回既有物件再驗證
          if ((error as { status?: number }).status !== 412) throw error;
          const existing = await objectMeta(bucket, name);
          if (!existing) throw error;
          meta = { generation: existing.generation, md5Hash: existing.md5Hash, size: Number(existing.size) };
        }
        if (meta.md5Hash !== md5 || meta.size !== stat.size) throw new Error('雲端物件的校驗碼與本機不符');
        const now = Date.now();
        await this.dataSource.query(
          `INSERT INTO video_segment_objects (segment_id, rendition, storage_type, object_key, generation, checksum, bytes, status, created_at, updated_at)
           VALUES ($1, $2, 'gcs', $3, $4, $5, $6, 'READY', $7, $7)
           ON CONFLICT ON CONSTRAINT "UQ_VIDEO_SEGMENT_OBJECT" DO UPDATE SET object_key = EXCLUDED.object_key, generation = EXCLUDED.generation,
             checksum = EXCLUDED.checksum, bytes = EXCLUDED.bytes, status = 'READY', updated_at = EXCLUDED.updated_at`,
          [segmentId, row.rendition, name, meta.generation, `md5:${md5}`, stat.size, now],
        );
        await this.dataSource.query(`UPDATE video_recording_segments SET status = 'REMOTE_READY', updated_at = $2 WHERE id = $1 AND status IN ('UPLOADING', 'READY')`, [segmentId, now]);
        uploaded += 1;
      } catch (error) {
        // 上傳失敗不影響本機播放：退回 READY，下次重試
        await this.dataSource.query(`UPDATE video_recording_segments SET status = 'READY', failure_reason = $2, updated_at = $3 WHERE id = $1 AND status = 'UPLOADING'`, [
          segmentId,
          `上傳雲端失敗：${(error as Error).message}`.slice(0, 300),
          Date.now(),
        ]);
        this.logger.warn(`片段上傳 GCS 失敗：${(error as Error).message}`);
        break; // 雲端有問題時不連續打
      } finally {
        this.storage.release([segmentId]);
      }
    }
    return uploaded;
  }

  /** 設定頁顯示 bucket 的保護政策：soft delete 期間內，應用刪除後雲端仍保留（10 分鐘快取） */
  async bucketStatus(bucket: string | null) {
    if (!bucket) return null;
    if (this.bucketInfo && this.bucketInfo.bucket === bucket && Date.now() - this.bucketInfo.at < 600_000) return this.bucketInfo.value;
    let value: Record<string, unknown>;
    try {
      const p = await bucketPolicy(bucket);
      const softDeleteSeconds = Number(p.softDeletePolicy?.retentionDurationSeconds ?? 0);
      value = { ok: true, softDeleteDays: softDeleteSeconds ? Math.round((softDeleteSeconds / 86_400) * 10) / 10 : 0, versioning: Boolean(p.versioning?.enabled), storageClass: p.storageClass ?? null };
    } catch (error) {
      value = { ok: false, error: (error as Error).message };
    }
    this.bucketInfo = { bucket, at: Date.now(), value };
    return value;
  }

  /** 壓縮成果摘要（設定頁顯示） */
  async compressionStats() {
    const [row] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status IN ('queued', 'running'))::int AS pending,
              count(*) FILTER (WHERE status = 'succeeded' AND (result->>'kept')::boolean)::int AS kept,
              count(*) FILTER (WHERE status = 'succeeded' AND NOT (result->>'kept')::boolean)::int AS skipped,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              COALESCE(sum((result->>'inBytes')::bigint - (result->>'outBytes')::bigint) FILTER (WHERE status = 'succeeded' AND (result->>'kept')::boolean), 0)::bigint AS saved,
              avg((result->>'vmaf')::float) FILTER (WHERE status = 'succeeded' AND (result->>'kept')::boolean) AS vmaf
         FROM video_jobs WHERE kind = 'compress' AND created_at > $1`,
      [Date.now() - 7 * 86_400_000],
    );
    const [last] = await this.dataSource.query(`SELECT error, result FROM video_jobs WHERE kind = 'compress' AND status IN ('failed', 'succeeded') ORDER BY updated_at DESC LIMIT 1`);
    return { pending: row.pending, kept: row.kept, skipped: row.skipped, failed: row.failed, savedBytes: Number(row.saved), avgVmaf: row.vmaf === null ? null : Math.round(Number(row.vmaf) * 10) / 10, last: last ?? null };
  }

  // ── 壓縮 ─────────────────────────────────────────────
  /** 只挑完成超過 10 分鐘、尚未壓縮過的片段；dedupe 避免重複排入 */
  async enqueueCompression(policy: CompressionPolicy) {
    const [{ pending }] = await this.dataSource.query(`SELECT count(*)::int AS pending FROM video_jobs WHERE kind = 'compress' AND status IN ('queued', 'running')`);
    const room = Math.max(0, policy.maxConcurrency * 4 - Number(pending));
    if (!room) return 0;
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT s.id FROM video_recording_segments s
        WHERE s.status IN ('READY', 'REMOTE_READY') AND s.checksum IS NOT NULL AND s.end_at < $1
          AND EXISTS (SELECT 1 FROM video_segment_objects o WHERE o.segment_id = s.id AND o.rendition = 'original' AND o.storage_type = 'local' AND o.status = 'READY')
          AND NOT EXISTS (SELECT 1 FROM video_segment_objects o WHERE o.segment_id = s.id AND o.rendition = $2)
          AND NOT EXISTS (SELECT 1 FROM video_jobs j WHERE j.kind = 'compress' AND j.dedupe_key = 'compress:' || s.id || ':' || $2 AND j.status IN ('succeeded', 'failed') AND j.updated_at > $3)
        ORDER BY s.start_at LIMIT $4`,
      [Date.now() - 10 * 60_000, policy.codec, Date.now() - 86_400_000, room],
    );
    const now = Date.now();
    for (const row of rows) {
      await this.dataSource.query(
        `INSERT INTO video_jobs (kind, dedupe_key, status, payload, max_attempts, created_at, updated_at)
         VALUES ('compress', $1, 'queued', $2, 2, $3, $3) ON CONFLICT DO NOTHING`,
        [`compress:${row.id}:${policy.codec}`, JSON.stringify({ segmentId: row.id, codec: policy.codec }), now],
      );
    }
    return rows.length;
  }

  private async claim(): Promise<VideoJob | null> {
    const now = Date.now();
    const rows = await this.dataSource.query(
      `UPDATE video_jobs SET status = 'running', lease_owner = $1, lease_until = $2, attempts = attempts + 1, updated_at = $3
        WHERE id = (SELECT id FROM video_jobs WHERE kind = 'compress' AND (status = 'queued' OR (status = 'running' AND lease_until < $3)) AND attempts < max_attempts
                     ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id`,
      [this.workerId, now + 30 * 60_000, now],
    );
    const id = (Array.isArray(rows[0]) ? rows[0][0] : rows[0])?.id;
    return id ? this.dataSource.manager.findOne(VideoJob, { where: { id } }) : null;
  }

  async runCompression(policy: CompressionPolicy) {
    const jobs: VideoJob[] = [];
    for (let i = 0; i < policy.maxConcurrency; i += 1) {
      const job = await this.claim();
      if (!job) break;
      jobs.push(job);
    }
    await Promise.all(jobs.map((job) => this.compressJob(job, policy)));
    return jobs.length;
  }

  private async finish(job: VideoJob, status: 'succeeded' | 'failed' | 'queued', patch: Partial<VideoJob>) {
    await this.dataSource.manager.update(VideoJob, { id: job.id }, { status, leaseOwner: null, leaseUntil: null, updatedAt: Date.now(), ...patch } as never);
  }

  async compressJob(job: VideoJob, policy: Pick<CompressionPolicy, 'replaceOriginal' | 'minSavingPct' | 'minVmaf'>) {
    try {
      const result = await this.compressSegment(String(job.payload.segmentId), job.payload.codec === 'hevc' ? 'hevc' : 'av1', policy);
      await this.finish(job, 'succeeded', { progress: '100', result });
      return result;
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await this.finish(job, job.attempts >= job.maxAttempts ? 'failed' : 'queued', { error: message });
      return { kept: false, reason: message };
    }
  }

  /**
   * 壓縮單一片段：編碼 → 檢查節省比例 → VMAF → 時長一致 → 原子改名登記。
   * 任何一步不達標就丟掉成品、保留原檔，結果寫進工作紀錄。
   */
  async compressSegment(segmentId: string, codec: CompressionPolicy['codec'], policy: Pick<CompressionPolicy, 'replaceOriginal' | 'minSavingPct' | 'minVmaf'>) {
    const cfg = videoConfig();
    const caps = await probeCapabilities();
    const spec = ENCODER_ARGS[codec];
    if (!caps.encoders[codec].includes(spec.encoder)) throw new Error(`此主機沒有 ${spec.encoder} 編碼器`);
    if (!caps.vmaf) throw new Error('此主機的 ffmpeg 沒有 libvmaf，無法驗證品質，不壓縮');
    const seg = await this.dataSource.manager.findOne(VideoRecordingSegment, { where: { id: segmentId } });
    if (!seg || !['READY', 'REMOTE_READY'].includes(seg.status)) throw new Error('片段不存在或不可用');
    const original = await this.dataSource.manager.findOne(VideoSegmentObject, { where: { segmentId, rendition: 'original', storageType: 'local', status: 'READY' } });
    if (!original) throw new Error('本機沒有原檔');
    const input = this.storage.localPath(original.objectKey);
    const key = renditionKey(original.objectKey, codec);
    const output = this.storage.localPath(key);
    const tmp = `${output}.${randomUUID().slice(0, 8)}.tmp.mp4`;
    const durationS = Math.max(1, (seg.endAt - seg.startAt) / 1000);
    const timeout = Math.max(300_000, durationS * 20_000);
    this.storage.lease([segmentId], timeout * 2 + 60_000);
    try {
      const inBytes = (await fsp.stat(input)).size;
      const enc = await run(cfg.ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c:v', spec.encoder, ...spec.args, '-c:a', 'copy', '-movflags', '+faststart', tmp], timeout, true);
      if (enc.code !== 0) throw new Error(`編碼失敗：${enc.stderr.trim().split('\n').pop() ?? enc.code}`);
      const outBytes = (await fsp.stat(tmp)).size;
      const savingPct = Math.round((1 - outBytes / inBytes) * 1000) / 10;
      const base = { codec, encoder: spec.encoder, inBytes, outBytes, savingPct };
      if (savingPct < policy.minSavingPct) return this.discard(tmp, { ...base, kept: false, reason: `節省 ${savingPct}% 未達 ${policy.minSavingPct}%` });
      // VMAF：失真版本在前、參考在後；同時完整解碼一次成品
      const vmaf = await run(cfg.ffmpegPath, ['-nostdin', '-hide_banner', '-i', tmp, '-i', input, '-lavfi', '[0:v]setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]libvmaf=n_threads=2', '-f', 'null', '-'], timeout, true);
      const score = parseVmaf(vmaf.stderr);
      if (vmaf.code !== 0 || score === null) return this.discard(tmp, { ...base, kept: false, reason: '無法計算 VMAF' });
      if (score < policy.minVmaf) return this.discard(tmp, { ...base, vmaf: score, kept: false, reason: `VMAF ${score} 低於 ${policy.minVmaf}` });
      const [dIn, dOut] = await Promise.all([this.duration(input), this.duration(tmp)]);
      if (dIn === null || dOut === null || Math.abs(dIn - dOut) > 0.5) return this.discard(tmp, { ...base, vmaf: score, kept: false, reason: `時長不一致（原 ${dIn}s／新 ${dOut}s）` });
      const sha = (await fileDigest(tmp, 'sha256')).digest('hex');
      await fsp.rename(tmp, output);
      const now = Date.now();
      await this.dataSource.query(
        `INSERT INTO video_segment_objects (segment_id, rendition, storage_type, object_key, checksum, bytes, status, created_at, updated_at)
         VALUES ($1, $2, 'local', $3, $4, $5, 'READY', $6, $6)
         ON CONFLICT ON CONSTRAINT "UQ_VIDEO_SEGMENT_OBJECT" DO UPDATE SET object_key = EXCLUDED.object_key, checksum = EXCLUDED.checksum, bytes = EXCLUDED.bytes, status = 'READY', updated_at = EXCLUDED.updated_at`,
        [segmentId, codec, key, `sha256:${sha}`, outBytes, now],
      );
      let replaced = false;
      // 受保護片段（事件、調查）即使開啟取代也保留原檔
      if (policy.replaceOriginal && !(seg.protectedUntil && seg.protectedUntil > now)) {
        // 只刪本機原檔；雲端已有的原檔物件不動（由保存政策處理）
        await fsp.rm(input, { force: true });
        await this.dataSource.manager.update(VideoSegmentObject, { id: original.id }, { status: 'DELETED', updatedAt: now });
        replaced = true;
      }
      return { ...base, vmaf: score, durationIn: dIn, durationOut: dOut, kept: true, replaced };
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      this.storage.release([segmentId]);
    }
  }

  private async discard(tmp: string, result: Record<string, unknown>) {
    await fsp.rm(tmp, { force: true });
    return result;
  }

  private async duration(file: string) {
    const r = await run(videoConfig().ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 30_000);
    const n = Number(r.stdout.trim());
    return r.code === 0 && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
}
