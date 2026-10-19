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
import { mediaPathOf, TILE_MAX } from './video.config';
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
};

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
  private presentSource(source: VideoSource, rev: VideoSourceRevision | null, usage: { tiles: number; recording: number }) {
    return {
      id: source.id,
      name: source.name,
      enabled: source.enabled,
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
      // 需求（有格子要求錄影）與實際狀態分開回報
      desiredRecording: source.enabled && usage.recording > 0,
      actualStatus: source.actualStatus ?? {},
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }

  private async usage(manager: EntityManager, sourceIds: string[]) {
    if (!sourceIds.length) return new Map<string, { tiles: number; recording: number }>();
    const rows: Array<{ source_id: string; tiles: string; recording: string }> = await manager.query(
      `SELECT t.source_id, count(*) AS tiles, count(*) FILTER (WHERE t.recording_requested AND t.enabled) AS recording
         FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
        WHERE t.source_id = ANY($1::uuid[]) GROUP BY t.source_id`,
      [sourceIds],
    );
    return new Map(rows.map((r) => [r.source_id, { tiles: Number(r.tiles), recording: Number(r.recording) }]));
  }

  async listSources(includeDeleted = false) {
    const sources = await this.dataSource.manager.find(VideoSource, { where: includeDeleted ? {} : { deletedAt: IsNull() }, order: { name: 'ASC', id: 'ASC' } });
    const revisions = await this.dataSource.manager.find(VideoSourceRevision, { where: { id: In(sources.map((s) => s.currentRevisionId).filter(Boolean) as string[]) } });
    const revById = new Map(revisions.map((r) => [r.id, r]));
    const usage = await this.usage(this.dataSource.manager, sources.map((s) => s.id));
    return sources.map((s) => ({ ...this.presentSource(s, revById.get(s.currentRevisionId ?? '') ?? null, usage.get(s.id) ?? { tiles: 0, recording: 0 }), deleted: s.deletedAt !== null }));
  }

  async getSource(id: string) {
    const source = await this.findSource(this.dataSource.manager, id);
    const rev = source.currentRevisionId ? await this.dataSource.manager.findOne(VideoSourceRevision, { where: { id: source.currentRevisionId } }) : null;
    const usage = await this.usage(this.dataSource.manager, [id]);
    const tiles = await this.dataSource.manager.query(
      `SELECT tb.id AS tab_id, tb.name AS tab_name, t.position, t.display_name, t.recording_requested
         FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
        WHERE t.source_id = $1 ORDER BY tb.position, t.position`,
      [id],
    );
    return { ...this.presentSource(source, rev, usage.get(id) ?? { tiles: 0, recording: 0 }), usedBy: tiles };
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

  async createSource(input: SourceInput, actor: AuthUser, manager?: EntityManager) {
    const run = async (m: EntityManager) => {
      const settings = await this.settings(m);
      const count = await m.count(VideoSource, { where: { deletedAt: IsNull() } });
      if (count >= settings.maxSources) throw new BadRequestException(`影像來源已達上限 ${settings.maxSources} 個`);
      const name = text(input.name, '影像名稱', 120, true)!;
      const conn = await this.resolveConnection(input.connection, settings.allowedNetworks);
      const now = Date.now();
      const sourceId = randomUUID();
      await m.insert(VideoSource, { id: sourceId, name, enabled: input.enabled === false ? false : true, recordingProfile: this.profile(input.recordingProfile), actualStatus: {}, version: 1, createdBy: actor.id, createdAt: now, updatedAt: now, deletedAt: null });
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
  async updateSource(id: string, input: SourceInput, actor: AuthUser) {
    const expected = versionOf(input.expectedVersion);
    await this.dataSource.transaction(async (m) => {
      const source = await this.findSource(m, id, true);
      if (source.version !== expected) throw new ConflictException('影像來源已被其他人修改，請重新整理');
      const settings = await this.settings(m);
      const prev = source.currentRevisionId ? await m.findOne(VideoSourceRevision, { where: { id: source.currentRevisionId } }) : null;
      const patch: Partial<VideoSource> = { version: expected + 1, updatedAt: Date.now() };
      if (input.name !== undefined) patch.name = text(input.name, '影像名稱', 120, true)!;
      if (input.enabled !== undefined) patch.enabled = input.enabled === true;
      if (input.recordingProfile !== undefined) patch.recordingProfile = this.profile(input.recordingProfile);
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

  /** 移除來源：停用並解除格子綁定；不刪錄影，歷史仍可用 sourceId 查 */
  async deleteSource(id: string, expectedRaw: unknown) {
    const expected = versionOf(expectedRaw);
    await this.dataSource.transaction(async (m) => {
      const source = await this.findSource(m, id, true);
      if (source.version !== expected) throw new ConflictException('影像來源已被其他人修改，請重新整理');
      const now = Date.now();
      await m.update(VideoSource, { id }, { enabled: false, deletedAt: now, updatedAt: now, version: expected + 1 });
      if (source.currentRevisionId) await m.update(VideoSourceRevision, { id: source.currentRevisionId, validTo: IsNull() }, { validTo: now });
      await m.query(`UPDATE video_monitor_tiles SET source_id = NULL, row_version = row_version + 1, updated_at = $2 WHERE source_id = $1`, [id, now]);
    });
    this.changed('video_source_delete');
    return { deleted: true };
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

  /** 儲存全域預設：只影響之後新建的來源；要改既有格子需「套用到既有格子」 */
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
   * 批次套用預覽／執行：依全域預設與每格的樣板變數算出最終路徑。
   * 預設只填空白（尚未設定來源）的格子；overwrite=true 才換掉已設定的格子（改綁新來源，不修改共用來源）。
   * 相同連線的來源直接共用，不重複建立、不重複錄影。
   */
  async planApply(m: EntityManager, input: { scope?: unknown; tabId?: unknown; tileIds?: unknown; overwrite?: unknown }) {
    const d = await this.defaultsRow(m);
    if (!d.host) throw new BadRequestException('請先設定全域來源預設的主機');
    const scope = input.scope;
    if (scope !== 'tab' && scope !== 'tiles' && scope !== 'all') throw new BadRequestException('套用範圍只能是目前標籤、勾選格子或全部標籤');
    const qb = m.getRepository(VideoMonitorTile).createQueryBuilder('t').innerJoin(VideoMonitorTab, 'tb', 'tb.id = t.tab_id AND tb.deleted_at IS NULL')
      .addSelect(['tb.name', 'tb.position', 'tb.tileCount', 'tb.version']).where('t.position < tb.tile_count');
    if (scope === 'tab') qb.andWhere('t.tab_id = :tab', { tab: String(input.tabId ?? '') });
    if (scope === 'tiles') {
      if (!Array.isArray(input.tileIds) || !input.tileIds.length || input.tileIds.length > 500) throw new BadRequestException('請勾選要套用的格子');
      qb.andWhere('t.id IN (:...ids)', { ids: input.tileIds.map(String) });
    }
    const rows = await qb.orderBy('tb.position').addOrderBy('t.position').getRawAndEntities();
    const tabInfo = new Map(rows.raw.map((r: Record<string, unknown>) => [r.t_id as string, { name: r.tb_name as string, version: Number(r.tb_row_version) }]));
    const overwrite = input.overwrite === true;
    const boundIds = [...new Set(rows.entities.map((t) => t.sourceId).filter(Boolean) as string[])];
    const bound = boundIds.length ? await m.find(VideoSource, { where: { id: In(boundIds) } }) : [];
    const revIds = bound.map((s) => s.currentRevisionId).filter(Boolean) as string[];
    const current = revIds.length ? await m.find(VideoSourceRevision, { where: { id: In(revIds) } }) : [];
    const sourcesByRev = new Map(current.map((r) => [r.sourceId, r]));
    const items = rows.entities.map((tile) => {
      const tab = tabInfo.get(tile.id)!;
      const base = { tileId: tile.id, tabId: tile.tabId, tabName: tab.name, tabVersion: tab.version, position: tile.position, displayName: tile.displayName };
      const before = tile.sourceId && sourcesByRev.get(tile.sourceId) ? maskedSourceUrl(addressOf(sourcesByRev.get(tile.sourceId)!), Boolean(sourcesByRev.get(tile.sourceId)!.secretCiphertext)) : null;
      if (tile.sourceId && !overwrite) return { ...base, action: 'skip' as const, before, after: before, reason: '已設定來源（未勾選覆蓋）' };
      try {
        const vars: TemplateVars = { ...sanitizeTemplateVars(tile.templateVars), index: String(tile.position + 1) };
        const tail = d.pathTemplate ? renderPathTemplate(d.pathTemplate, vars) : '';
        const path = normalizePath(`${d.pathPrefix ?? ''}${tail}`);
        const address: SourceAddress = { protocol: d.protocol as SourceAddress['protocol'], host: d.host!, port: d.port, path, query: null, username: d.username };
        return { ...base, action: tile.sourceId ? ('replace' as const) : ('create' as const), before, after: maskedSourceUrl(address, Boolean(d.secretCiphertext)), address, reason: null };
      } catch (error) {
        return { ...base, action: 'error' as const, before, after: null, reason: (error as Error).message };
      }
    });
    return { defaults: d, items };
  }

  async previewApply(input: Record<string, unknown>) {
    const { defaults, items } = await this.planApply(this.dataSource.manager, input);
    const existing = await this.existingConnections(this.dataSource.manager);
    return {
      defaultsVersion: defaults.version,
      items: items.map((item) => {
        const { address, ...rest } = item as typeof item & { address?: SourceAddress };
        return { ...rest, sharedWith: address ? existing.get(this.connKey(address, defaults.secretCiphertext !== null)) ?? null : null };
      }),
    };
  }

  private connKey(a: SourceAddress, hasSecret: boolean) {
    return JSON.stringify([a.protocol, a.host, a.port, a.path, a.query, a.username, hasSecret]);
  }

  private async existingConnections(m: EntityManager) {
    const rows: Array<VideoSourceRevision & { name: string; source_id: string }> = await m.query(
      `SELECT r.*, s.name, s.id AS source_id FROM video_sources s JOIN video_source_revisions r ON r.id = s.current_revision_id WHERE s.deleted_at IS NULL`,
    );
    return new Map(rows.map((r: any) => [this.connKey({ protocol: r.protocol, host: r.host, port: r.port, path: r.path, query: r.query, username: r.username }, Boolean(r.secret_ciphertext)), { sourceId: r.source_id as string, name: r.name as string }]));
  }

  async apply(input: Record<string, unknown>, actor: AuthUser) {
    const expected = versionOf(input.defaultsVersion);
    const result = await this.dataSource.transaction(async (m) => {
      const { defaults, items } = await this.planApply(m, input);
      if (defaults.version !== expected) throw new ConflictException('全域預設在預覽後被修改，請重新預覽');
      const errors = items.filter((i) => i.action === 'error');
      if (errors.length) throw new BadRequestException(`有 ${errors.length} 格無法套用：${errors[0].reason}`);
      const settings = await this.settings(m);
      const check = await checkHostAllowed(defaults.host!, settings.allowedNetworks);
      if (!check.ok) throw new BadRequestException(check.reason);
      const existing = await this.existingConnections(m);
      const applied: Array<{ tileId: string; sourceId: string; created: boolean }> = [];
      const touchedTabs = new Set<string>();
      for (const item of items) {
        if (item.action !== 'create' && item.action !== 'replace') continue;
        const address = (item as { address?: SourceAddress }).address!;
        const key = this.connKey(address, defaults.secretCiphertext !== null);
        let sourceId = existing.get(key)?.sourceId;
        let created = false;
        if (!sourceId) {
          const now = Date.now();
          sourceId = randomUUID();
          const name = (item.displayName || `${item.tabName} 第 ${item.position + 1} 格`).slice(0, 120);
          await m.insert(VideoSource, { id: sourceId, name, enabled: true, recordingProfile: 'original', actualStatus: {}, version: 1, createdBy: actor.id, createdAt: now, updatedAt: now, deletedAt: null });
          const revId = randomUUID();
          await m.insert(VideoSourceRevision, {
            id: revId, sourceId, revisionNo: 1, ...address, secretCiphertext: defaults.secretCiphertext, vehicleCode: null, cameraId: null, location: null,
            mediaPath: mediaPathOf(revId), timestampBasis: 'center', validFrom: now, validTo: null, createdBy: actor.id, createdAt: now,
          });
          await m.update(VideoSource, { id: sourceId }, { currentRevisionId: revId });
          existing.set(key, { sourceId, name });
          created = true;
        }
        await m.query(
          `UPDATE video_monitor_tiles SET source_id = $2, recording_requested = CASE WHEN source_id IS NULL THEN $3 ELSE recording_requested END,
                  row_version = row_version + 1, updated_at = $4 WHERE id = $1`,
          [item.tileId, sourceId, defaults.recordingDefault, Date.now()],
        );
        touchedTabs.add(item.tabId);
        applied.push({ tileId: item.tileId, sourceId, created });
      }
      if (touchedTabs.size) await m.query(`UPDATE video_monitor_tabs SET row_version = row_version + 1, updated_at = $2 WHERE id = ANY($1::uuid[])`, [[...touchedTabs], Date.now()]);
      return { applied, skipped: items.filter((i) => i.action === 'skip').length };
    });
    this.changed('video_defaults_apply');
    return result;
  }

  // ── 標籤與格子 ───────────────────────────────────────
  async listTabs() {
    await this.ensureDefaultTab();
    const tabs = await this.dataSource.manager.find(VideoMonitorTab, { where: { deletedAt: IsNull() }, order: { position: 'ASC', createdAt: 'ASC' } });
    const tiles = await this.dataSource.manager.find(VideoMonitorTile, { where: { tabId: In(tabs.map((t) => t.id)) }, order: { position: 'ASC' } });
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      position: tab.position,
      tileCount: tab.tileCount,
      version: tab.version,
      tiles: tiles.filter((t) => t.tabId === tab.id && t.position < tab.tileCount).map((t) => this.presentTile(t)),
    }));
  }

  private presentTile(t: VideoMonitorTile) {
    return { id: t.id, position: t.position, sourceId: t.sourceId, displayName: t.displayName, recordingRequested: t.recordingRequested, enabled: t.enabled, templateVars: t.templateVars ?? {}, version: t.version };
  }

  /** 第一次進入時建立「監控總覽」4 格（只有空白設定，不植入假攝影機） */
  async ensureDefaultTab() {
    const count = await this.dataSource.manager.count(VideoMonitorTab, { where: { deletedAt: IsNull() } });
    if (count > 0) return;
    await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-default-tab'))`);
      if ((await m.count(VideoMonitorTab, { where: { deletedAt: IsNull() } })) > 0) return;
      await this.insertTab(m, '監控總覽', 4, 0, null);
    });
  }

  private async insertTab(m: EntityManager, name: string, tileCount: number, position: number, actor: string | null, tiles?: VideoMonitorTile[]) {
    const now = Date.now();
    const id = randomUUID();
    const defaults = await this.defaultsRow(m);
    await m.insert(VideoMonitorTab, { id, name, position, tileCount, version: 1, createdBy: actor, createdAt: now, updatedAt: now, deletedAt: null });
    const rows = Array.from({ length: TILE_MAX }, (_, i) => i).filter((i) => i < tileCount).map((i) => {
      const from = tiles?.find((t) => t.position === i);
      return { id: randomUUID(), tabId: id, position: i, sourceId: from?.sourceId ?? null, displayName: from?.displayName ?? null, recordingRequested: from ? from.recordingRequested : defaults.recordingDefault, enabled: from?.enabled ?? true, templateVars: from?.templateVars ?? {}, version: 1, updatedAt: now };
    });
    if (rows.length) await m.insert(VideoMonitorTile, rows);
    return id;
  }

  private tileCount(raw: unknown) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > TILE_MAX) throw new BadRequestException('每頁格數必須是 1–12');
    return n;
  }

  async createTab(input: { name?: unknown; tileCount?: unknown }, actor: AuthUser) {
    const name = text(input.name, '標籤名稱', 60, true)!;
    const tileCount = this.tileCount(input.tileCount ?? 4);
    const id = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-tabs'))`);
      const settings = await this.settings(m);
      const count = await m.count(VideoMonitorTab, { where: { deletedAt: IsNull() } });
      if (count >= settings.maxTabs) throw new BadRequestException(`監控標籤已達上限 ${settings.maxTabs} 個`);
      const [{ max }] = await m.query(`SELECT COALESCE(max(position), -1) AS max FROM video_monitor_tabs WHERE deleted_at IS NULL`);
      return this.insertTab(m, name, tileCount, Number(max) + 1, actor.id);
    });
    this.changed('video_tab_create');
    return (await this.listTabs()).find((t) => t.id === id);
  }

  private async lockTab(m: EntityManager, id: string, expected: number) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('找不到監控標籤');
    const tab = await m.getRepository(VideoMonitorTab).createQueryBuilder('t').setLock('pessimistic_write').where('t.id = :id', { id }).getOne();
    if (!tab || tab.deletedAt) throw new NotFoundException('找不到監控標籤，可能已被刪除');
    if (tab.version !== expected) throw new ConflictException('監控標籤已被其他人修改，請重新整理');
    return tab;
  }

  /** 減少格數前的影響：會移除哪些格子、哪些來源會因此停止新的錄影 */
  async shrinkImpact(m: EntityManager, tab: VideoMonitorTab, newCount: number) {
    const removed = await m.find(VideoMonitorTile, { where: { tabId: tab.id }, order: { position: 'ASC' } });
    const gone = removed.filter((t) => t.position >= newCount && t.sourceId);
    const stopping: Array<{ sourceId: string; name: string }> = [];
    for (const tile of gone.filter((t) => t.recordingRequested && t.enabled)) {
      const [{ others }] = await m.query(
        `SELECT count(*)::int AS others FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
          WHERE t.source_id = $1 AND t.recording_requested AND t.enabled AND t.position < tb.tile_count AND NOT (t.tab_id = $2 AND t.position >= $3)`,
        [tile.sourceId, tab.id, newCount],
      );
      if (Number(others) === 0 && !stopping.some((s) => s.sourceId === tile.sourceId)) {
        const s = await m.findOne(VideoSource, { where: { id: tile.sourceId! } });
        stopping.push({ sourceId: tile.sourceId!, name: s?.name ?? '' });
      }
    }
    return { removedTiles: gone.map((t) => ({ tileId: t.id, position: t.position, displayName: t.displayName, sourceId: t.sourceId })), stoppingRecordings: stopping };
  }

  async previewTileCount(id: string, raw: unknown) {
    const count = this.tileCount(raw);
    const tab = await this.dataSource.manager.findOne(VideoMonitorTab, { where: { id, deletedAt: IsNull() } });
    if (!tab) throw new NotFoundException('找不到監控標籤');
    return count >= tab.tileCount ? { removedTiles: [], stoppingRecordings: [] } : this.shrinkImpact(this.dataSource.manager, tab, count);
  }

  async updateTab(id: string, input: { name?: unknown; tileCount?: unknown; expectedVersion?: unknown; confirm?: unknown }) {
    const expected = versionOf(input.expectedVersion);
    await this.dataSource.transaction(async (m) => {
      const tab = await this.lockTab(m, id, expected);
      const patch: Partial<VideoMonitorTab> = { version: expected + 1, updatedAt: Date.now() };
      if (input.name !== undefined) patch.name = text(input.name, '標籤名稱', 60, true)!;
      if (input.tileCount !== undefined) {
        const count = this.tileCount(input.tileCount);
        if (count < tab.tileCount) {
          const impact = await this.shrinkImpact(m, tab, count);
          if ((impact.removedTiles.length || impact.stoppingRecordings.length) && input.confirm !== true) {
            throw new ConflictException({ code: 'CONFIRM_REQUIRED', message: '減少格數會移除已設定的格子，請確認', impact });
          }
          // 移除格子只移除這頁的設定，不刪來源、不刪錄影
          await m.query(`DELETE FROM video_monitor_tiles WHERE tab_id = $1 AND position >= $2`, [id, count]);
        } else if (count > tab.tileCount) {
          const defaults = await this.defaultsRow(m);
          const existing = new Set((await m.find(VideoMonitorTile, { where: { tabId: id } })).map((t) => t.position));
          const now = Date.now();
          const rows = Array.from({ length: count }, (_, i) => i).filter((i) => !existing.has(i)).map((i) => ({ id: randomUUID(), tabId: id, position: i, sourceId: null, displayName: null, recordingRequested: defaults.recordingDefault, enabled: true, templateVars: {}, version: 1, updatedAt: now }));
          if (rows.length) await m.insert(VideoMonitorTile, rows);
        }
        patch.tileCount = count;
      }
      await m.update(VideoMonitorTab, { id }, patch as never);
    });
    this.changed('video_tab_update');
    return (await this.listTabs()).find((t) => t.id === id);
  }

  /** 刪除標籤：只移除設定；若是某來源最後的錄影需求，該來源完成目前片段後停止新錄影，歷史保留至到期 */
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
      if (tabs.length !== ids.length || tabs.some((t) => !ids.includes(t.id))) throw new ConflictException('標籤清單已變動，請重新整理後再排序');
      for (const [position, tabId] of (ids as string[]).entries()) await m.update(VideoMonitorTab, { id: tabId }, { position, version: () => 'row_version + 1', updatedAt: Date.now() } as never);
    });
    this.changed('video_tab_reorder');
    return this.listTabs();
  }

  /** 複製標籤：格子共用原來源，不複製錄影 */
  async duplicateTab(id: string, actor: AuthUser) {
    const newId = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('video-tabs'))`);
      const tab = await m.findOne(VideoMonitorTab, { where: { id, deletedAt: IsNull() } });
      if (!tab) throw new NotFoundException('找不到監控標籤');
      const settings = await this.settings(m);
      if ((await m.count(VideoMonitorTab, { where: { deletedAt: IsNull() } })) >= settings.maxTabs) throw new BadRequestException(`監控標籤已達上限 ${settings.maxTabs} 個`);
      const tiles = await m.find(VideoMonitorTile, { where: { tabId: id } });
      const [{ max }] = await m.query(`SELECT COALESCE(max(position), -1) AS max FROM video_monitor_tabs WHERE deleted_at IS NULL`);
      return this.insertTab(m, `${tab.name}（複本）`.slice(0, 60), tab.tileCount, Number(max) + 1, actor.id, tiles);
    });
    this.changed('video_tab_duplicate');
    return (await this.listTabs()).find((t) => t.id === newId);
  }

  /** 原子保存一頁的格子（來源引用、名稱、錄影需求、樣板變數） */
  async saveTiles(id: string, input: { expectedVersion?: unknown; tiles?: unknown }) {
    const expected = versionOf(input.expectedVersion);
    if (!Array.isArray(input.tiles) || input.tiles.length > TILE_MAX) throw new BadRequestException('格子設定不正確（最多 12 格）');
    await this.dataSource.transaction(async (m) => {
      const tab = await this.lockTab(m, id, expected);
      const seen = new Set<number>();
      const sourceIds = new Set<string>();
      const parsed = (input.tiles as Array<Record<string, unknown>>).map((raw) => {
        const position = Number(raw.position);
        if (!Number.isInteger(position) || position < 0 || position >= tab.tileCount) throw new BadRequestException(`格子位置必須在 1–${tab.tileCount}`);
        if (seen.has(position)) throw new BadRequestException('格子位置重複');
        seen.add(position);
        const sourceId = raw.sourceId === null || raw.sourceId === undefined || raw.sourceId === '' ? null : String(raw.sourceId);
        if (sourceId) sourceIds.add(sourceId);
        return {
          position,
          sourceId,
          displayName: text(raw.displayName, '影像名稱', 120),
          recordingRequested: raw.recordingRequested !== false,
          enabled: raw.enabled !== false,
          templateVars: sanitizeTemplateVars(raw.templateVars),
        };
      });
      if (sourceIds.size) {
        const found = await m.count(VideoSource, { where: { id: In([...sourceIds]), deletedAt: IsNull() } });
        if (found !== sourceIds.size) throw new BadRequestException('有格子指向不存在或已移除的來源，請重新選擇');
      }
      const now = Date.now();
      for (const tile of parsed) {
        await m.query(
          `INSERT INTO video_monitor_tiles (id, tab_id, position, source_id, display_name, recording_requested, enabled, template_vars, row_version, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
           ON CONFLICT ON CONSTRAINT "UQ_VIDEO_TILE_POSITION" DO UPDATE SET source_id = EXCLUDED.source_id, display_name = EXCLUDED.display_name,
             recording_requested = EXCLUDED.recording_requested, enabled = EXCLUDED.enabled, template_vars = EXCLUDED.template_vars,
             row_version = video_monitor_tiles.row_version + 1, updated_at = EXCLUDED.updated_at`,
          [randomUUID(), id, tile.position, tile.sourceId, tile.displayName, tile.recordingRequested, tile.enabled, JSON.stringify(tile.templateVars), now],
        );
      }
      await m.update(VideoMonitorTab, { id }, { version: expected + 1, updatedAt: now });
    });
    this.changed('video_tiles_save');
    return (await this.listTabs()).find((t) => t.id === id);
  }

  /** 錄影需求：至少一個（未刪除標籤、格數內、啟用的）格子要求錄影 */
  async recordingDemand(m: EntityManager = this.dataSource.manager) {
    const rows: Array<{ source_id: string; want: boolean; viewers: string }> = await m.query(
      `SELECT t.source_id, bool_or(t.recording_requested AND t.enabled) AS want, count(*) AS viewers
         FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
        WHERE t.source_id IS NOT NULL AND t.position < tb.tile_count GROUP BY t.source_id`,
    );
    return new Map(rows.map((r) => [r.source_id, { recording: Boolean(r.want), tiles: Number(r.viewers) }]));
  }

  async revisionFor(sourceId: string, m: EntityManager = this.dataSource.manager) {
    const source = await this.findSource(m, sourceId);
    if (!source.currentRevisionId) throw new NotFoundException('來源尚未設定連線');
    return { source, revision: await m.findOneOrFail(VideoSourceRevision, { where: { id: source.currentRevisionId } }) };
  }
}
