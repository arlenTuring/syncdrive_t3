import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { statfsSync } from 'fs';
import { DataSource } from 'typeorm';
import { TelemetryWriteQueue } from '../mqtt/telemetry-write.queue';
import { VehicleHistoryRecorder } from '../vehicle-history/vehicle-history.recorder';
import { DegradedReplayRecorder } from '../degraded-replay/degraded-replay.recorder';

type CleanupCategory = 'vehicle_history' | 'degraded_replay' | 'telemetry' | 'bulk_logs' | 'security_events';
type CleanupCriteria = { category: CleanupCategory; from?: number; to: number; vehicleCode?: string; sourceRun?: string; snapshotAt: number; purpose?: 'manual' | 'policy'; proposedPolicy?: Record<string, unknown> };

const PLAN_TTL_MS = 10 * 60_000;
const BATCH_SIZE = 2_000;
const CATEGORY_INFO: Record<CleanupCategory, { label: string; impact: string; tables: string[]; vehicleFilter: boolean; trustedTime: string }> = {
  vehicle_history: { label: '一般運行歷史', impact: '清除後該期間無法完整回放；系統會留下「已依保留政策清除」缺段。', tables: ['vehicle_history_frames', 'vehicle_history_segments', 'vehicle_history_gaps', 'vehicle_history_stream_keys'], vehicleFilter: true, trustedTime: 'received_at（後端接收時間）' },
  degraded_replay: { label: '歷史降級回放', impact: '只處理已結束的回放 Session；進行中 Session 與仍被引用的地圖快照會保留。', tables: ['degraded_replay_frames', 'degraded_replay_sessions', 'degraded_replay_maps'], vehicleFilter: true, trustedTime: 'received_at／ended_real（後端時間）' },
  telemetry: { label: '原始遙測歷史', impact: '清除後無法查詢該期間原始遙測；最新車輛狀態快照不受影響。', tables: ['telemetry_logs'], vehicleFilter: true, trustedTime: 'received_at（後端接收時間；舊資料缺值時排除）' },
  bulk_logs: { label: '其他大量紀錄', impact: '只清理已完成的指令與已釋放的路口紀錄；事件紀錄、操作及安全稽核不在範圍內。', tables: ['command_logs', 'junction_interlock_logs'], vehicleFilter: true, trustedTime: 'sent_at／requested_at（後端時間）' },
  // 事件紀錄獨立設定（2026-10-20 起不再跟指令一起清）；預設不啟用自動清理
  security_events: { label: '事件紀錄', impact: '清除後事件資訊清單、歷史事件與事件報表查不到該期間的事件（含人工確認狀態）；操作、權限與登入稽核不受影響。', tables: ['security_event_logs'], vehicleFilter: true, trustedTime: 'received_at（後端接收時間；缺值的舊資料排除）' },
};

@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionService.name);
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<string>();

  constructor(
    private readonly db: DataSource,
    private readonly telemetryQueue: TelemetryWriteQueue,
    private readonly historyRecorder: VehicleHistoryRecorder,
    private readonly replayRecorder: DegradedReplayRecorder,
  ) {}

  async onModuleInit() {
    await this.db.query(`UPDATE data_cleanup_jobs SET status='partial', finished_at=$1, error=COALESCE(error,'後端重啟，工作在批次邊界停止；可重新預覽後執行') WHERE status='running'`, [Date.now()]).catch(() => undefined);
    const queued = await this.db.query(`SELECT id FROM data_cleanup_jobs WHERE status='queued' ORDER BY requested_at`).catch(() => []);
    queued.forEach((job: { id: string }) => setImmediate(() => void this.processJob(job.id)));
    this.timer = setInterval(() => void this.runDuePolicies(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  categories() { return Object.entries(CATEGORY_INFO).map(([key, value]) => ({ key, ...value })); }

  /** TypeORM's PostgreSQL driver wraps UPDATE ... RETURNING rows as [rows, affected]. */
  private mutationRows<T = any>(result: any): T[] {
    return Array.isArray(result?.[0]) ? result[0] : result;
  }

  private async legacyTelemetryPolicy() {
    try {
      const rows = await this.db.query(`SELECT job_id, schedule_interval::text, config, next_start, last_run_status, last_successful_finish FROM timescaledb_information.jobs WHERE proc_name='policy_retention' AND hypertable_name='telemetry_logs' LIMIT 1`);
      return rows[0] ?? null;
    } catch { return null; }
  }

  async policies() {
    const rows = await this.db.query(`SELECT * FROM data_retention_policies ORDER BY category`);
    const legacy = await this.legacyTelemetryPolicy();
    return rows.map((row: any) => row.category === 'telemetry' && legacy ? {
      ...row, enabled: true, source: 'timescaledb_existing', readOnlyReason: '既有 TimescaleDB 政策仍由資料庫排程；本功能不會重複排程或自動縮短期限。', external: legacy,
    } : { ...row, source: 'syncdrive', external: null });
  }

  async overview() {
    const collectedAt = Date.now();
    const [dbSize] = await this.db.query(`SELECT pg_database_size(current_database())::bigint AS bytes, current_database() AS name`);
    const relationRows = await this.db.query(`
      SELECT c.relname AS table_name, GREATEST(c.reltuples,0)::bigint AS estimated_rows,
             pg_total_relation_size(c.oid)::bigint AS total_bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = ANY($1::text[])`, [Object.values(CATEGORY_INFO).flatMap((item) => item.tables)]);
    const byTable = new Map(relationRows.map((row: any) => [row.table_name, row]));
    const ranges = await Promise.all((Object.keys(CATEGORY_INFO) as CleanupCategory[]).map(async (category) => {
      const range = await this.timeRange(category).catch(() => ({ oldest: null, newest: null }));
      const tables = CATEGORY_INFO[category].tables.map((name) => byTable.get(name)).filter(Boolean) as any[];
      return { category, ...CATEGORY_INFO[category], estimatedRows: tables.reduce((sum, row) => sum + Number(row.estimated_rows), 0), totalBytes: tables.reduce((sum, row) => sum + Number(row.total_bytes), 0), ...range };
    }));
    const backendPath = process.env.DATA_STORAGE_PATH || process.cwd();
    let backendFilesystem: any = { available: false, scope: 'backend_filesystem', path: backendPath, note: '後端容器／主機檔案系統容量無法取得；不是瀏覽器磁碟。' };
    try { const stat = statfsSync(backendPath); backendFilesystem = { available: true, scope: 'backend_filesystem', path: backendPath, totalBytes: Number(stat.blocks) * Number(stat.bsize), freeBytes: Number(stat.bavail) * Number(stat.bsize), note: '此數值是後端容器／主機檔案系統；除非明確共用掛載點，不代表 PostgreSQL 資料卷。' }; } catch {}
    return {
      collectedAt,
      database: { name: dbSize.name, totalBytes: Number(dbSize.bytes), includes: '資料表、索引及 TOAST 大型欄位' },
      backendFilesystem,
      databaseVolume: { available: false, scope: 'postgres_volume', note: 'PostgreSQL 未提供資料卷可用空間；不以後端或瀏覽器磁碟冒充。' },
      categories: ranges,
      policies: await this.policies(),
      countSemantics: '概況筆數來自 PostgreSQL 統計估算；預覽才執行條件內精確計數。',
    };
  }

  private async timeRange(category: CleanupCategory) {
    const sql: Record<CleanupCategory, string> = {
      vehicle_history: `SELECT min(received_at)::bigint oldest, max(received_at)::bigint newest FROM vehicle_history_frames`,
      degraded_replay: `SELECT min(received_at)::bigint oldest, max(received_at)::bigint newest FROM degraded_replay_frames`,
      telemetry: `SELECT min(received_at)::bigint oldest, max(received_at)::bigint newest FROM telemetry_logs WHERE received_at IS NOT NULL`,
      bulk_logs: `SELECT min(t)::bigint oldest, max(t)::bigint newest FROM (SELECT sent_at t FROM command_logs UNION ALL SELECT requested_at FROM junction_interlock_logs) x`,
      security_events: `SELECT min(received_at)::bigint oldest, max(received_at)::bigint newest FROM security_event_logs WHERE received_at IS NOT NULL`,
    };
    const [row] = await this.db.query(sql[category]);
    return { oldest: row?.oldest == null ? null : Number(row.oldest), newest: row?.newest == null ? null : Number(row.newest) };
  }

  private normalize(input: any, purpose: 'manual' | 'policy' = 'manual'): CleanupCriteria {
    const category = String(input?.category ?? '') as CleanupCategory;
    if (!CATEGORY_INFO[category]) throw new BadRequestException('不支援的資料類別');
    const snapshotAt = Date.now();
    const to = Number(input?.to);
    const from = input?.from == null || input.from === '' ? undefined : Number(input.from);
    if (!Number.isFinite(to) || to <= 0 || to > snapshotAt) throw new BadRequestException('清理結束時間無效或晚於目前時間');
    if (from != null && (!Number.isFinite(from) || from < 0 || from >= to)) throw new BadRequestException('清理開始時間必須早於結束時間');
    const vehicleCode = input?.vehicleCode == null ? undefined : String(input.vehicleCode).trim();
    if (vehicleCode && (!CATEGORY_INFO[category].vehicleFilter || !/^[A-Za-z0-9._-]{1,64}$/.test(vehicleCode))) throw new BadRequestException('載具篩選無效');
    const sourceRun = input?.sourceRun == null ? undefined : String(input.sourceRun).trim();
    if (sourceRun) throw new BadRequestException('目前資料沒有可靠且完整的測試 run 來源標記，不能據此清理');
    return { category, from, to, vehicleCode, snapshotAt, purpose, proposedPolicy: input?.proposedPolicy };
  }

  private async protectionFingerprint() {
    const [row] = await this.db.query(`SELECT
      (SELECT COALESCE(jsonb_agg(execution_id ORDER BY execution_id),'[]') FROM degraded_replay_sessions WHERE status='recording') active_replays,
      (SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') FROM vehicle_history_segments WHERE status='recording') active_recorders,
      (SELECT COALESCE(jsonb_agg(order_id ORDER BY order_id),'[]') FROM operation_orders WHERE status IN ('PENDING','PROCESSING')) active_orders`);
    return createHash('sha256').update(JSON.stringify(row)).digest('hex');
  }

  async preview(input: unknown, operatorId: string) {
    const criteria = this.normalize(input);
    const counts = await this.exactCounts(criteria);
    const preview = {
      category: criteria.category, categoryLabel: CATEGORY_INFO[criteria.category].label, impact: CATEGORY_INFO[criteria.category].impact,
      environment: { database: this.db.options.database, host: (this.db.options as { host?: string }).host, type: this.db.options.type },
      range: { from: criteria.from ?? null, to: criteria.to }, vehicleCode: criteria.vehicleCode ?? null,
      ...counts,
      warnings: ['沒有可靠來源標記時，範圍可能同時包含真實與模擬資料。', '一般 DELETE 使空間可重用，但不保證立刻歸還作業系統；結果會分開顯示資料庫與磁碟變化。'],
    };
    const fingerprint = await this.protectionFingerprint();
    const now = Date.now();
    const rows = await this.db.query(`INSERT INTO data_cleanup_plans(operator_id,category,criteria,preview,protection_fingerprint,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [operatorId, criteria.category, criteria, preview, fingerprint, now, now + PLAN_TTL_MS]);
    return { planId: rows[0].id, expiresAt: now + PLAN_TTL_MS, criteria, preview };
  }

  private clause(criteria: CleanupCriteria, timeColumn: string, startIndex = 1) {
    const values: unknown[] = [criteria.to];
    let sql = `${timeColumn} <= $${startIndex}`;
    if (criteria.from != null) { values.push(criteria.from); sql += ` AND ${timeColumn} >= $${startIndex + values.length - 1}`; }
    if (criteria.vehicleCode) { values.push(criteria.vehicleCode); sql += ` AND vehicle_code = $${startIndex + values.length - 1}`; }
    return { sql, values };
  }

  private async exactCounts(criteria: CleanupCriteria) {
    if (criteria.category === 'vehicle_history') {
      const c = this.clause(criteria, 'received_at');
      const [row] = await this.db.query(`SELECT count(*)::bigint records, count(DISTINCT order_id)::bigint affected_orders, count(DISTINCT clock_run)::bigint affected_runs FROM vehicle_history_frames WHERE ${c.sql}`, c.values);
      return { records: Number(row.records), relatedRecords: 0, affectedReplays: Number(row.affected_runs), affectedOrders: Number(row.affected_orders), protected: ['錄製中區段本身、最新狀態、主檔與未完成訂單'], estimatedBytes: null };
    }
    if (criteria.category === 'degraded_replay') {
      const values: unknown[] = [criteria.to]; let filter = `s.status IN ('complete','interrupted') AND s.ended_real <= $1`;
      if (criteria.from != null) { values.push(criteria.from); filter += ` AND s.ended_real >= $2`; }
      const [row] = await this.db.query(`SELECT count(DISTINCT s.execution_id)::bigint sessions, count(f.seq)::bigint records FROM degraded_replay_sessions s LEFT JOIN degraded_replay_frames f ON f.execution_id=s.execution_id${criteria.vehicleCode ? ` AND f.vehicle_code=$${values.push(criteria.vehicleCode)}` : ''} WHERE ${filter}`, values);
      return { records: Number(row.records), relatedRecords: Number(row.sessions), affectedReplays: Number(row.sessions), affectedOrders: 0, protected: ['recording Session、仍被引用的地圖快照'], estimatedBytes: null };
    }
    if (criteria.category === 'telemetry') {
      const c = this.clause(criteria, 'received_at'); const [row] = await this.db.query(`SELECT count(*)::bigint records FROM telemetry_logs WHERE received_at IS NOT NULL AND ${c.sql}`, c.values);
      const [legacy] = await this.db.query(`SELECT count(*)::bigint records FROM telemetry_logs WHERE received_at IS NULL`);
      return { records: Number(row.records), relatedRecords: 0, affectedReplays: 0, affectedOrders: 0, protected: [`${legacy.records} 筆缺少可信接收時間的舊資料排除`], estimatedBytes: null };
    }
    if (criteria.category === 'security_events') {
      const s = this.clause(criteria, 'received_at');
      const [events] = await this.db.query(`SELECT count(*)::bigint records FROM security_event_logs WHERE received_at IS NOT NULL AND ${s.sql}`, s.values);
      const [legacy] = await this.db.query(`SELECT count(*)::bigint records FROM security_event_logs WHERE received_at IS NULL`);
      return { records: Number(events.records), relatedRecords: 0, affectedReplays: 0, affectedOrders: 0, protected: ['操作、權限與登入稽核', `${legacy.records} 筆缺少接收時間的舊事件排除`], estimatedBytes: null };
    }
    const c = this.clause(criteria, 'sent_at');
    const [commands] = await this.db.query(`SELECT count(*)::bigint records FROM command_logs WHERE is_acked=true AND ${c.sql}`, c.values);
    const j = this.clause(criteria, 'requested_at'); const [junctions] = await this.db.query(`SELECT count(*)::bigint records FROM junction_interlock_logs WHERE status IN ('RELEASED','DENIED') AND ${j.sql}`, j.values);
    return { records: Number(commands.records) + Number(junctions.records), relatedRecords: 0, affectedReplays: 0, affectedOrders: 0, protected: ['未完成指令、持有中路權、事件紀錄、操作稽核、清理稽核'], estimatedBytes: null };
  }

  async execute(planId: string, operatorId: string) {
    const rows = await this.db.query(`SELECT * FROM data_cleanup_plans WHERE id=$1`, [planId]); const plan = rows[0];
    if (!plan) throw new NotFoundException('清理預覽不存在');
    if (plan.operator_id !== operatorId) throw new ForbiddenException('只能執行自己建立的清理預覽');
    if (plan.consumed_at) { const existing = await this.db.query(`SELECT * FROM data_cleanup_jobs WHERE plan_id=$1`, [planId]); return existing[0]; }
    if (Number(plan.expires_at) < Date.now()) throw new ConflictException('清理預覽已過期，請重新預覽');
    if (plan.protection_fingerprint !== await this.protectionFingerprint()) throw new ConflictException('重要保護狀態已改變，請重新預覽');
    const now = Date.now();
    const inserted = await this.db.transaction(async (manager) => {
      const consumed = this.mutationRows(await manager.query(`UPDATE data_cleanup_plans SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL RETURNING *`, [planId, now]));
      if (!consumed.length) { const found = await manager.query(`SELECT * FROM data_cleanup_jobs WHERE plan_id=$1`, [planId]); return found[0]; }
      const jobs = await manager.query(`INSERT INTO data_cleanup_jobs(plan_id,category,trigger,status,criteria,requested_by,requested_at) VALUES($1,$2,'manual','queued',$3,$4,$5) RETURNING *`, [planId, plan.category, plan.criteria, operatorId, now]);
      return jobs[0];
    });
    setImmediate(() => void this.processJob(inserted.id));
    return inserted;
  }

  async jobs(limit = 50) {
    return this.db.query(`SELECT j.*,
      COALESCE((p.preview->>'records')::bigint, (j.criteria->>'expectedRecords')::bigint, 0)
        + COALESCE((p.preview->>'relatedRecords')::bigint, 0) AS expected_count
      FROM data_cleanup_jobs j
      LEFT JOIN data_cleanup_plans p ON p.id=j.plan_id
      ORDER BY j.requested_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 200)]);
  }
  async stop(jobId: string) { const rows = this.mutationRows(await this.db.query(`UPDATE data_cleanup_jobs SET stop_requested=true WHERE id=$1 AND status IN ('queued','running') RETURNING *`, [jobId])); if (!rows.length) throw new ConflictException('工作已結束或不存在'); return rows[0]; }

  private async processJob(jobId: string) {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    const lockKey = 1732050807;
    const lockConnection = this.db.createQueryRunner();
    let locked = false;
    let beforeDb = 0; let beforeDisk: number | null = null;
    try {
      await lockConnection.connect();
      const [lock] = await lockConnection.query(`SELECT pg_try_advisory_lock($1) locked`, [lockKey]); locked = Boolean(lock.locked);
      if (!locked) {
        await this.db.query(`UPDATE data_cleanup_jobs SET status='queued', error='另一個清理工作正在執行，已退避等待' WHERE id=$1`, [jobId]);
        const retry = setTimeout(() => void this.processJob(jobId), 60_000); retry.unref();
        return;
      }
      const rows = this.mutationRows(await this.db.query(`UPDATE data_cleanup_jobs SET status='running', started_at=$2, error=NULL WHERE id=$1 AND status='queued' RETURNING *`, [jobId, Date.now()]));
      if (!rows.length) return;
      const criteria = rows[0].criteria as CleanupCriteria;
      [beforeDb] = (await this.db.query(`SELECT pg_database_size(current_database())::bigint bytes`)).map((r: any) => Number(r.bytes));
      beforeDisk = this.diskFree();
      await Promise.all([this.telemetryQueue.flushForCleanup(), this.historyRecorder.flush(), this.replayRecorder.flush()]);
      let deleted = 0;
      while (true) {
        const [state] = await this.db.query(`SELECT stop_requested FROM data_cleanup_jobs WHERE id=$1`, [jobId]);
        if (state?.stop_requested) { await this.finish(jobId, 'stopped', deleted, beforeDb, beforeDisk); return; }
        const count = await this.deleteBatch(criteria);
        deleted += count;
        await this.db.query(`UPDATE data_cleanup_jobs SET deleted_count=$2 WHERE id=$1`, [jobId, deleted]);
        if (count < BATCH_SIZE) break;
      }
      if (criteria.category === 'vehicle_history') await this.finalizeHistory(criteria);
      if (criteria.category === 'degraded_replay') await this.db.query(`DELETE FROM degraded_replay_maps m WHERE NOT EXISTS (SELECT 1 FROM degraded_replay_sessions s WHERE s.map_hash=m.map_hash)`);
      await this.finish(jobId, 'completed', deleted, beforeDb, beforeDisk);
    } catch (error) {
      const failedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      await this.db.query(`UPDATE data_cleanup_jobs SET status=CASE WHEN deleted_count::bigint>0 THEN 'partial' ELSE 'failed' END, finished_at=$2, error=$3 WHERE id=$1`, [jobId, failedAt, message]).catch(() => undefined);
      await this.db.query(`UPDATE data_retention_policies p SET last_failure_at=$2,last_error=$3,next_run_at=CASE WHEN enabled THEN $2 + GREATEST(interval_minutes,60) * 60000::bigint ELSE NULL END FROM data_cleanup_jobs j WHERE j.id=$1 AND j.trigger='policy' AND p.category=j.category`, [jobId, failedAt, message]).catch(() => undefined);
      this.logger.error(`Cleanup job ${jobId} failed`, error);
    } finally {
      if (locked) await lockConnection.query(`SELECT pg_advisory_unlock($1)`, [lockKey]).catch(() => undefined);
      await lockConnection.release().catch(() => undefined);
      this.running.delete(jobId);
    }
  }

  private diskFree() { try { const s = statfsSync(process.env.DATA_STORAGE_PATH || process.cwd()); return Number(s.bavail) * Number(s.bsize); } catch { return null; } }
  private async finish(jobId: string, status: 'completed' | 'stopped', deleted: number, beforeDb: number, beforeDisk: number | null) {
    const [after] = await this.db.query(`SELECT pg_database_size(current_database())::bigint bytes`); const afterDisk = this.diskFree();
    const result = { databaseBytesBefore: beforeDb, databaseBytesAfter: Number(after.bytes), diskFreeBytesBefore: beforeDisk, diskFreeBytesAfter: afterDisk, note: '批次 DELETE 的空間通常先供 PostgreSQL 重用，不保證立即縮檔或歸還作業系統；未執行 VACUUM FULL。' };
    await this.db.query(`UPDATE data_cleanup_jobs SET status=$2, deleted_count=$3, result=$4, finished_at=$5 WHERE id=$1`, [jobId, status, deleted, result, Date.now()]);
    await this.db.query(`UPDATE data_retention_policies p SET last_success_at=CASE WHEN $2='completed' THEN $3 ELSE last_success_at END, next_run_at=CASE WHEN enabled THEN $3 + interval_minutes * 60000::bigint ELSE NULL END, last_error=NULL FROM data_cleanup_jobs j WHERE j.id=$1 AND j.trigger='policy' AND p.category=j.category`, [jobId, status, Date.now()]);
  }

  private async deleteBatch(c: CleanupCriteria): Promise<number> {
    if (c.category === 'vehicle_history') return this.deleteCtid('vehicle_history_frames', 'received_at', c, 'TRUE');
    if (c.category === 'telemetry') return this.deleteCtid('telemetry_logs', 'received_at', c, 'received_at IS NOT NULL');
    if (c.category === 'degraded_replay') {
      const values: unknown[] = [c.to]; let range = `s.ended_real <= $1 AND s.status IN ('complete','interrupted')`;
      if (c.from != null) { values.push(c.from); range += ` AND s.ended_real >= $2`; }
      if (c.vehicleCode) { values.push(c.vehicleCode); range += ` AND EXISTS (SELECT 1 FROM degraded_replay_frames vf WHERE vf.execution_id=s.execution_id AND vf.vehicle_code=$${values.length})`; }
      const rows = await this.db.query(`WITH targets AS (SELECT s.execution_id FROM degraded_replay_sessions s WHERE ${range} LIMIT ${BATCH_SIZE}), df AS (DELETE FROM degraded_replay_frames f USING targets t WHERE f.execution_id=t.execution_id RETURNING 1), ds AS (DELETE FROM degraded_replay_sessions s USING targets t WHERE s.execution_id=t.execution_id RETURNING 1) SELECT (SELECT count(*) FROM df)+(SELECT count(*) FROM ds) count`, values);
      return Number(rows[0]?.count ?? 0);
    }
    if (c.category === 'security_events') return this.deleteCtid('security_event_logs', 'received_at', c, 'received_at IS NOT NULL');
    const a = await this.deleteCtid('command_logs', 'sent_at', c, 'is_acked=true');
    const b = await this.deleteCtid('junction_interlock_logs', 'requested_at', c, `status IN ('RELEASED','DENIED')`);
    return a + b;
  }

  private async deleteCtid(table: string, time: string, c: CleanupCriteria, extra: string) {
    const clause = this.clause(c, time); const rows = await this.db.query(`WITH targets AS (SELECT ctid FROM ${table} WHERE ${extra} AND ${clause.sql} LIMIT ${BATCH_SIZE}), deleted AS (DELETE FROM ${table} t USING targets x WHERE t.ctid=x.ctid RETURNING 1) SELECT count(*)::int count FROM deleted`, clause.values); return Number(rows[0]?.count ?? 0);
  }

  private async finalizeHistory(c: CleanupCriteria) {
    await this.db.query(`INSERT INTO vehicle_history_gaps(segment_id,vehicle_code,from_real,to_real,reason,count,detail) VALUES(NULL,$1,$2,$3,'retention_cleanup',0,'資料已依手動清理或保留政策清除')`, [c.vehicleCode ?? null, c.from ?? 0, c.to]);
    await this.db.query(`DELETE FROM vehicle_history_stream_keys k WHERE NOT EXISTS (SELECT 1 FROM vehicle_history_frames f WHERE f.stream_key=k.stream_key)`);
    await this.db.query(`UPDATE vehicle_history_stream_keys k SET first_real=x.first_real,last_real=x.last_real FROM (SELECT stream_key,min(received_at) first_real,max(received_at) last_real FROM vehicle_history_frames GROUP BY stream_key) x WHERE x.stream_key=k.stream_key`);
  }

  async previewPolicy(category: string, input: any, operatorId: string) {
    const unit = input?.retentionUnit === 'hour' ? 'hour' : input?.retentionUnit === 'day' ? 'day' : null;
    const value = Number(input?.retentionValue); const interval = Number(input?.intervalMinutes);
    if (!unit || !Number.isInteger(value) || value < 1 || value > 3650 || !Number.isInteger(interval) || interval < 15 || interval > 10080) throw new BadRequestException('保留期限或執行間隔無效');
    const duration = value * (unit === 'day' ? 86_400_000 : 3_600_000);
    const plan = await this.preview({ category, to: Date.now() - duration }, operatorId);
    await this.db.query(`UPDATE data_cleanup_plans SET criteria=criteria || $2::jsonb WHERE id=$1`, [plan.planId, JSON.stringify({ purpose: 'policy', proposedPolicy: { enabled: Boolean(input.enabled), retentionValue: value, retentionUnit: unit, intervalMinutes: interval } })]);
    return plan;
  }

  async savePolicy(category: string, input: any, operatorId: string) {
    if (!CATEGORY_INFO[category as CleanupCategory]) throw new BadRequestException('不支援的資料類別');
    if (category === 'telemetry' && await this.legacyTelemetryPolicy()) throw new ConflictException('目前有既有 TimescaleDB 遙測政策；請先由維運流程確認並移轉，系統不會建立第二個排程');
    const enabled = Boolean(input?.enabled); const value = Number(input?.retentionValue); const unit = input?.retentionUnit; const interval = Number(input?.intervalMinutes);
    if (!['hour','day'].includes(unit) || !Number.isInteger(value) || value < 1 || !Number.isInteger(interval) || interval < 15) throw new BadRequestException('政策設定無效');
    const [current] = await this.db.query(`SELECT * FROM data_retention_policies WHERE category=$1`, [category]);
    const oldMs = Number(current?.retention_value ?? value) * (current?.retention_unit === 'hour' ? 3_600_000 : 86_400_000); const newMs = value * (unit === 'hour' ? 3_600_000 : 86_400_000);
    if ((enabled && !current?.enabled) || (enabled && newMs < oldMs)) {
      const [plan] = await this.db.query(`SELECT * FROM data_cleanup_plans WHERE id=$1 AND operator_id=$2 AND expires_at>=$3 AND consumed_at IS NULL`, [input?.confirmationPlanId, operatorId, Date.now()]);
      if (!plan || plan.category !== category || plan.criteria?.purpose !== 'policy') throw new ConflictException('啟用或縮短政策前必須重新預覽並確認');
    }
    const now = Date.now(); const next = enabled ? now + interval * 60_000 : null;
    const rows = await this.db.query(`INSERT INTO data_retention_policies(category,enabled,retention_value,retention_unit,interval_minutes,next_run_at,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(category) DO UPDATE SET enabled=EXCLUDED.enabled,retention_value=EXCLUDED.retention_value,retention_unit=EXCLUDED.retention_unit,interval_minutes=EXCLUDED.interval_minutes,next_run_at=EXCLUDED.next_run_at,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at RETURNING *`, [category, enabled, value, unit, interval, next, operatorId, now]);
    return rows[0];
  }

  private async runDuePolicies() {
    try {
      const due = await this.db.query(`SELECT * FROM data_retention_policies WHERE enabled=true AND next_run_at <= $1 ORDER BY next_run_at LIMIT 1`, [Date.now()]);
      if (!due.length || due[0].category === 'telemetry' && await this.legacyTelemetryPolicy()) return;
      const p = due[0]; const unitMs = p.retention_unit === 'hour' ? 3_600_000 : 86_400_000; const cutoff = Date.now() - Number(p.retention_value) * unitMs; const criteria = this.normalize({ category: p.category, to: cutoff }, 'policy'); const now = Date.now();
      const counts = await this.exactCounts(criteria);
      (criteria as CleanupCriteria & { expectedRecords: number }).expectedRecords = counts.records + counts.relatedRecords;
      const rows = await this.db.query(`INSERT INTO data_cleanup_jobs(category,trigger,status,criteria,requested_at) VALUES($1,'policy','queued',$2,$3) RETURNING id`, [p.category, criteria, now]);
      await this.db.query(`UPDATE data_retention_policies SET next_run_at=$2 WHERE category=$1`, [p.category, now + Number(p.interval_minutes) * 60_000]);
      setImmediate(() => void this.processJob(rows[0].id));
    } catch (error) { this.logger.error('Retention scheduler failed', error); }
  }
}
