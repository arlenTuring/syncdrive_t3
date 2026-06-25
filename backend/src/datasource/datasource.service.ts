import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatasourceService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

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
    const safeQuery = /\bLIMIT\b/i.test(query)
      ? query.trim()
      : `${query.trim()} LIMIT ${limit}`;

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
