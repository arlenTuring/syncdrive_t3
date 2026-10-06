import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { operatingDayOf, operatingDayStart } from '../operating-day/operating-day';

/**
 * 儀表板查詢裡的營運時間（見 operating-day/operating-day.ts）。
 *
 * <code>operating_now_ms()</code>：此刻的營運時刻；<code>operating_day_start_ms()</code>：營運日零點；
 * <code>operating_day()</code>：營運日字串（'YYYY-MM-DD'，對訂單 payload.operating_day）。
 * 計畫時刻（planned_start／planned_end、站序時刻）要跟這兩個比，不能跟 now() 比——加速重播時
 * 營運時間跟實際時間不同。訊息新鮮度（payload.updated_at、slot last_updated）仍跟 now() 比。
 * 執行前換成數值，查詢本身不需要任何資料庫函式。
 */
export function substituteOperatingTime(query: string, operatingNow: number, dayStart: number, day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`營運日格式不對：${day}`);
  return query
    .replace(/\boperating_now_ms\(\s*\)/gi, `(${Math.round(operatingNow)}::bigint)`)
    .replace(/\boperating_day_start_ms\(\s*\)/gi, `(${Math.round(dayStart)}::bigint)`)
    .replace(/\boperating_day\(\s*\)/gi, `'${day}'`);
}

@Injectable()
export class DatasourceService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Optional() private readonly operatingClock?: OperatingClockService,
  ) {}

  private withOperatingTime(query: string): string {
    if (!/operating_(now_ms|day_start_ms|day)\s*\(/i.test(query)) return query;
    const now = this.operatingClock?.now() ?? Date.now();
    const day = this.operatingClock?.operatingDay() ?? operatingDayOf(now);
    const start = operatingDayStart(day) ?? new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
    return substituteOperatingTime(query, now, start, day);
  }

  /** 取得所有 public schema 下的資料表清單 */
  async getTables(): Promise<{ table_name: string }[]> {
    return this.dataSource.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
  }

  /** 取得指定資料表的欄位結構 */
  async getTableSchema(tableName: string): Promise<{ column_name: string; data_type: string; is_nullable: string }[]> {
    // 防止 SQL Injection：只允許合法的表名字元
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new BadRequestException('Invalid table name');
    }
    return this.dataSource.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
  }

  /** 執行查詢（僅允許 SELECT） */
  async runQuery(query: string, limit = 200): Promise<{ rows: any[]; rowCount: number; columns: string[] }> {
    const normalized = query.trim().toUpperCase();

    // 只允許 SELECT（含 WITH … SELECT CTE）
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new BadRequestException('只允許 SELECT 查詢');
    }

    // 禁止分號（防止多語句注入：SELECT 1; DROP TABLE ...）
    if (query.includes(';')) {
      throw new BadRequestException('查詢中不允許包含分號（禁止多語句）');
    }

    // 禁止危險的 PostgreSQL 函數與 DDL 關鍵字（防止 pg_read_file 等攻擊）
    const FORBIDDEN = /\b(pg_read_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|copy|dblink)\b/i;
    if (FORBIDDEN.test(query)) {
      throw new BadRequestException('查詢包含禁止使用的函數或關鍵字');
    }

    // 若查詢中沒有 LIMIT，自動加上防護上限
    const resolved = this.withOperatingTime(query);
    const safeQuery = /\bLIMIT\b/i.test(resolved)
      ? resolved.trim()
      : `${resolved.trim()} LIMIT ${limit}`;

    const rows = await this.dataSource.query(safeQuery);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return { rows, rowCount: rows.length, columns };
  }

  /** 快速連線測試 */
  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    await this.dataSource.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  }
}
