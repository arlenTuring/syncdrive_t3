#!/usr/bin/env node
/**
 * 錯誤重播批次的一次性清理：只刪「指定前綴＋來源＋營運日＋狀態」同時成立的訂單，與它們專屬的子列。
 *
 *   dry-run  （預設）唯讀交易盤點，寫出 manifest（精確主鍵、整列快照、雜湊、依賴計數）
 *   apply    以同一份 manifest 在單一交易內刪除；需已驗證的備份檔與它的 SHA-256
 *   restore  把 manifest 快照裡的列放回去（已存在的不覆蓋，不動清理後的新資料）
 *
 * 用法（在 backend 目錄）：
 *   node scripts/maintenance/replay-batch-cleanup.js dry-run --prefix SIM-PLAN-mvafnd8f- \
 *     --source plan_replay --day 2026-10-16 --statuses FAULTED,PENDING --out <備份目錄>
 *   node scripts/maintenance/replay-batch-cleanup.js apply --manifest <備份目錄>/manifest.json \
 *     --backup <pg_dump 檔> --backup-sha256 <雜湊>
 *   node scripts/maintenance/replay-batch-cleanup.js restore --manifest <備份目錄>/manifest.json
 *   加 --database <名稱> 可對同一台本機 PostgreSQL 的演練資料庫操作。
 *
 * 安全邊界：
 *   - 連線讀 backend/.env，只接受 loopback 主機；沒有繞過到遠端的旗標。
 *   - 條件全部參數化，前綴用 left(order_id, length($1)) = $1（不用萬用字元）。
 *   - apply 重查每一列與 manifest 的雜湊一致、依賴計數一致；任何不符整筆 ROLLBACK。
 *   - 只刪 order_action_states、order_events（依精確 order_id）與 operation_orders；
 *     scheduled_order_entries 有引用就中止（不刪人工排程）；車輛歷史、事件、稽核、錄影一律保留。
 *   - 同一份 manifest 重跑：已刪的列只回報「已清理」，不會多刪。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
/** 依精確 order_id 刪除的子表（盤點時沒有 FK，邏輯關聯以欄位名確認） */
const CHILD_TABLES = [
  { table: 'order_action_states', column: 'order_id' },
  { table: 'order_events', column: 'order_id' },
];
/** 有引用就中止、不刪的表 */
const BLOCKING_TABLES = [{ table: 'scheduled_order_entries', column: 'operation_order_id' }];
/** 保留不動、只記錄計數的觀測／稽核資料 */
const PRESERVED = [
  { table: 'vehicle_history_frames', sql: 'SELECT count(*)::int AS n FROM vehicle_history_frames WHERE order_id = ANY($1)' },
  { table: 'operator_action_logs', sql: "SELECT count(*)::int AS n FROM operator_action_logs WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) id WHERE action_detail::text LIKE '%' || id || '%')" },
];

function parseArgs(argv) {
  const [command = 'dry-run', ...rest] = argv;
  const opts = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i].replace(/^--/, '');
    opts[key] = rest[i + 1];
    i += 1;
  }
  return opts;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8 * 1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return hash.digest('hex');
}

async function connect(database) {
  const host = process.env.DB_HOST ?? '';
  if (!LOOPBACK.has(host)) throw new Error(`只對本機資料庫操作；DB_HOST=${host || '（空）'} 不是 loopback`);
  const client = new Client({
    host,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: database ?? process.env.DB_NAME,
  });
  await client.connect();
  return { client, target: { host, port: Number(process.env.DB_PORT), database: database ?? process.env.DB_NAME } };
}

const CANDIDATE_SQL = `
  SELECT o.order_id, o.vehicle_code, o.status, o.planned_start, o.planned_end,
         o.payload->>'source' AS source, o.payload->>'operating_day' AS operating_day,
         to_jsonb(o) AS row
  FROM operation_orders o
  WHERE left(o.order_id, length($1)) = $1
    AND o.payload->>'source' = $2
    AND o.payload->>'operating_day' = $3
    AND o.status = ANY($4)
  ORDER BY o.order_id`;

async function childSnapshot(client, ids) {
  const out = {};
  for (const { table, column } of [...CHILD_TABLES, ...BLOCKING_TABLES]) {
    const { rows } = await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${column} = ANY($1)`, [ids]);
    out[table] = { column, count: rows.length, rows: rows.map((r) => r.row) };
  }
  return out;
}

async function batchStats(client, criteria) {
  const { rows } = await client.query(
    `SELECT status, count(*)::int AS n FROM operation_orders
     WHERE left(order_id, length($1)) = $1 AND payload->>'source' = $2 AND payload->>'operating_day' = $3
     GROUP BY status ORDER BY status`,
    [criteria.prefix, criteria.source, criteria.day],
  );
  const total = await client.query('SELECT count(*)::int AS n FROM operation_orders');
  return { batch: Object.fromEntries(rows.map((r) => [r.status, r.n])), allOrders: total.rows[0].n };
}

async function dryRun(opts) {
  const criteria = {
    prefix: opts.prefix,
    source: opts.source,
    day: opts.day,
    statuses: String(opts.statuses ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (!criteria.prefix || !criteria.source || !/^\d{4}-\d{2}-\d{2}$/.test(criteria.day ?? '') || criteria.statuses.length === 0) {
    throw new Error('需要 --prefix、--source、--day YYYY-MM-DD、--statuses');
  }
  if (criteria.statuses.some((s) => !['FAULTED', 'PENDING'].includes(s))) throw new Error('本工具只清 FAULTED／PENDING');
  if (!opts.out) throw new Error('需要 --out <備份目錄>');
  const { client, target } = await connect(opts.database);
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(CANDIDATE_SQL, [criteria.prefix, criteria.source, criteria.day, criteria.statuses]);
    const ids = rows.map((r) => r.order_id);
    const children = await childSnapshot(client, ids);
    const preserved = {};
    for (const p of PRESERVED) {
      const exists = (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [p.table])).rows[0].ok;
      preserved[p.table] = exists ? (await client.query(p.sql, [ids])).rows[0].n : null;
    }
    const stats = await batchStats(client, criteria);
    await client.query('ROLLBACK');
    const targets = rows.map((r) => ({
      order_id: r.order_id,
      vehicle_code: r.vehicle_code,
      status: r.status,
      planned_start: r.planned_start == null ? null : Number(r.planned_start),
      planned_end: r.planned_end == null ? null : Number(r.planned_end),
      operating_day: r.operating_day,
      source: r.source,
      row_sha256: sha256(JSON.stringify(r.row)),
    }));
    const manifest = {
      kind: 'replay-batch-cleanup',
      createdAt: new Date().toISOString(),
      db: target,
      criteria,
      targets,
      rows: rows.map((r) => r.row),
      children,
      preserved,
      before: stats,
    };
    manifest.manifestSha256 = sha256(JSON.stringify({ criteria, targets, children: Object.fromEntries(Object.entries(children).map(([k, v]) => [k, v.count])) }));
    fs.mkdirSync(opts.out, { recursive: true, mode: 0o700 });
    const file = path.join(opts.out, 'manifest.json');
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`dry-run（唯讀，零寫入）：候選 ${targets.length} 筆，manifest ${file}`);
    for (const t of targets) {
      console.log(`  ${t.order_id}  ${t.vehicle_code}  ${t.status}  ${t.operating_day}  ${new Date(t.planned_start).toISOString()}`);
    }
    for (const [table, c] of Object.entries(children)) {
      const blocking = BLOCKING_TABLES.some((b) => b.table === table);
      console.log(`  ${table}：${c.count} 筆${blocking ? (c.count ? '（有引用：apply 會中止）' : '（有引用就中止，不刪）') : '（依精確 order_id 刪除）'}`);
    }
    for (const [table, n] of Object.entries(preserved)) console.log(`  ${table}：${n} 筆（保留，不刪）`);
    console.log(`  本批狀態分布：${JSON.stringify(stats.batch)}；全部訂單 ${stats.allOrders}`);
  } finally {
    await client.end();
  }
}

function loadManifest(file) {
  if (!file) throw new Error('需要 --manifest');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.kind !== 'replay-batch-cleanup') throw new Error('不是本工具的 manifest');
  return manifest;
}

async function apply(opts) {
  const manifest = loadManifest(opts.manifest);
  if (!opts.backup || !opts['backup-sha256']) throw new Error('apply 需要 --backup <檔案> 與 --backup-sha256');
  const actual = fileSha256(opts.backup);
  if (actual !== opts['backup-sha256']) throw new Error(`備份檔雜湊不符：${actual}`);
  const { criteria, targets } = manifest;
  const ids = targets.map((t) => t.order_id);
  const { client, target } = await connect(opts.database);
  if (!opts.database && (target.database !== manifest.db.database || target.port !== manifest.db.port)) {
    throw new Error(`manifest 是 ${manifest.db.database}:${manifest.db.port} 的，現在連的是 ${target.database}:${target.port}`);
  }
  const result = { startedAt: new Date().toISOString(), db: target, deleted: {}, alreadyGone: [], status: null };
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE cleanup_targets (order_id varchar PRIMARY KEY) ON COMMIT DROP');
    await client.query('INSERT INTO cleanup_targets SELECT unnest($1::varchar[])', [ids]);
    const before = await batchStats(client, criteria);
    const { rows: locked } = await client.query(
      `SELECT o.order_id, o.status, o.payload->>'source' AS source, o.payload->>'operating_day' AS operating_day, to_jsonb(o) AS row
       FROM operation_orders o JOIN cleanup_targets t ON t.order_id = o.order_id
       ORDER BY o.order_id FOR UPDATE OF o`,
    );
    const byId = new Map(locked.map((r) => [r.order_id, r]));
    for (const t of targets) {
      const row = byId.get(t.order_id);
      if (!row) {
        result.alreadyGone.push(t.order_id);
        continue;
      }
      const ok = row.status === t.status && row.source === criteria.source && row.operating_day === criteria.day
        && left(row.order_id, criteria.prefix) && criteria.statuses.includes(row.status)
        && sha256(JSON.stringify(row.row)) === t.row_sha256;
      if (!ok) throw new Error(`${t.order_id} 與 manifest 不符（狀態 ${row.status}），中止、不刪任何資料`);
    }
    const present = targets.map((t) => t.order_id).filter((id) => byId.has(id));
    if (present.length === 0) {
      await client.query('ROLLBACK');
      result.status = 'already-clean';
      console.log(`manifest 的 ${targets.length} 筆都已不在：已清理過，沒有任何變更`);
      return finish(opts, result);
    }
    // 依賴：只能是 manifest 記下的那些；有新增或有阻擋表引用就中止
    for (const { table, column } of BLOCKING_TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = ANY($1)`, [present]);
      if (rows[0].n > 0) throw new Error(`${table} 仍引用 ${rows[0].n} 筆目標訂單（人工排程），中止`);
    }
    for (const { table, column } of CHILD_TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = ANY($1)`, [present]);
      const expected = (manifest.children[table]?.rows ?? []).filter((r) => present.includes(r[column])).length;
      if (rows[0].n !== expected) throw new Error(`${table} 依賴筆數 ${rows[0].n} 與 manifest 的 ${expected} 不同，中止`);
    }
    for (const { table, column } of CHILD_TABLES) {
      const { rows } = await client.query(
        `DELETE FROM ${table} c USING cleanup_targets t WHERE c.${column} = t.order_id AND c.${column} = ANY($1) RETURNING c.${column}`,
        [present],
      );
      result.deleted[table] = rows.length;
    }
    const { rows: gone } = await client.query(
      `DELETE FROM operation_orders o USING cleanup_targets t
       WHERE o.order_id = t.order_id
         AND left(o.order_id, length($1)) = $1
         AND o.payload->>'source' = $2
         AND o.payload->>'operating_day' = $3
         AND o.status = ANY($4)
       RETURNING o.order_id`,
      [criteria.prefix, criteria.source, criteria.day, criteria.statuses],
    );
    result.deleted.operation_orders = gone.length;
    const goneIds = gone.map((r) => r.order_id).sort();
    if (JSON.stringify(goneIds) !== JSON.stringify([...present].sort())) throw new Error('刪除的訂單與鎖定的目標不一致，中止');
    // 保留檢查：本批其他狀態（END）與全部其他訂單不受影響
    const after = await batchStats(client, criteria);
    for (const [status, n] of Object.entries(before.batch)) {
      if (criteria.statuses.includes(status)) continue;
      if (after.batch[status] !== n) throw new Error(`本批 ${status} 由 ${n} 變成 ${after.batch[status]}，中止`);
    }
    if (after.allOrders !== before.allOrders - gone.length) throw new Error('全部訂單數的變化與刪除筆數不符，中止');
    await client.query('COMMIT');
    result.status = 'applied';
    result.before = before;
    result.after = after;
    console.log(`已刪除：${JSON.stringify(result.deleted)}；已不在：${result.alreadyGone.length} 筆`);
    console.log(`本批狀態 前 ${JSON.stringify(before.batch)} → 後 ${JSON.stringify(after.batch)}`);
    return finish(opts, result);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    result.status = 'rolled-back';
    result.error = error.message;
    finish(opts, result);
    throw error;
  } finally {
    await client.end();
  }
}

function left(id, prefix) {
  return id.slice(0, prefix.length) === prefix;
}

function finish(opts, result) {
  result.finishedAt = new Date().toISOString();
  const dir = path.dirname(opts.manifest);
  const name = opts.database ? `apply-result.${opts.database}.json` : 'apply-result.json';
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

async function restore(opts) {
  const manifest = loadManifest(opts.manifest);
  const { client } = await connect(opts.database);
  const restored = {};
  try {
    await client.query('BEGIN');
    const ins = async (table, rows) => {
      let n = 0;
      for (const row of rows) {
        const r = await client.query(
          `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb) ON CONFLICT DO NOTHING RETURNING 1`,
          [JSON.stringify(row)],
        );
        n += r.rowCount;
      }
      restored[table] = n;
    };
    await ins('operation_orders', manifest.rows);
    for (const { table } of CHILD_TABLES) await ins(table, manifest.children[table]?.rows ?? []);
    await client.query('COMMIT');
    console.log(`還原（已存在的不覆蓋）：${JSON.stringify(restored)}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'dry-run') return dryRun(opts);
  if (opts.command === 'apply') return apply(opts);
  if (opts.command === 'restore') return restore(opts);
  throw new Error(`不認得的指令 ${opts.command}（dry-run／apply／restore）`);
}

main().catch((error) => {
  console.error(`失敗：${error.message}`);
  process.exit(1);
});
