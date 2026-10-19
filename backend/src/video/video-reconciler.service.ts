import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, In, IsNull, QueryRunner } from 'typeorm';
import { VideoSource, VideoSourceRevision } from '../database/entities/video.entities';
import { MediaMtxClient, type ManagedPathConfig, type RuntimePath } from './mediamtx.client';
import { VideoConfigService } from './video-config.service';
import { MEDIA_PATH_PREFIX, SEGMENT_SECONDS, videoConfig } from './video.config';

export type StorageGate = () => Promise<{ ok: boolean; reason: string | null }>;

/** 實際狀態（與需求分開；畫面顯示「連線中／播放中／錄影中／僅即時／錄影暫停：空間不足」等） */
export type ActualStatus = {
  state: 'online' | 'connecting' | 'idle' | 'error' | 'disabled' | 'media_unavailable';
  recording: boolean;
  desiredRecording: boolean;
  reason: string | null;
  tracks: string[];
  readers: number;
  checkedAt: number;
};

/**
 * 協調器：把資料庫裡的來源需求（desired）套用到媒體服務，並回寫實際狀態（actual）。
 *
 * - 只管理 vs_ 開頭的路徑；每個來源版本一條路徑。
 * - 有格子要求錄影 → 持續接入並錄影（與瀏覽器是否開著無關）；只即時 → 有人看才接入（sourceOnDemand）。
 * - 錄影空間不足時停止新錄影，但即時監看照常。
 * - PostgreSQL advisory lock 當 lease：多個 worker 只有一個在協調，不會重複錄製同一來源。
 * - 資料庫交易不包住網路呼叫；媒體服務失敗時退避重試，不每次重開來源。
 */
@Injectable()
export class VideoReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoReconcilerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private runner: QueryRunner | null = null;
  private leader = false;
  private running = false;
  private pending = false;
  private failures = 0;
  private nextAllowedAt = 0;
  storageGate: StorageGate = async () => ({ ok: true, reason: null });

  constructor(private readonly dataSource: DataSource, private readonly media: MediaMtxClient, private readonly config: VideoConfigService) {}

  onModuleInit() {
    const cfg = videoConfig();
    if (!cfg.enabled || cfg.role === 'api') return;
    this.config.onChange = () => this.kick();
    this.timer = setInterval(() => void this.tick(), 10_000);
    setTimeout(() => void this.tick(), 2_000);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.runner) await this.runner.release().catch(() => undefined);
  }

  /** 設定變更後盡快協調一次（合併短時間內的多次變更） */
  kick() {
    this.pending = true;
    setTimeout(() => void this.tick(), 300);
  }

  private async acquireLease() {
    if (this.leader) return true;
    if (!this.runner) this.runner = this.dataSource.createQueryRunner();
    const [row] = await this.runner.query(`SELECT pg_try_advisory_lock(hashtext('video-reconciler')) AS ok`);
    this.leader = Boolean(row?.ok);
    return this.leader;
  }

  async tick() {
    if (this.running) {
      this.pending = true;
      return;
    }
    if (Date.now() < this.nextAllowedAt) return;
    this.running = true;
    try {
      do {
        this.pending = false;
        if (!(await this.acquireLease())) return;
        await this.reconcile();
      } while (this.pending);
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      // 退避加抖動：最多 2 分鐘
      const delay = Math.min(120_000, 2_000 * 2 ** Math.min(this.failures, 6)) * (0.8 + Math.random() * 0.4);
      this.nextAllowedAt = Date.now() + delay;
      this.logger.warn(`影像協調失敗（${this.failures}）：${(error as Error).message}`);
      if (this.runner && /connection|terminat/i.test((error as Error).message)) {
        this.leader = false;
        await this.runner.release().catch(() => undefined);
        this.runner = null;
      }
    } finally {
      this.running = false;
    }
  }

  /** 一次協調：算出需求、對齊媒體服務設定、回寫實際狀態 */
  async reconcile() {
    const cfg = videoConfig();
    const settings = await this.config.settings();
    const sources = await this.dataSource.manager.find(VideoSource, { where: { deletedAt: IsNull() } });
    const revIds = sources.map((s) => s.currentRevisionId).filter(Boolean) as string[];
    const revisions = revIds.length ? await this.dataSource.manager.find(VideoSourceRevision, { where: { id: In(revIds) } }) : [];
    const revById = new Map(revisions.map((r) => [r.id, r]));
    const demand = await this.config.recordingDemand();
    const storage = await this.storageGate();

    const desired = new Map<string, { sourceId: string; config: ManagedPathConfig; wantRecording: boolean }>();
    const errors = new Map<string, string>();
    for (const source of sources) {
      const rev = source.currentRevisionId ? revById.get(source.currentRevisionId) : undefined;
      if (!source.enabled || !rev) continue;
      const wantRecording = demand.get(source.id)?.recording ?? false;
      let url: string;
      try {
        url = await this.config.mediaSourceUrl(rev, settings.allowedNetworks);
      } catch (error) {
        errors.set(source.id, (error as Error).message);
        continue;
      }
      const record = wantRecording && storage.ok;
      desired.set(rev.mediaPath, {
        sourceId: source.id,
        wantRecording,
        config: {
          source: url,
          sourceOnDemand: !record,
          record,
          recordPath: `${cfg.mediamtxRecordingsDir}/%path/%Y-%m-%d_%H-%M-%S-%f`,
          recordFormat: 'fmp4',
          recordSegmentDuration: `${SEGMENT_SECONDS}s`,
          recordPartDuration: '1s',
          // 刪除由本系統的保存政策統一處理，媒體服務不自行按天數刪
          recordDeleteAfter: '0s',
          rtspTransport: 'tcp',
          useAbsoluteTimestamp: rev.timestampBasis === 'source',
        },
      });
    }

    let runtime: RuntimePath[] = [];
    const stats = { added: 0, patched: 0, deleted: 0, differences: [] as string[] };
    try {
      const existing = (await this.media.listConfigPaths()).filter((p) => p.name.startsWith(MEDIA_PATH_PREFIX));
      const existingByName = new Map(existing.map((p) => [p.name, p]));
      for (const [name, want] of desired) {
        const have = existingByName.get(name);
        if (!have) {
          await this.media.addPath(name, want.config);
          stats.added += 1;
          continue;
        }
        const diff = (Object.keys(want.config) as Array<keyof ManagedPathConfig>).filter((k) => normalize(have[k], k) !== normalize(want.config[k], k));
        if (diff.length) {
          await this.media.patchPath(name, want.config);
          stats.patched += 1;
          stats.differences.push(...diff.filter((k) => k !== 'source'));
        }
      }
      for (const have of existing) if (!desired.has(have.name)) {
        await this.media.deletePath(have.name);
        stats.deleted += 1;
      }
      runtime = (await this.media.listRuntimePaths()).filter((p) => p.name.startsWith(MEDIA_PATH_PREFIX));
    } catch (error) {
      await this.writeStatus(sources, () => ({ state: 'media_unavailable', recording: false, reason: '影像服務暫時無法連線', tracks: [], readers: 0 }), demand);
      throw error;
    }

    const runtimeByName = new Map(runtime.map((p) => [p.name, p]));
    await this.writeStatus(sources, (source) => {
      const rev = source.currentRevisionId ? revById.get(source.currentRevisionId) : undefined;
      if (!source.enabled) return { state: 'disabled', recording: false, reason: '來源已停用', tracks: [], readers: 0 };
      if (errors.has(source.id)) return { state: 'error', recording: false, reason: errors.get(source.id)!, tracks: [], readers: 0 };
      const want = rev ? desired.get(rev.mediaPath) : undefined;
      const rt = rev ? runtimeByName.get(rev.mediaPath) : undefined;
      if (!want) return { state: 'idle', recording: false, reason: null, tracks: [], readers: 0 };
      const recording = Boolean(want.config.record && rt?.ready);
      const reason = want.wantRecording && !storage.ok ? `錄影暫停：${storage.reason}` : want.wantRecording && !rt?.ready ? '來源尚未連線，連上後開始錄影' : null;
      const state = rt?.ready ? 'online' : want.config.sourceOnDemand ? 'idle' : 'connecting';
      return { state, recording, reason, tracks: rt?.tracks ?? [], readers: rt?.readers?.length ?? 0 };
    }, demand);
    if (stats.patched) this.logger.log(`已更新 ${stats.patched} 個媒體路徑（${[...new Set(stats.differences)].join('、') || '來源'}）`);
    return stats;
  }

  private async writeStatus(sources: VideoSource[], compute: (s: VideoSource) => Omit<ActualStatus, 'checkedAt' | 'desiredRecording'>, demand: Map<string, { recording: boolean }>) {
    let changed = false;
    for (const source of sources) {
      const next = { ...compute(source), desiredRecording: source.enabled && (demand.get(source.id)?.recording ?? false) };
      const prev = source.actualStatus as Partial<ActualStatus>;
      const same = prev && prev.state === next.state && prev.recording === next.recording && prev.reason === next.reason && prev.desiredRecording === next.desiredRecording && JSON.stringify(prev.tracks ?? []) === JSON.stringify(next.tracks) && prev.readers === next.readers;
      if (same) continue;
      changed = true;
      await this.dataSource.manager.update(VideoSource, { id: source.id }, { actualStatus: { ...next, checkedAt: Date.now() } as never });
    }
    if (changed) this.config.changed('video_status');
  }
}

/** Go duration（媒體服務會把 60s 回成 1m0s）換成秒數後比較，避免每次都重送設定 */
function goDurationSeconds(value: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/.exec(value.trim());
  if (!m || !value.trim()) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 1000;
}

const DURATION_KEYS = new Set(['recordSegmentDuration', 'recordPartDuration', 'recordDeleteAfter']);

function normalize(value: unknown, key?: string) {
  // 媒體服務把 0s 回成空字串
  if (key && DURATION_KEYS.has(key) && (value === '' || value === null || value === undefined)) return '0s';
  if (typeof value === 'string') {
    const seconds = goDurationSeconds(value);
    return seconds === null ? value.trim() : `${seconds}s`;
  }
  return JSON.stringify(value ?? null);
}

export const __test = { goDurationSeconds, normalize };
