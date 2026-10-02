import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { DataAdminAudit } from '../database/entities/data-admin-audit.entity';
import { DatasourceInvalidationService, DS_TAGS } from '../events/datasource-invalidation.service';

export type AdminQueryMode = 'read' | 'write';

export type ExecuteAdminQuery = {
  sql: string;
  mode: AdminQueryMode;
  limit?: number;
  timeoutMs?: number;
  requestId?: string;
};

type QueryContext = { operatorId: string; sourceIp?: string };

const SENSITIVE_FUNCTIONS = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink|copy)\b/i;

export function stripTerminalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '');
}

export function planContainsWrite(plan: unknown): boolean {
  if (!plan || typeof plan !== 'object') return false;
  if (Array.isArray(plan)) return plan.some(planContainsWrite);
  const record = plan as Record<string, unknown>;
  if (record['Node Type'] === 'ModifyTable') return true;
  return Object.values(record).some(planContainsWrite);
}

export function collectPlanRelations(plan: unknown, found = new Set<string>()): Set<string> {
  if (!plan || typeof plan !== 'object') return found;
  if (Array.isArray(plan)) {
    plan.forEach((item) => collectPlanRelations(item, found));
    return found;
  }
  const record = plan as Record<string, unknown>;
  if (typeof record['Relation Name'] === 'string') found.add(record['Relation Name']);
  Object.values(record).forEach((value) => collectPlanRelations(value, found));
  return found;
}

@Injectable()
export class DataAdminService {
  private readonly active = new Map<string, { runner: QueryRunner; backendPid: number }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DataAdminAudit)
    private readonly audits: Repository<DataAdminAudit>,
    private readonly invalidation: DatasourceInvalidationService,
  ) {}

  async metadata() {
    const connection = await this.dataSource.query(`
      SELECT current_user AS database_user,
             COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser
    `);
    const tables = await this.dataSource.query(`
      SELECT t.table_schema AS schema, t.table_name AS name,
             COALESCE(s.n_live_tup, 0)::bigint AS estimated_rows
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = t.table_schema AND s.relname = t.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_schema NOT LIKE '\\_timescaledb%'
      ORDER BY t.table_schema, t.table_name
    `);
    const columns = await this.dataSource.query(`
      SELECT table_schema AS schema, table_name AS table, column_name AS name,
             data_type AS type, is_nullable = 'YES' AS nullable,
             column_default AS default_value
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_schema NOT LIKE '\\_timescaledb%'
      ORDER BY table_schema, table_name, ordinal_position
    `);
    const constraints = await this.dataSource.query(`
      SELECT tc.table_schema AS schema, tc.table_name AS table,
             tc.constraint_name AS name, tc.constraint_type AS type,
             kcu.column_name AS column,
             ccu.table_schema AS foreign_schema,
             ccu.table_name AS foreign_table,
             ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND tc.table_schema NOT LIKE '\\_timescaledb%'
      ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
    `);
    const options = this.dataSource.options as unknown as Record<string, unknown>;
    return {
      environment: {
        type: options.type,
        host: options.host,
        port: options.port,
        database: options.database,
        schema: options.schema ?? 'public',
        databaseUser: connection[0]?.database_user,
        isSuperuser: Boolean(connection[0]?.is_superuser),
      },
      tables,
      columns,
      constraints,
    };
  }

  async orderCleanupPreview() {
    const statusCounts = await this.dataSource.query(`
      SELECT status, count(*)::int AS count
      FROM operation_orders
      GROUP BY status
      ORDER BY status
    `);
    const relatedCounts = await this.dataSource.query(`
      SELECT
        (SELECT count(*)::int FROM order_action_states s WHERE EXISTS (
          SELECT 1 FROM operation_orders o WHERE o.order_id = s.order_id
        )) AS order_action_states,
        (SELECT count(*)::int FROM order_events e WHERE EXISTS (
          SELECT 1 FROM operation_orders o WHERE o.order_id = e.order_id
        )) AS order_events,
        (SELECT count(*)::int FROM operation_orders) AS operation_orders
    `);
    return {
      statusCounts,
      relatedCounts: relatedCounts[0],
      preserved: [
        'operation_shifts', 'time_templates', 'operation_routes', 'maintenance_tasks',
        'maps', 'map_versions', 'vehicles', 'accounts', 'partner_api_keys', 'dashboard_planes',
      ],
    };
  }

  async sample(schema: string, table: string, limit = 20) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('資料表名稱無效');
    }
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await this.dataSource.query(
      `SELECT * FROM "${schema}"."${table}" LIMIT ${safeLimit}`,
    );
    return { rows, rowCount: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] };
  }

  async execute(input: ExecuteAdminQuery, context: QueryContext) {
    const sql = stripTerminalSemicolon(input.sql ?? '');
    if (!sql) throw new BadRequestException('SQL 不可為空');
    if (SENSITIVE_FUNCTIONS.test(sql)) throw new BadRequestException('SQL 包含禁止使用的伺服器函數');
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 200), 1), 1000);
    const timeoutMs = Math.min(Math.max(Math.trunc(input.timeoutMs ?? 8000), 250), 30000);
    const requestId = input.requestId?.trim() || randomUUID();
    if (this.active.has(requestId)) throw new BadRequestException('requestId 已在執行中');

    const runner = this.dataSource.createQueryRunner();
    const startedAt = Date.now();
    let backendPid = 0;
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);
      if (input.mode === 'read') await runner.query('SET TRANSACTION READ ONLY');
      backendPid = Number((await runner.query('SELECT pg_backend_pid() AS pid'))[0]?.pid);
      this.active.set(requestId, { runner, backendPid });

      const explained = await runner.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      const plan = explained[0]?.['QUERY PLAN']?.[0]?.Plan;
      const isWrite = planContainsWrite(plan);
      const affectedRelations = [...collectPlanRelations(plan)];
      if (input.mode === 'write' && !isWrite) {
        throw new BadRequestException('寫入模式只接受 INSERT、UPDATE 或 DELETE');
      }
      if (input.mode === 'read' && isWrite) {
        throw new BadRequestException('唯讀模式不可執行寫入語句');
      }

      const queryResult = input.mode === 'read'
        ? await runner.query(`SELECT * FROM (${sql}) AS admin_query_result LIMIT ${limit + 1}`, [], true)
        : await runner.query(sql, [], true);
      const records = queryResult.records ?? [];
      const truncated = input.mode === 'read' && records.length > limit;
      const rows = truncated ? records.slice(0, limit) : records;
      await runner.commitTransaction();
      if (input.mode === 'write') {
        const tags = affectedRelations.map((name) => `table:${name}`);
        this.invalidation.emit(tags, 'data_admin_write');
        if (affectedRelations.includes('operation_orders')) {
          this.invalidation.emitOrderLifecycle(undefined, [DS_TAGS.EVENT_CENTER]);
        }
      }
      await this.writeAudit(context, requestId, input.mode, sql, 'SUCCESS', rows.length, null);
      return {
        requestId,
        rows,
        rowCount: rows.length,
        affected: queryResult.affected ?? rows.length,
        columns: rows[0] ? Object.keys(rows[0]) : [],
        truncated,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      const message = error instanceof Error ? error.message : String(error);
      await this.writeAudit(context, requestId, input.mode, sql, 'FAILED', null, message);
      throw error;
    } finally {
      this.active.delete(requestId);
      await runner.release();
    }
  }

  async cancel(requestId: string) {
    const execution = this.active.get(requestId);
    if (!execution) throw new NotFoundException('找不到執行中的查詢');
    const result = await this.dataSource.query('SELECT pg_cancel_backend($1) AS cancelled', [execution.backendPid]);
    return { requestId, cancelled: Boolean(result[0]?.cancelled) };
  }

  private async writeAudit(
    context: QueryContext,
    requestId: string,
    mode: AdminQueryMode,
    statement: string,
    result: string,
    rowCount: number | null,
    failureReason: string | null,
  ) {
    await this.audits.save(this.audits.create({
      operatorId: context.operatorId,
      sourceIp: context.sourceIp ?? null,
      requestId,
      mode,
      statement,
      result,
      rowCount,
      failureReason,
    }));
  }
}
