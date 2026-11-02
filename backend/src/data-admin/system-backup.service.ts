import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream, existsSync, promises as fsp, statfsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { DataSource } from 'typeorm';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { backupDirProblem, backupRunName, backupSizeEstimate, backupsToPrune, isBackupRunName, isBackupTime, nextBackupAt } from './system-backup';

const DATABASE_FILE = 'database.dump';
const DATA_FILE = 'app-data.tar.gz';
const RUN_COLUMNS = `id, trigger, status, dir, name, include_files, started_at, finished_at, database_bytes, files_bytes, database_sha256, verified, error, operator_id`;

type BackupRun = { id: string; trigger: string; status: string; dir: string; name: string; include_files: boolean; started_at: string; finished_at: string | null; database_bytes: string | null; files_bytes: string | null; database_sha256: string | null; verified: boolean; error: string | null; operator_id: string | null };
type Settings = { manual_dir: string; auto_dir: string; auto_enabled: boolean; auto_time: string; keep_count: number; include_files: boolean; next_run_at: string | null };

@Injectable()
export class SystemBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemBackupService.name);
  private timer?: NodeJS.Timeout;
  private active?: { id: string; abort: AbortController };

  constructor(
    private readonly db: DataSource,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  /** 正式環境是 /app/data；本機是 backend/data。錄影不在這裡面。 */
  private get dataDir() { return resolve(process.cwd(), 'data'); }
  private get defaultDir() { return process.env.BACKUP_DEFAULT_DIR || resolve(process.cwd(), '../.backups/system'); }
  /** 本機沒裝 PostgreSQL 工具時借用資料庫容器（例如 docker exec -i syncdrive_postgres）；正式映像內建 */
  private get toolPrefix() { return (process.env.BACKUP_PG_TOOLS_PREFIX ?? '').trim().split(/\s+/).filter(Boolean); }

  async onModuleInit() {
    await this.db.query(`INSERT INTO system_backup_settings(id, manual_dir, auto_dir) VALUES (1, $1, $1) ON CONFLICT DO NOTHING`, [this.defaultDir]).catch(() => undefined);
    const stale: BackupRun[] = await this.db.query(`SELECT ${RUN_COLUMNS} FROM system_backup_runs WHERE status='running'`).catch(() => []);
    for (const run of stale) await this.finishFailed(run, '後端重啟，備份中斷');
    this.timer = setInterval(() => void this.runDue(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.active?.abort.abort();
  }

  private async settings(): Promise<Settings> {
    const [row] = await this.db.query(`SELECT manual_dir, auto_dir, auto_enabled, auto_time, keep_count, include_files, next_run_at FROM system_backup_settings WHERE id=1`);
    return row;
  }

  private async runs(): Promise<BackupRun[]> {
    return this.db.query(`SELECT ${RUN_COLUMNS} FROM system_backup_runs WHERE status <> 'deleted' ORDER BY started_at DESC LIMIT 50`);
  }

  /** 真的寫一次再刪掉，並量空間；容器內還要確認路徑不是重建就消失的容器層 */
  async inspectDir(dir: unknown) {
    const problem = backupDirProblem(dir, this.dataDir);
    if (problem) throw new BadRequestException(problem);
    const path = dir as string;
    const probe = join(path, `.syncdrive-write-test-${randomUUID()}`);
    try {
      await fsp.mkdir(path, { recursive: true });
      await fsp.writeFile(probe, 'ok');
      await fsp.unlink(probe);
    } catch (error) {
      throw new BadRequestException(`後端無法寫入此位置：${error instanceof Error ? error.message : String(error)}`);
    }
    const device = statSync(path).dev;
    if (existsSync('/.dockerenv') && device === statSync('/').dev) throw new BadRequestException('這個路徑在容器內部，容器重建後備份會消失。請改用已掛載的位置');
    const stat = statfsSync(path);
    return {
      path,
      totalBytes: Number(stat.blocks) * Number(stat.bsize),
      freeBytes: Number(stat.bavail) * Number(stat.bsize),
      // 系統資料與資料庫卷通常在同一顆磁碟：放這裡擋得住誤刪，擋不住磁碟損毀
      sameDiskAsSystem: device === statSync(this.dataDir).dev,
    };
  }

  private async tools() {
    try {
      const { stdout } = await this.exec(['pg_dump', '--version']);
      return { available: true, version: stdout.trim() };
    } catch (error) {
      return { available: false, version: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async status() {
    const [settings, runs, tools, [size]] = await Promise.all([this.settings(), this.runs(), this.tools(), this.db.query(`SELECT pg_database_size(current_database())::bigint AS bytes`)]);
    return {
      settings: { manualDir: settings.manual_dir, autoDir: settings.auto_dir, autoEnabled: settings.auto_enabled, autoTime: settings.auto_time, keepCount: settings.keep_count, includeFiles: settings.include_files, nextRunAt: settings.next_run_at == null ? null : Number(settings.next_run_at) },
      tools,
      databaseBytes: Number(size.bytes),
      runs: runs.map((run) => ({ ...run, files_exist: run.status === 'success' ? existsSync(join(run.dir, run.name)) : null })),
    };
  }

  async saveSettings(input: any, operatorId: string) {
    const keepCount = Number(input?.keepCount);
    if (!Number.isInteger(keepCount) || keepCount < 1 || keepCount > 365) throw new BadRequestException('保留天數需為 1 到 365');
    if (!isBackupTime(input?.autoTime)) throw new BadRequestException('備份時間格式不正確');
    const autoEnabled = input?.autoEnabled === true;
    await this.inspectDir(input?.manualDir);
    // 自動備份關閉時位置只是草稿，等開啟才要求可用
    if (autoEnabled) await this.inspectDir(input?.autoDir);
    else { const problem = backupDirProblem(input?.autoDir, this.dataDir); if (problem) throw new BadRequestException(problem); }
    const now = Date.now();
    await this.db.query(
      `UPDATE system_backup_settings SET manual_dir=$1, auto_dir=$2, auto_enabled=$3, auto_time=$4, keep_count=$5, include_files=$6, next_run_at=$7, updated_at=$8, updated_by=$9 WHERE id=1`,
      [input.manualDir, input.autoDir, autoEnabled, input.autoTime, keepCount, input?.includeFiles !== false, autoEnabled ? nextBackupAt(input.autoTime, now) : null, now, operatorId],
    );
    return this.status();
  }

  /** 立刻回應，備份在背景跑；同時間只有一份，由資料庫唯一索引保證 */
  async start(trigger: 'manual' | 'auto', operatorId: string | null) {
    const settings = await this.settings();
    const dir = trigger === 'auto' ? settings.auto_dir : settings.manual_dir;
    const location = await this.inspectDir(dir);
    const startedAt = Date.now();
    const id = randomUUID();
    const rows: BackupRun[] = await this.db.query(
      `INSERT INTO system_backup_runs(id, trigger, status, dir, name, include_files, started_at, operator_id)
       VALUES ($1, $2, 'running', $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING ${RUN_COLUMNS}`,
      [id, trigger, dir, backupRunName(trigger, startedAt), settings.include_files, startedAt, operatorId],
    );
    if (rows.length === 0) throw new ConflictException('已有備份進行中');
    const abort = new AbortController();
    this.active = { id, abort };
    setImmediate(() => void this.execute(rows[0], settings, location.freeBytes, abort.signal));
    return rows[0];
  }

  stop(id: string) {
    if (this.active?.id !== id) throw new NotFoundException('這份備份不在進行中');
    this.active.abort.abort();
    return { stopping: true };
  }

  async remove(id: string) {
    const [run]: BackupRun[] = await this.db.query(`SELECT ${RUN_COLUMNS} FROM system_backup_runs WHERE id=$1`, [id]);
    if (!run || run.status === 'deleted') throw new NotFoundException('找不到這份備份');
    if (run.status === 'running') throw new ConflictException('備份進行中，請先停止');
    await this.deleteFiles(run);
    return { deleted: true };
  }

  private async deleteFiles(run: BackupRun) {
    if (!isBackupRunName(run.name)) throw new BadRequestException('備份名稱不正確，已拒絕刪除');
    await fsp.rm(join(run.dir, run.name), { recursive: true, force: true });
    await this.db.query(`UPDATE system_backup_runs SET status='deleted' WHERE id=$1`, [run.id]);
  }

  private async execute(run: BackupRun, settings: Settings, freeBytes: number, signal: AbortSignal) {
    const partial = join(run.dir, `${run.name}.partial`);
    try {
      const [last] = await this.db.query(`SELECT COALESCE(database_bytes,0)+COALESCE(files_bytes,0) AS bytes FROM system_backup_runs WHERE status='success' ORDER BY started_at DESC LIMIT 1`);
      const [size] = await this.db.query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
      const needed = backupSizeEstimate(last ? Number(last.bytes) : null, Number(size.bytes));
      if (freeBytes < needed) throw new Error(`剩餘空間不足：約需 ${Math.ceil(needed / 1e9)} GB，只剩 ${Math.floor(freeBytes / 1e9)} GB`);

      await fsp.mkdir(partial, { recursive: true });
      const dumpPath = join(partial, DATABASE_FILE);
      const database = await this.dumpDatabase(dumpPath, signal);
      await this.verifyDump(dumpPath, signal);
      const filesBytes = run.include_files ? await this.archiveData(join(partial, DATA_FILE), signal) : null;
      await fsp.writeFile(join(partial, 'manifest.json'), JSON.stringify(await this.manifest(run, database, filesBytes), null, 2));
      // 全部寫完才改名：看得到正式名稱的資料夾一定是完整的
      await fsp.rename(partial, join(run.dir, run.name));
      await this.db.query(
        `UPDATE system_backup_runs SET status='success', finished_at=$2, database_bytes=$3, files_bytes=$4, database_sha256=$5, verified=true WHERE id=$1`,
        [run.id, Date.now(), database.bytes, filesBytes, database.sha256],
      );
      if (run.trigger === 'auto') await this.prune(settings.keep_count);
    } catch (error) {
      const message = signal.aborted ? '已手動停止' : error instanceof Error ? error.message : String(error);
      this.logger.warn(`備份失敗：${message}`);
      await this.finishFailed(run, message, signal.aborted);
    } finally {
      if (this.active?.id === run.id) this.active = undefined;
    }
  }

  private async finishFailed(run: BackupRun, message: string, stopped = false) {
    await fsp.rm(join(run.dir, `${run.name}.partial`), { recursive: true, force: true }).catch(() => undefined);
    await this.db.query(`UPDATE system_backup_runs SET status=$2, finished_at=$3, error=$4 WHERE id=$1`, [run.id, stopped ? 'stopped' : 'failed', Date.now(), message.slice(0, 2000)]).catch(() => undefined);
    // 手動備份有人看著畫面；自動備份失敗沒人知道，要進事件管理
    if (run.trigger === 'auto' && !stopped) await this.reportFailure(run, message);
  }

  private async reportFailure(run: BackupRun, message: string) {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO security_event_logs
         (event_id, dedup_key, received_at, source_type, source_id, source_name_snapshot, origin,
          occurred_at_valid, event_code, severity, params, created_at, category_label, display_message)
       VALUES ($1, $2, $3, 'SYSTEM', 'system-backup', '系統基礎設定', 'CENTER', true, 'SYSTEM_BACKUP_FAILED', 'WARNING', $4::jsonb, $5, '自動備份失敗', $6)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), `system-backup-failed|${run.id}`, now, JSON.stringify({ run_id: run.id, dir: run.dir }), now, `自動備份失敗：${message.slice(0, 200)}`],
    ).then(() => this.invalidation?.emitEventCenter()).catch((error) => this.logger.warn(`備份失敗事件寫入失敗：${error instanceof Error ? error.message : String(error)}`));
  }

  /** 超過份數才刪，而且只在剛成功一份之後，備份連續失敗時舊備份不會被刪光 */
  private async prune(keepCount: number) {
    const rows: BackupRun[] = await this.db.query(`SELECT ${RUN_COLUMNS} FROM system_backup_runs WHERE trigger='auto' AND status='success'`);
    for (const run of backupsToPrune(rows, keepCount)) await this.deleteFiles(run).catch((error) => this.logger.warn(`舊備份刪除失敗：${error instanceof Error ? error.message : String(error)}`));
  }

  private async runDue() {
    const now = Date.now();
    try {
      const claimed = await this.db.query(
        `UPDATE system_backup_settings SET next_run_at=$2 WHERE id=1 AND auto_enabled AND next_run_at <= $1 RETURNING id`,
        [now, nextBackupAt((await this.settings()).auto_time, now)],
      ).then((result) => (Array.isArray(result?.[0]) ? result[0] : result));
      if (claimed.length > 0) await this.start('auto', null);
    } catch (error) {
      if (error instanceof ConflictException) return void this.logger.warn('自動備份略過：已有備份進行中');
      const message = error instanceof BadRequestException ? String(error.message) : error instanceof Error ? error.message : String(error);
      this.logger.warn(`自動備份無法開始：${message}`);
      await this.reportFailure({ id: `${now}`, dir: '' } as BackupRun, message);
    }
  }

  private toolCommand(args: string[]) {
    const [command, ...rest] = [...this.toolPrefix, ...args];
    return { command, args: rest };
  }

  /** 容器內走本機 socket；直連時帶主機與帳號，密碼只放環境變數，不進指令列 */
  private connection() {
    const options = this.db.options as { host?: string; port?: number; username?: string; password?: string; database?: string };
    const args = ['-U', String(options.username), '-d', String(options.database)];
    if (this.toolPrefix.length > 0) return { args, env: process.env };
    return { args: [...args, '-h', String(options.host), '-p', String(options.port ?? 5432)], env: { ...process.env, PGPASSWORD: options.password } };
  }

  private exec(args: string[], signal?: AbortSignal): Promise<{ stdout: string }> {
    return new Promise((done, fail) => {
      const { command, args: rest } = this.toolCommand(args);
      const child = spawn(command, rest, { stdio: ['ignore', 'pipe', 'pipe'], signal });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? done({ stdout }) : fail(new Error(stderr.trim() || `${command} 結束碼 ${code}`))));
    });
  }

  /** 串流寫檔，同時算校驗碼；pg_dump 非零結束就算失敗，不看檔案大小猜 */
  private async dumpDatabase(path: string, signal: AbortSignal) {
    const connection = this.connection();
    const { command, args } = this.toolCommand(['pg_dump', ...connection.args, '-Fc']);
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: connection.env, signal });
    const failed = this.exitPromise(child, command);
    const hash = createHash('sha256');
    let bytes = 0;
    child.stdout!.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
    await Promise.all([pipeline(child.stdout!, createWriteStream(path, { mode: 0o600 })), failed]);
    return { bytes, sha256: hash.digest('hex') };
  }

  /** 整份讀過一次：pg_restore 能從頭解到尾才算備份成功，不只看目錄 */
  private async verifyDump(path: string, signal: AbortSignal) {
    const { command, args } = this.toolCommand(['pg_restore', '-f', '/dev/null']);
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], signal });
    const failed = this.exitPromise(child, command);
    await Promise.all([pipeline(createReadStream(path), child.stdin!), failed]);
  }

  /** 圖資、媒體與金鑰檔。錄影另有保存機制，不進備份。 */
  private async archiveData(path: string, signal: AbortSignal) {
    if (!existsSync(this.dataDir)) return null;
    const child = spawn('tar', ['-czf', path, '--exclude=./video', '-C', this.dataDir, '.'], { stdio: ['ignore', 'ignore', 'pipe'], signal });
    await this.exitPromise(child, 'tar');
    await fsp.chmod(path, 0o600);
    return (await fsp.stat(path)).size;
  }

  private exitPromise(child: ReturnType<typeof spawn>, command: string) {
    return new Promise<void>((done, fail) => {
      let stderr = '';
      child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? done() : fail(new Error(stderr.trim() || `${command} 結束碼 ${code}`))));
    });
  }

  private async manifest(run: BackupRun, database: { bytes: number; sha256: string }, filesBytes: number | null) {
    const [versions] = await this.db.query(`SELECT current_setting('server_version') AS postgres, (SELECT extversion FROM pg_extension WHERE extname='timescaledb') AS timescaledb`);
    return {
      createdAt: new Date(Number(run.started_at)).toISOString(),
      trigger: run.trigger,
      database: { name: (this.db.options as { database?: string }).database, file: DATABASE_FILE, ...database },
      files: filesBytes == null ? null : { file: DATA_FILE, bytes: filesBytes, excludes: ['video'] },
      versions,
    };
  }
}
