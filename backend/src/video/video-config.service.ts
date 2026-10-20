import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import type { AuthUser } from '../access-control/auth.service';
import {
  VideoMonitorTab,
  VideoMonitorTile,
  VideoSettings,
  VideoSource,
  VideoSourceDefaults,
  VideoSourceRevision,
  type RecordingProfile,
} from '../database/entities/video.entities';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import {
  buildSourceUrl,
  checkHostAllowed,
  maskedSourceUrl,
  normalizeHost,
  normalizePath,
  normalizePort,
  normalizeProtocol,
  parseSourceUrl,
  renderPathTemplate,
  sanitizeTemplateVars,
  validateAllowlistEntry,
  type SourceAddress,
  type TemplateVars,
} from './source-address';
import { mediaPathOf } from './video.config';
import { CANVAS, duplicateName, fullCanvas, normalizeTags, parseAspect, parseLayout, tagKey, type LayoutRect } from './video-layout';
import { decryptSecret, encryptSecret } from './video-secrets';

export const VIDEO_TAG = 'table:video_sources';

export type ConnectionInput = {
  mode?: 'fields' | 'url';
  url?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  path?: unknown;
  query?: unknown;
  username?: unknown;
  /** 只寫：空白／未提供＝保留原密碼；clearPassword=true 才清除 */
  password?: unknown;
  clearPassword?: unknown;
};

export type SourceInput = {
  name?: unknown;
  enabled?: unknown;
  connection?: ConnectionInput;
  vehicleCode?: unknown;
  cameraId?: unknown;
  location?: unknown;
  recordingProfile?: unknown;
  timestampBasis?: unknown;
  expectedVersion?: unknown;
  tags?: unknown;
  recordingEnabled?: unknown;
};

/** 實際狀態超過這麼久沒更新就視為過期（畫面顯示「狀態待更新」，不沿用上次綠燈） */
export const STATUS_STALE_MS = 90_000;

/** 建立／修改來源時可做的錄影變更：需要錄影管理權限才能讓來源儲存錄影 */
export type RecordingPermission = { canManageRecording: boolean };

const RECORDING_DENIED = '讓來源「儲存錄影」需要錄影管理權限；請取消「儲存錄影」後再儲存，或請管理者處理';

type ResolvedConnection = { address: SourceAddress; secret: { kind: 'keep' } | { kind: 'set'; value: string } | { kind: 'clear' } };

const text = (raw: unknown, label: string, max: number, required = false): string | null => {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BadRequestException(`請輸入${label}`);
    return null;
  }
  if (typeof raw !== 'string') throw new BadRequestException(`${label}格式不正確`);
  const value = raw.trim();
  if (!value) {
    if (required) throw new BadRequestException(`請輸入${label}`);
    return null;
  }
  if (value.length > max) throw new BadRequestException(`${label}最多 ${max} 字`);
  return value;
};

const versionOf = (raw: unknown) => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new BadRequestException('缺少版本資訊，請重新整理');
  return value;
};

export function addressOf(rev: Pick<VideoSourceRevision, 'protocol' | 'host' | 'port' | 'path' | 'query' | 'username'>): SourceAddress {
  return { protocol: rev.protocol, host: rev.host, port: rev.port, path: rev.path, query: rev.query, username: rev.username };
}

/**
 * 影像來源、監控標籤／格子與全域預設的設定（存在資料庫，不靠瀏覽器）。
 *
 * - 來源版本不可變：連線或關聯改變就建立新版本（新的媒體路徑），舊錄影仍以穩定 sourceId 查詢。
 * - 標籤與來源分開：同一來源可被多格引用，只接入、錄製一份。
 * - 密碼只寫不讀：回應只有 hasPassword；空白保留原密碼，明確 clearPassword 才清除。
 * - 所有修改帶 expectedVersion，後端拒絕舊版本覆蓋較新的設定。
 */
@Injectable()
export class VideoConfigService {
  constructor(private readonly dataSource: DataSource, @Optional() private readonly invalidation?: DatasourceInvalidationService) {}

  /** 協調器註冊：設定變更後盡快套用到媒體服務 */
  onChange?: () => void;

  changed(reason: string) {
    this.invalidation?.emit([VIDEO_TAG], reason);
    if (reason !== 'video_status') this.onChange?.();
  }

  // ── 系統設定（連線範圍） ─────────────────────────────
  async settings(manager: EntityManager = this.dataSource.manager): Promise<VideoSettings> {
    let row = await manager.findOne(VideoSettings, { where: { id: 1 } });
    if (!row) {
      await manager.createQueryBuilder().insert().into(VideoSettings).values({ id: 1 }).orIgnore().execute();
      row = await manager.findOneOrFail(VideoSettings, { where: { id: 1 } });
    }
    return row;
  }

  async updateSettings(input: { allowedNetworks?: unknown; expectedVersion?: unknown }) {
    const expected = versionOf(input.expectedVersion);
    if (!Array.isArray(input.allowedNetworks)) throw new BadRequestException('請提供允許的攝影機網段清單');
    if (input.allowedNetworks.length > 100) throw new BadRequestException('最多 100 筆');
    const list = [...new Set(input.allowedNetworks.map((v) => validateAllowlistEntry(String(v))))];
    const result = await this.dataSource.manager.update(VideoSettings, { id: 1, version: expected }, { allowedNetworks: list, version: expected + 1, updatedAt: Date.now() });
    if (!result.affected) throw new ConflictException('連線範圍已被其他人修改，請重新整理');
    this.changed('video_settings');
    return this.settings();
  }

  // ── 連線輸入與檢查 ───────────────────────────────────
  async resolveConnection(input: ConnectionInput | undefined, allowlist: string[], previous?: VideoSourceRevision | null): Promise<ResolvedConnection> {
    if (!input || typeof input !== 'object') throw new BadRequestException('請輸入影像來源');
    let address: SourceAddress;
    let password: string | null = null;
    if (input.mode === 'url') {
      const url = text(input.url, '來源網址', 1000, true)!;
      const parsed = parseSourceUrl(url);
      address = parsed.address;
      password = parsed.password;
    } else {
      address = {
        protocol: normalizeProtocol(input.protocol),
        host: normalizeHost(text(input.host, '主機', 255, true)),
        port: normalizePort(input.port),
        path: normalizePath(text(input.path, '路徑', 500)),
        query: text(input.query, '查詢參數', 500),
        username: text(input.username, '帳號', 120),
      };
      password = typeof input.password === 'string' && input.password ? input.password : null;
    }
    if (password && password.length > 200) throw new BadRequestException('密碼最多 200 字');
    const check = await checkHostAllowed(address.host, allowlist);
    if (!check.ok) throw new BadRequestException(check.reason);
    const secret: ResolvedConnection['secret'] = password
      ? { kind: 'set', value: password }
      : input.clearPassword === true || !address.username
        ? { kind: 'clear' }
        : previous?.secretCiphertext ? { kind: 'keep' } : { kind: 'clear' };
    return { address, secret };
  }

  /** 解開密碼並組出媒體服務用的網址（RTSP／RTMP／SRT 改用檢查過的 IP，避免 DNS rebinding） */
  async mediaSourceUrl(rev: VideoSourceRevision, allowlist: string[]): Promise<string> {
    const address = addressOf(rev);
    const check = await checkHostAllowed(address.host, allowlist);
    if (!check.ok) throw new ForbiddenException(check.reason);
    const pinned = ['rtsp', 'rtmp', 'srt'].includes(address.protocol) ? check.addresses[0] : undefined;
    return buildSourceUrl(address, decryptSecret(rev.secretCiphertext), pinned);
  }

  // ── 來源 ─────────────────────────────────────────────
  /** 實際狀態加上是否過期：過期的狀態不能當成目前在線 */
  statusOf(source: VideoSource) {
    const st = (source.actualStatus ?? {}) as Record<string, unknown>;
    const checkedAt = typeof st.checkedAt === 'number' ? st.checkedAt : null;
    return { ...st, checkedAt, stale: checkedAt === null || Date.now() - checkedAt > STATUS_STALE_MS } as Record<string, unknown> & { checkedAt: number | null; stale: boolean; state?: string };
  }

  private presentSource(source: VideoSource, rev: VideoSourceRevision | null, usage: { tiles: number; tabs?: number }) {
    return {
      id: source.id,
      name: source.name,
      enabled: source.enabled,
      recordingEnabled: source.recordingEnabled,
      tags: source.tags ?? [],
      version: source.version,
      recordingProfile: source.recordingProfile,
      revisionId: rev?.id ?? null,
      revisionNo: rev?.revisionNo ?? null,
      connection: rev
        ? {
            protocol: rev.protocol,
            host: rev.host,
            port: rev.port,
            path: rev.path,
            query: rev.query,
            username: rev.username,
            hasPassword: Boolean(rev.secretCiphertext),
            maskedUrl: maskedSourceUrl(addressOf(rev), Boolean(rev.secretCiphertext)),
          }
        : null,
      vehicleCode: rev?.vehicleCode ?? null,
      cameraId: rev?.cameraId ?? null,
      location: rev?.location ?? null,
      timestampBasis: rev?.timestampBasis ?? 'center',
      usage,
      // 需求（來源啟用且勾選儲存錄影）與實際狀態分開回報
      desiredRecording: source.enabled && source.recordingEnabled && source.deletedAt === null,
      actualStatus: this.statusOf(source),
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }

  /** 被幾個監控格子／標籤頁引用（只是資訊；錄影不看格子） */
  private async usage(manager: EntityManager, sourceIds: string[]) {
    if (!sourceIds.length) return new Map<string, { tiles: number; tabs: number }>();
    const rows: Array<{ source_id: string; tiles: string; tabs: string }> = await manager.query(
      `SELECT t.source_id, count(*) AS tiles, count(DISTINCT t.tab_id) AS tabs
         FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
        WHERE t.source_id = ANY($1::uuid[]) GROUP BY t.source_id`,
      [sourceIds],
    );
    return new Map(rows.map((r) => [r.source_id, { tiles: Number(r.tiles), tabs: Number(r.tabs) }]));
  }

  /**
   * 來源清單（影像資源管理）：分頁、關鍵字（名稱／載具／位置）、來源標籤（任一符合）、啟用、上線狀態。
   * 穩定排序（名稱、ID）。不建立任何播放 session、不回傳密碼。
   */
  async querySources(query: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(Number(query.pageSize) || 20)));
    const where: string[] = ['s.deleted_at IS NULL'];
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    if (q) {
      const like = add(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(s.name ILIKE ${like} OR r.vehicle_code ILIKE ${like} OR r.location ILIKE ${like} OR r.camera_id ILIKE ${like})`);
    }
    const tags = String(query.tags ?? '').split(',').map((t) => tagKey(t)).filter(Boolean).slice(0, 20);
    if (tags.length) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.tags) tg WHERE lower(regexp_replace(normalize(tg, NFKC), '\\s+', ' ', 'g')) = ANY(${add(tags)}::text[]))`);
    if (query.enabled === 'true' || query.enabled === 'false') where.push(`s.enabled = ${add(query.enabled === 'true')}`);
    // 上線狀態分類：停用／在線（新鮮的 online）／離線（新鮮的離線或錯誤）／未知（沒檢查過或已過期）
    const category = (fresh: string) => `CASE WHEN NOT s.enabled THEN 'disabled'
        WHEN COALESCE((s.actual_status->>'checkedAt')::bigint, 0) < ${fresh} THEN 'unknown'
        WHEN s.actual_status->>'state' = 'online' THEN 'online'
        WHEN s.actual_status->>'state' IN ('offline', 'error', 'media_unavailable') THEN 'offline'
        ELSE 'unknown' END`;
    if (['online', 'offline', 'unknown', 'disabled'].includes(String(query.online))) {
      const fresh = add(Date.now() - STATUS_STALE_MS);
      where.push(`${category(fresh)} = ${add(String(query.online))}`);
    }
    const base = `FROM video_sources s LEFT JOIN video_source_revisions r ON r.id = s.current_revision_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${base}`, params);
    const rows: Array<{ id: string }> = await this.dataSource.query(`SELECT s.id ${base} ORDER BY lower(s.name), s.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
    const ids = rows.map((r) => r.id);
    const sources = ids.length ? await this.dataSource.manager.find(VideoSource, { where: { id: In(ids) } }) : [];
    const revIds = sources.map((s) => s.currentRevisionId).filter(Boolean) as string[];
    const revisions = revIds.length ? await this.dataSource.manager.find(VideoSourceRevision, { where: { id: In(revIds) } }) : [];
    const revById = new Map(revisions.map((r) => [r.id, r]));
    const usage = await this.usage(this.dataSource.manager, ids);
    const byId = new Map(sources.map((s) => [s.id, s]));
    return {
      page,
      pageSize,
      total,
      items: ids.map((id) => byId.get(id)!).map((s) => this.presentSource(s, revById.get(s.currentRevisionId ?? '') ?? null, usage.get(s.id) ?? { tiles: 0, tabs: 0 })),
    };
  }

  /** 來源標籤選項與筆數（規範化後合併，顯示第一次出現的寫法） */
  async sourceTags() {
    const rows: Array<{ tags: string[] }> = await this.dataSource.query(`SELECT tags FROM video_sources WHERE deleted_at IS NULL`);
    const map = new Map<string, { tag: string; count: number }>();
    for (const row of rows) for (const tag of row.tags ?? []) {
      const key = tagKey(tag);
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { tag, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'zh-Hant') || a.tag.localeCompare(b.tag));
  }

  /**
   * 安全來源選項（即時監控的格子選單、歷史查詢）：只有名稱、標籤、載具、位置、啟用與狀態，沒有任何連線資訊。
   * includeDeleted 給歷史查詢用（已刪除但仍有錄影的來源）。
   */
  async sourceOptions(query: Record<string, unknown>) {
    const includeDeleted = query.includeDeleted === 'true';
    const sources = await this.dataSource.manager.find(VideoSource, { where: includeDeleted ? {} : { deletedAt: IsNull() }, order: { name: 'ASC', id: 'ASC' } });
    const revIds = sources.map((s) => s.currentRevisionId).filter(Boolean) as string[];
    const revisions = revIds.length ? await this.dataSource.manager.find(VideoSourceRevision, { where: { id: In(revIds) } }) : [];
    const revById = new Map(revisions.map((r) => [r.id, r]));
    const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
    const items = sources.map((s) => {
      const rev = revById.get(s.currentRevisionId ?? '');
      const st = this.statusOf(s);
      return {
        id: s.id,
        name: s.name,
        tags: s.tags ?? [],
        vehicleCode: rev?.vehicleCode ?? null,
        location: rev?.location ?? null,
        enabled: s.enabled,
        deleted: s.deletedAt !== null,
        state: s.deletedAt !== null ? 'deleted' : !s.enabled ? 'disabled' : st.stale ? 'unknown' : String(st.state ?? 'unknown'),
      };
    });
    const filtered = q
      ? items.filter((i) => [i.name, i.vehicleCode, i.location, ...i.tags].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
      : items;
    return { items: filtered.slice(0, 500), total: filtered.length };
  }

  async getSource(id: string) {
    const source = await this.findSource(this.dataSource.manager, id);
    const rev = source.currentRevisionId ? await this.dataSource.manager.findOne(VideoSourceRevision, { where: { id: source.currentRevisionId } }) : null;
    const usage = await this.usage(this.dataSource.manager, [id]);
    const tiles = await this.dataSource.manager.query(
      `SELECT tb.id AS tab_id, tb.name AS tab_name, t.id AS tile_id, t.position, t.display_name
         FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
        WHERE t.source_id = $1 ORDER BY tb.position, t.position`,
      [id],
    );
    return { ...this.presentSource(source, rev, usage.get(id) ?? { tiles: 0, tabs: 0 }), usedBy: tiles };
  }

  private async findSource(manager: EntityManager, id: string, lock = false) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('找不到影像來源');
    const qb = manager.getRepository(VideoSource).createQueryBuilder('s').where('s.id = :id', { id });
    if (lock) qb.setLock('pessimistic_write');
    const source = await qb.getOne();
    if (!source || source.deletedAt) throw new NotFoundException('找不到影像來源');
    return source;
  }

  private sourceMeta(input: SourceInput, prev?: VideoSourceRevision | null) {
    const vehicleCode = input.vehicleCode === undefined ? prev?.vehicleCode ?? null : text(input.vehicleCode, '載具', 64);
    const cameraId = input.cameraId === undefined ? prev?.cameraId ?? null : text(input.cameraId, '攝影機識別', 120);
    const location = input.location === undefined ? prev?.location ?? null : text(input.location, '位置／視角', 200);
    const basis = input.timestampBasis === undefined ? prev?.timestampBasis ?? 'center' : input.timestampBasis;
    if (basis !== 'center' && basis !== 'source') throw new BadRequestException('時間基準只能是中心接收時間或來源時間');
    return { vehicleCode, cameraId, location, timestampBasis: basis as 'center' | 'source' };
  }

  private profile(raw: unknown, fallback: RecordingProfile = 'original'): RecordingProfile {
    if (raw === undefined) return fallback;
    if (raw !== 'original' && raw !== 'balanced' && raw !== 'saving') throw new BadRequestException('錄影品質只能是原始、平衡或節省空間');
    return raw;
  }

  private async insertRevision(manager: EntityManager, sourceId: string, revisionNo: number, conn: ResolvedConnection, meta: ReturnType<VideoConfigService['sourceMeta']>, actor: string | null, prevSecret: string | null) {
    const id = randomUUID();
    const now = Date.now();
    const secretCiphertext = conn.secret.kind === 'set' ? encryptSecret(conn.secret.value) : conn.secret.kind === 'keep' ? prevSecret : null;
    await manager.insert(VideoSourceRevision, {
      id,
      sourceId,
      revisionNo,
      ...conn.address,
      secretCiphertext,
      ...meta,
      mediaPath: mediaPathOf(id),
      validFrom: now,
      validTo: null,
      createdBy: actor,
      createdAt: now,
    });
    return id;
  }

  async createSource(input: SourceInput, actor: AuthUser, perm: RecordingPermission = { canManageRecording: true }, manager?: EntityManager) {
    // 新來源預設儲存錄影；沒有錄影管理權限就整個拒絕，不偷偷改成不錄
    const recordingEnabled = input.recordingEnabled === undefined ? true : input.recordingEnabled === true;
    if (recordingEnabled && !perm.canManageRecording) throw new ForbiddenException(RECORDING_DENIED);
    const tags = normalizeTags(input.tags);
    const run = async (m: EntityManager) => {
      const settings = await this.settings(m);
      const count = await m.count(VideoSource, { where: { deletedAt: IsNull() } });
      if (count >= settings.maxSources) throw new BadRequestException(`影像來源已達上限 ${settings.maxSources} 個`);
      const name = text(input.name, '影像名稱', 120, true)!;
      const conn = await this.resolveConnection(input.connection, settings.allowedNetworks);
      const now = Date.now();
      const sourceId = randomUUID();
      await m.insert(VideoSource, { id: sourceId, name, enabled: input.enabled === false ? false : true, recordingEnabled, tags, requestId: null, recordingProfile: this.profile(input.recordingProfile), actualStatus: {}, version: 1, createdBy: actor.id, createdAt: now, updatedAt: now, deletedAt: null });
      const revId = await this.insertRevision(m, sourceId, 1, conn, this.sourceMeta(input), actor.id, null);
      await m.update(VideoSource, { id: sourceId }, { currentRevisionId: revId });
      return sourceId;
    };
    const id = manager ? await run(manager) : await this.dataSource.transaction(run);
    if (!manager) this.changed('video_source_create');
    return id;
  }

  /**
   * 修改來源：名稱、啟用、錄影品質直接改；連線或關聯（載具、攝影機、位置、時間基準）改變時建立新版本。
   * 這是「修改共用來源」：所有引用這個來源的格子都會跟著換（畫面先列出影響再確認）。
   */
  async updateSource(id: string, input: SourceInput, actor: AuthUser, perm: RecordingPermission = { canManageRecording: true }) {
    const expected = versionOf(input.expectedVersion);
    await this.dataSource.transaction(async (m) => {
      const source = await this.findSource(m, id, true);
      if (source.version !== expected) throw new ConflictException('影像來源已被其他人修改，請重新整理');
      if (input.recordingEnabled !== undefined && (input.recordingEnabled === true) !== source.recordingEnabled && !perm.canManageRecording) {
        throw new ForbiddenException('變更來源的「儲存錄影」需要錄影管理權限');
      }
      const settings = await this.settings(m);
      const prev = source.currentRevisionId ? await m.findOne(VideoSourceRevision, { where: { id: source.currentRevisionId } }) : null;
      const patch: Partial<VideoSource> = { version: expected + 1, updatedAt: Date.now() };
      if (input.name !== undefined) patch.name = text(input.name, '影像名稱', 120, true)!;
      if (input.enabled !== undefined) patch.enabled = input.enabled === true;
      if (input.recordingProfile !== undefined) patch.recordingProfile = this.profile(input.recordingProfile);
      // 名稱、標籤、啟用、儲存錄影不建立新版本、不重啟串流
      if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
      if (input.recordingEnabled !== undefined) patch.recordingEnabled = input.recordingEnabled === true;
      const meta = this.sourceMeta(input, prev);
      const metaChanged = !prev || meta.vehicleCode !== prev.vehicleCode || meta.cameraId !== prev.cameraId || meta.location !== prev.location || meta.timestampBasis !== prev.timestampBasis;
      let conn: ResolvedConnection | null = null;
      if (input.connection) {
        conn = await this.resolveConnection(input.connection, settings.allowedNetworks, prev);
      }
      const connChanged = conn !== null && (!prev
        || JSON.stringify(conn.address) !== JSON.stringify(addressOf(prev))
        || conn.secret.kind === 'set'
        || (conn.secret.kind === 'clear' && Boolean(prev.secretCiphertext)));
      if (connChanged || (metaChanged && prev)) {
        const resolved = conn ?? { address: addressOf(prev!), secret: { kind: 'keep' as const } };
        const now = Date.now();
        if (prev) await m.update(VideoSourceRevision, { id: prev.id }, { validTo: now });
        patch.currentRevisionId = await this.insertRevision(m, id, (prev?.revisionNo ?? 0) + 1, resolved, meta, actor.id, prev?.secretCiphertext ?? null);
      }
      await m.update(VideoSource, { id }, patch as never);
    });
    this.changed('video_source_update');
    return this.getSource(id);
  }

  /** 刪除前的影響：被幾個標籤頁／格子引用、是否會停止錄影 */
  async deleteImpact(id: string) {
    const source = await this.findSource(this.dataSource.manager, id);
    const usage = (await this.usage(this.dataSource.manager, [id])).get(id) ?? { tiles: 0, tabs: 0 };
    return { sourceId: id, name: source.name, tabs: usage.tabs, tiles: usage.tiles, stopsRecording: source.enabled && source.recordingEnabled, keepsHistory: true };
  }

  /**
   * 移除來源：停用＋soft delete；不刪錄影，歷史仍可用 sourceId 查。
   * 格子保留原本位置與綁定（畫面顯示「來源已刪除」，可重新選來源），不刪格也不重排版面。
   */
  async deleteSource(id: string, expectedRaw: unknown) {
    const expected = versionOf(expectedRaw);
    await this.dataSource.transaction(async (m) => {
      const source = await this.findSource(m, id, true);
      if (source.version !== expected) throw new ConflictException('影像來源已被其他人修改，請重新整理');
      const now = Date.now();
      await m.update(VideoSource, { id }, { enabled: false, deletedAt: now, updatedAt: now, version: expected + 1 });
      if (source.currentRevisionId) await m.update(VideoSourceRevision, { id: source.currentRevisionId, validTo: IsNull() }, { validTo: now });
    });
    this.changed('video_source_delete');
    return { deleted: true };
  }

  /** 清單直接啟停：只改 enabled，回目前設定與實際狀態（網路協調由 worker 非同步套用） */
  async setEnabled(id: string, input: { expectedVersion?: unknown; enabled?: unknown }) {
    const expected = versionOf(input.expectedVersion);
    if (typeof input.enabled !== 'boolean') throw new BadRequestException('請指定啟用或停用');
    const enabled = input.enabled;
    await this.dataSource.transaction(async (m) => {
      const source = await this.findSource(m, id, true);
      if (source.version !== expected) throw new ConflictException('影像來源已被其他人修改，請重新整理');
      await m.update(VideoSource, { id }, { enabled, version: expected + 1, updatedAt: Date.now() });
    });
    this.changed(enabled ? 'video_source_enable' : 'video_source_disable');
    return { ...(await this.getSource(id)), settingAccepted: true };
  }

  /**
   * 一鍵複製：新 sourceId、新 revision、新媒體路徑；連線、密碼（伺服器內重新加密）、標籤、啟用、儲存錄影與品質都相同，
   * 名稱為「原名稱的複製」。不複製歷史、狀態、播放授權、工作與建立者。requestId 讓網路重試不會建立第二份。
   */
  async duplicateSource(id: string, input: { expectedVersion?: unknown; requestId?: unknown }, actor: AuthUser, perm: RecordingPermission = { canManageRecording: true }) {
    const expected = versionOf(input.expectedVersion);
    const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(input.requestId) ? input.requestId : null;
    if (!requestId) throw new BadRequestException('缺少請求識別碼，請重新整理後再試');
    const newId = await this.dataSource.transaction(async (m) => {
      const done = await m.findOne(VideoSource, { where: { requestId } });
      if (done) return done.id;
      const source = await this.findSource(m, id, true);
      if (source.version !== expected) throw new ConflictException('影像來源已被其他人修改，請重新整理');
      if (source.recordingEnabled && !perm.canManageRecording) throw new ForbiddenException('複製會儲存錄影的來源需要錄影管理權限');
      const settings = await this.settings(m);
      const count = await m.count(VideoSource, { where: { deletedAt: IsNull() } });
      if (count >= settings.maxSources) throw new BadRequestException(`影像來源已達上限 ${settings.maxSources} 個`);
      const rev = source.currentRevisionId ? await m.findOne(VideoSourceRevision, { where: { id: source.currentRevisionId } }) : null;
      if (!rev) throw new BadRequestException('來源尚未設定連線，無法複製');
      const now = Date.now();
      const sourceId = randomUUID();
      await m.insert(VideoSource, {
        id: sourceId, name: duplicateName(source.name), enabled: source.enabled, recordingEnabled: source.recordingEnabled, tags: [...(source.tags ?? [])],
        requestId, recordingProfile: source.recordingProfile, actualStatus: {}, version: 1, createdBy: actor.id, createdAt: now, updatedAt: now, deletedAt: null,
      });
      const revId = randomUUID();
      // 密碼在伺服器內重新加密（新的 IV），不共用原密文、不經過瀏覽器
      const secret = rev.secretCiphertext ? encryptSecret(decryptSecret(rev.secretCiphertext) ?? '') : null;
      await m.insert(VideoSourceRevision, {
        id: revId, sourceId, revisionNo: 1, ...addressOf(rev), secretCiphertext: secret, vehicleCode: rev.vehicleCode, cameraId: rev.cameraId, location: rev.location,
        mediaPath: mediaPathOf(revId), timestampBasis: rev.timestampBasis, validFrom: now, validTo: null, createdBy: actor.id, createdAt: now,
      });
      await m.update(VideoSource, { id: sourceId }, { currentRevisionId: revId });
      return sourceId;
    });
    this.changed('video_source_duplicate');
    return this.getSource(newId);
  }

  // ── 全域預設 ─────────────────────────────────────────
  private async defaultsRow(m: EntityManager = this.dataSource.manager) {
    let row = await m.findOne(VideoSourceDefaults, { where: { id: 1 } });
    if (!row) {
      await m.createQueryBuilder().insert().into(VideoSourceDefaults).values({ id: 1 }).orIgnore().execute();
      row = await m.findOneOrFail(VideoSourceDefaults, { where: { id: 1 } });
    }
    return row;
  }

  async getDefaults() {
    const d = await this.defaultsRow();
    return {
      protocol: d.protocol,
      host: d.host,
      port: d.port,
      pathPrefix: d.pathPrefix,
      pathTemplate: d.pathTemplate,
      username: d.username,
      hasPassword: Boolean(d.secretCiphertext),
      recordingDefault: d.recordingDefault,
      version: d.version,
    };
  }

  /** 儲存全域預設：只影響之後新建的來源；要改既有來源需預覽後「套用到來源」 */
  async updateDefaults(input: Record<string, unknown>, actor: AuthUser) {
    const expected = versionOf(input.expectedVersion);
    const settings = await this.settings();
    const host = input.host === undefined || input.host === '' || input.host === null ? null : normalizeHost(String(input.host));
    if (host) {
      const check = await checkHostAllowed(host, settings.allowedNetworks);
      if (!check.ok) throw new BadRequestException(check.reason);
    }
    const template = text(input.pathTemplate, '路徑樣板', 255);
    if (template) renderPathTemplate(template, { vehicleCode: 'x', cameraId: 'x', index: '1' });
    const patch: Partial<VideoSourceDefaults> = {
      protocol: normalizeProtocol(input.protocol ?? 'rtsp'),
      host,
      port: normalizePort(input.port),
      pathPrefix: input.pathPrefix ? normalizePath(String(input.pathPrefix)) : null,
      pathTemplate: template,
      username: text(input.username, '帳號', 120),
      recordingDefault: input.recordingDefault !== false,
      version: expected + 1,
      updatedBy: actor.id,
      updatedAt: Date.now(),
    };
    if (typeof input.password === 'string' && input.password) patch.secretCiphertext = encryptSecret(input.password.slice(0, 200));
    else if (input.clearPassword === true) patch.secretCiphertext = null;
    const result = await this.dataSource.manager.update(VideoSourceDefaults, { id: 1, version: expected }, patch as never);
    if (!result.affected) throw new ConflictException('全域預設已被其他人修改，請重新整理');
    this.changed('video_defaults');
    return this.getDefaults();
  }

  /**
   * 全域預設批次套用（作用對象是來源，不是格子）：先預覽每個來源的連線差異，明確套用才修改。
   * 路徑由「前綴＋樣板」算出；樣板只允許白名單變數（vehicleCode、cameraId、index＝在這批中的順序）。
   * 套用會為有變化的來源建立新版本（新媒體路徑），密碼使用全域預設的密碼（只在後端解開）。
   */
  async planApply(m: EntityManager, input: { scope?: unknown; sourceIds?: unknown; tags?: unknown }) {
    const d = await this.defaultsRow(m);
    if (!d.host) throw new BadRequestException('請先設定全域來源預設的主機');
    const scope = input.scope;
    if (scope !== 'sources' && scope !== 'tags' && scope !== 'all') throw new BadRequestException('套用範圍只能是勾選的來源、來源標籤或全部來源');
    let sources = await m.find(VideoSource, { where: { deletedAt: IsNull() }, order: { name: 'ASC', id: 'ASC' } });
    if (scope === 'sources') {
      if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 500) throw new BadRequestException('請勾選要套用的來源');
      const ids = new Set(input.sourceIds.map(String));
      sources = sources.filter((s) => ids.has(s.id));
    }
    if (scope === 'tags') {
      const keys = new Set(normalizeTags(input.tags).map(tagKey));
      if (!keys.size) throw new BadRequestException('請選擇來源標籤');
      sources = sources.filter((s) => (s.tags ?? []).some((t) => keys.has(tagKey(t))));
    }
    const revIds = sources.map((s) => s.currentRevisionId).filter(Boolean) as string[];
    const revisions = revIds.length ? await m.find(VideoSourceRevision, { where: { id: In(revIds) } }) : [];
    const revBySource = new Map(revisions.map((r) => [r.sourceId, r]));
    const items = sources.map((source, index) => {
      const rev = revBySource.get(source.id);
      const base = { sourceId: source.id, name: source.name, version: source.version };
      const before = rev ? maskedSourceUrl(addressOf(rev), Boolean(rev.secretCiphertext)) : null;
      try {
        const vars: TemplateVars = { ...sanitizeTemplateVars({ vehicleCode: rev?.vehicleCode ?? '', cameraId: rev?.cameraId ?? '' }), index: String(index + 1) };
        const tail = d.pathTemplate ? renderPathTemplate(d.pathTemplate, vars) : '';
        const path = normalizePath(`${d.pathPrefix ?? ''}${tail}`);
        const address: SourceAddress = { protocol: d.protocol as SourceAddress['protocol'], host: d.host!, port: d.port, path, query: null, username: d.username };
        const after = maskedSourceUrl(address, Boolean(d.secretCiphertext));
        const same = rev !== undefined && JSON.stringify(addressOf(rev)) === JSON.stringify(address) && (rev.secretCiphertext === null) === (d.secretCiphertext === null);
        return { ...base, action: same ? ('same' as const) : ('update' as const), before, after, address, reason: same ? '連線相同，不需更新' : null };
      } catch (error) {
        return { ...base, action: 'error' as const, before, after: null, reason: (error as Error).message };
      }
    });
    return { defaults: d, items };
  }

  async previewApply(input: Record<string, unknown>) {
    const { defaults, items } = await this.planApply(this.dataSource.manager, input);
    return {
      defaultsVersion: defaults.version,
      items: items.map((item) => {
        const { address: _address, ...rest } = item as typeof item & { address?: SourceAddress };
        return rest;
      }),
    };
  }

  async apply(input: Record<string, unknown>, actor: AuthUser) {
    const expected = versionOf(input.defaultsVersion);
    const result = await this.dataSource.transaction(async (m) => {
      const { defaults, items } = await this.planApply(m, input);
      if (defaults.version !== expected) throw new ConflictException('全域預設在預覽後被修改，請重新預覽');
      const errors = items.filter((i) => i.action === 'error');
      if (errors.length) throw new BadRequestException(`有 ${errors.length} 個來源無法套用：${errors[0].reason}`);
      const settings = await this.settings(m);
      const check = await checkHostAllowed(defaults.host!, settings.allowedNetworks);
      if (!check.ok) throw new BadRequestException(check.reason);
      const applied: Array<{ sourceId: string }> = [];
      for (const item of items) {
        if (item.action !== 'update') continue;
        const source = await this.findSource(m, item.sourceId, true);
        if (source.version !== item.version) throw new ConflictException(`來源「${source.name}」在預覽後被修改，請重新預覽`);
        const prev = source.currentRevisionId ? await m.findOne(VideoSourceRevision, { where: { id: source.currentRevisionId } }) : null;
        const now = Date.now();
        if (prev) await m.update(VideoSourceRevision, { id: prev.id }, { validTo: now });
        const revId = randomUUID();
        await m.insert(VideoSourceRevision, {
          id: revId, sourceId: source.id, revisionNo: (prev?.revisionNo ?? 0) + 1, ...(item as { address: SourceAddress }).address, secretCiphertext: defaults.secretCiphertext,
          vehicleCode: prev?.vehicleCode ?? null, cameraId: prev?.cameraId ?? null, location: prev?.location ?? null, mediaPath: mediaPathOf(revId),
          timestampBasis: prev?.timestampBasis ?? 'center', validFrom: now, validTo: null, createdBy: actor.id, createdAt: now,
        });
        await m.update(VideoSource, { id: source.id }, { currentRevisionId: revId, version: source.version + 1, updatedAt: now });
        applied.push({ sourceId: source.id });
      }
      return { applied, unchanged: items.filter((i) => i.action === 'same').length };
    });
    this.changed('video_defaults_apply');
    return result;
  }

  // ── 監控標籤頁與版面 ─────────────────────────────────
  async listTabs() {
    await this.ensureDefaultTab();
    const tabs = await this.dataSource.manager.find(VideoMonitorTab, { where: { deletedAt: IsNull() }, order: { position: 'ASC', createdAt: 'ASC' } });
    const tiles = await this.dataSource.manager.find(VideoMonitorTile, { where: { tabId: In(tabs.map((t) => t.id)) }, order: { position: 'ASC' } });
    return tabs.map((tab) => this.presentTab(tab, tiles.filter((t) => t.tabId === tab.id)));
  }

  private presentTab(tab: VideoMonitorTab, tiles: VideoMonitorTile[]) {
    return {
      id: tab.id,
      name: tab.name,
      position: tab.position,
      tileCount: tiles.length,
      canvasAspectRatio: Number(tab.canvasAspectRatio),
      layoutSchemaVersion: tab.layoutSchemaVersion,
      canvas: CANVAS,
      version: tab.version,
      tiles: tiles.sort((a, b) => a.position - b.position).map((t) => this.presentTile(t)),
    };
  }

  private presentTile(t: VideoMonitorTile) {
    return { id: t.id, position: t.position, sourceId: t.sourceId, displayName: t.displayName, x: t.x, y: t.y, w: t.w, h: t.h, version: t.version };
  }

  private async tabWithTiles(id: string) {
    const tab = await this.dataSource.manager.findOne(VideoMonitorTab, { where: { id, deletedAt: IsNull() } });
    if (!tab) throw new NotFoundException('找不到監控標籤頁');
    return this.presentTab(tab, await this.dataSource.manager.find(VideoMonitorTile, { where: { tabId: id } }));
  }

  /** 第一次進入時建立「監控總覽」1 格滿版（只有空白格子，不植入假攝影機） */
  async ensureDefaultTab() {
    const count = await this.dataSource.manager.count(VideoMonitorTab, { where: { deletedAt: IsNull() } });
    if (count > 0) return;
    await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-default-tab'))`);
      if ((await m.count(VideoMonitorTab, { where: { deletedAt: IsNull() } })) > 0) return;
      await this.insertTab(m, '監控總覽', 0, null, 16 / 9, [{ ...fullCanvas(), sourceId: null, displayName: null }]);
    });
  }

  private async insertTab(m: EntityManager, name: string, position: number, actor: string | null, aspect: number, tiles: Array<LayoutRect & { sourceId: string | null; displayName: string | null }>) {
    const now = Date.now();
    const id = randomUUID();
    await m.insert(VideoMonitorTab, { id, name, position, tileCount: tiles.length, canvasAspectRatio: aspect, layoutSchemaVersion: 1, version: 1, createdBy: actor, createdAt: now, updatedAt: now, deletedAt: null });
    await m.insert(VideoMonitorTile, tiles.map((t, i) => ({
      id: randomUUID(), tabId: id, position: i, sourceId: t.sourceId, displayName: t.displayName, x: t.x, y: t.y, w: t.w, h: t.h,
      recordingRequested: true, enabled: true, templateVars: {}, version: 1, updatedAt: now,
    })));
    return id;
  }

  /** 新增標籤頁：名稱與版面草稿（1–12 格、沒有來源也可存）；沒給版面就是 1 格滿版 */
  async createTab(input: { name?: unknown; tiles?: unknown; canvasAspectRatio?: unknown }, actor: AuthUser) {
    const name = text(input.name, '標籤名稱', 60, true)!;
    const aspect = parseAspect(input.canvasAspectRatio);
    const layout = input.tiles === undefined ? [{ tileId: null, position: 0, ...fullCanvas() }] : parseLayout(input.tiles);
    if (layout.some((t) => t.tileId)) throw new BadRequestException('新標籤頁的格子不能帶既有識別碼');
    const id = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-tabs'))`);
      const settings = await this.settings(m);
      const count = await m.count(VideoMonitorTab, { where: { deletedAt: IsNull() } });
      if (count >= settings.maxTabs) throw new BadRequestException(`監控標籤頁已達上限 ${settings.maxTabs} 個`);
      const [{ max }] = await m.query(`SELECT COALESCE(max(position), -1) AS max FROM video_monitor_tabs WHERE deleted_at IS NULL`);
      return this.insertTab(m, name, Number(max) + 1, actor.id, aspect, layout.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, sourceId: null, displayName: null })));
    });
    this.changed('video_tab_create');
    return this.tabWithTiles(id);
  }

  private async lockTab(m: EntityManager, id: string, expected: number | null) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('找不到監控標籤頁');
    const tab = await m.getRepository(VideoMonitorTab).createQueryBuilder('t').setLock('pessimistic_write').where('t.id = :id', { id }).getOne();
    if (!tab || tab.deletedAt) throw new NotFoundException('找不到監控標籤頁，可能已被刪除');
    if (expected !== null && tab.version !== expected) throw new ConflictException('監控標籤頁已被其他人修改，請重新整理');
    return tab;
  }

  /** 改名（格數與版面改用 PUT /tabs/:id/layout） */
  async updateTab(id: string, input: { name?: unknown; tileCount?: unknown; expectedVersion?: unknown }) {
    if (input.tileCount !== undefined) throw new BadRequestException({ code: 'CONTRACT_CHANGED', message: '格數改由「編輯版面」設定，請重新整理頁面' });
    const expected = versionOf(input.expectedVersion);
    await this.dataSource.transaction(async (m) => {
      await this.lockTab(m, id, expected);
      await m.update(VideoMonitorTab, { id }, { name: text(input.name, '標籤名稱', 60, true)!, version: expected + 1, updatedAt: Date.now() });
    });
    this.changed('video_tab_update');
    return this.tabWithTiles(id);
  }

  /**
   * 保存版面：名稱、畫布比例與整份格子矩形在同一交易完成。
   * 有 tileId 的格子保留身分與來源綁定（只改位置大小）；沒有 tileId 的是新格子；這頁原有但沒送來的格子刪除。
   * 不改任何來源綁定或錄影（綁定走 PATCH tiles/:tileId/source，兩者互不覆蓋）。
   */
  async saveLayout(id: string, input: { expectedVersion?: unknown; name?: unknown; canvasAspectRatio?: unknown; tiles?: unknown }) {
    const expected = versionOf(input.expectedVersion);
    const layout = parseLayout(input.tiles);
    await this.dataSource.transaction(async (m) => {
      const tab = await this.lockTab(m, id, expected);
      const existing = await m.find(VideoMonitorTile, { where: { tabId: id } });
      const mine = new Set(existing.map((t) => t.id));
      for (const t of layout) if (t.tileId && !mine.has(t.tileId)) throw new BadRequestException('版面包含不屬於這個標籤頁的格子，請重新整理');
      const keep = new Set(layout.map((t) => t.tileId).filter(Boolean) as string[]);
      const removed = existing.filter((t) => !keep.has(t.id)).map((t) => t.id);
      if (removed.length) await m.delete(VideoMonitorTile, { id: In(removed) });
      const now = Date.now();
      for (const t of layout) {
        if (t.tileId) {
          await m.update(VideoMonitorTile, { id: t.tileId }, { position: t.position, x: t.x, y: t.y, w: t.w, h: t.h, updatedAt: now });
        } else {
          await m.insert(VideoMonitorTile, { id: randomUUID(), tabId: id, position: t.position, sourceId: null, displayName: null, x: t.x, y: t.y, w: t.w, h: t.h, recordingRequested: true, enabled: true, templateVars: {}, version: 1, updatedAt: now });
        }
      }
      await m.update(VideoMonitorTab, { id }, {
        name: input.name === undefined ? tab.name : text(input.name, '標籤名稱', 60, true)!,
        canvasAspectRatio: input.canvasAspectRatio === undefined ? Number(tab.canvasAspectRatio) : parseAspect(input.canvasAspectRatio),
        tileCount: layout.length,
        version: expected + 1,
        updatedAt: now,
      });
    });
    this.changed('video_layout_save');
    return this.tabWithTiles(id);
  }

  /** 換這一格的來源（或清除）；只動這一格，不改版面、不改來源錄影 */
  async bindTileSource(tabId: string, tileId: string, input: { expectedVersion?: unknown; sourceId?: unknown }) {
    const expected = versionOf(input.expectedVersion);
    const sourceId = input.sourceId === null || input.sourceId === undefined || input.sourceId === '' ? null : String(input.sourceId);
    if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) throw new BadRequestException('影像來源不正確');
    if (!/^[0-9a-f-]{36}$/i.test(tileId)) throw new NotFoundException('找不到格子');
    await this.dataSource.transaction(async (m) => {
      await this.lockTab(m, tabId, null);
      const tile = await m.getRepository(VideoMonitorTile).createQueryBuilder('t').setLock('pessimistic_write').where('t.id = :id AND t.tab_id = :tab', { id: tileId, tab: tabId }).getOne();
      if (!tile) throw new NotFoundException('找不到格子，版面可能已被修改，請重新整理');
      if (tile.version !== expected) throw new ConflictException('這一格已被其他人修改，請重新整理');
      if (sourceId && sourceId !== tile.sourceId) {
        const source = await m.findOne(VideoSource, { where: { id: sourceId } });
        if (!source || source.deletedAt) throw new BadRequestException('來源不存在或已刪除');
        if (!source.enabled) throw new BadRequestException('來源已停用，不能綁到格子');
      }
      await m.update(VideoMonitorTile, { id: tileId }, { sourceId, version: expected + 1, updatedAt: Date.now() });
    });
    this.changed('video_tile_bind');
    return this.tabWithTiles(tabId);
  }

  /** 刪除標籤頁：只移除版面，不影響任何來源的錄影 */
  async deleteTab(id: string, expectedRaw: unknown) {
    const expected = versionOf(expectedRaw);
    await this.dataSource.transaction(async (m) => {
      await this.lockTab(m, id, expected);
      await m.update(VideoMonitorTab, { id }, { deletedAt: Date.now(), version: expected + 1, updatedAt: Date.now() });
    });
    this.changed('video_tab_delete');
    return { deleted: true };
  }

  async reorderTabs(ids: unknown) {
    if (!Array.isArray(ids) || ids.some((v) => typeof v !== 'string')) throw new BadRequestException('排序內容不正確');
    await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-tabs'))`);
      const tabs = await m.find(VideoMonitorTab, { where: { deletedAt: IsNull() } });
      if (tabs.length !== ids.length || tabs.some((t) => !ids.includes(t.id))) throw new ConflictException('標籤頁清單已變動，請重新整理後再排序');
      for (const [position, tabId] of (ids as string[]).entries()) await m.update(VideoMonitorTab, { id: tabId }, { position, version: () => 'row_version + 1', updatedAt: Date.now() } as never);
    });
    this.changed('video_tab_reorder');
    return this.listTabs();
  }

  /** 複製標籤頁：新的標籤頁與格子識別碼，版面相同、引用同一批來源，不複製來源或錄影 */
  async duplicateTab(id: string, actor: AuthUser) {
    const newId = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-tabs'))`);
      const tab = await m.findOne(VideoMonitorTab, { where: { id, deletedAt: IsNull() } });
      if (!tab) throw new NotFoundException('找不到監控標籤頁');
      const settings = await this.settings(m);
      if ((await m.count(VideoMonitorTab, { where: { deletedAt: IsNull() } })) >= settings.maxTabs) throw new BadRequestException(`監控標籤頁已達上限 ${settings.maxTabs} 個`);
      const tiles = (await m.find(VideoMonitorTile, { where: { tabId: id } })).sort((a, b) => a.position - b.position);
      const [{ max }] = await m.query(`SELECT COALESCE(max(position), -1) AS max FROM video_monitor_tabs WHERE deleted_at IS NULL`);
      return this.insertTab(m, `${tab.name}（複本）`.slice(0, 60), Number(max) + 1, actor.id, Number(tab.canvasAspectRatio), tiles.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, sourceId: t.sourceId, displayName: t.displayName })));
    });
    this.changed('video_tab_duplicate');
    return this.tabWithTiles(newId);
  }

  /** 舊的整頁格子保存（含每格錄影開關）已停用：錄影改在來源設定，版面改用 layout API */
  saveTilesDeprecated(): never {
    throw new BadRequestException({ code: 'CONTRACT_CHANGED', message: '監控格子的保存方式已更新（錄影改在來源設定），請重新整理頁面' });
  }

  /** 錄影需求以來源為準：啟用、勾選儲存錄影、未刪除；與是否放進監控格無關 */
  async recordingDemand(m: EntityManager = this.dataSource.manager) {
    const rows: Array<{ id: string; tiles: string }> = await m.query(
      `SELECT s.id, (SELECT count(*) FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL WHERE t.source_id = s.id) AS tiles
         FROM video_sources s WHERE s.deleted_at IS NULL AND s.enabled AND s.recording_enabled`,
    );
    return new Map(rows.map((r) => [r.id, { recording: true, tiles: Number(r.tiles) }]));
  }

  async revisionFor(sourceId: string, m: EntityManager = this.dataSource.manager) {
    const source = await this.findSource(m, sourceId);
    if (!source.currentRevisionId) throw new NotFoundException('來源尚未設定連線');
    return { source, revision: await m.findOneOrFail(VideoSourceRevision, { where: { id: source.currentRevisionId } }) };
  }
}
