/**
 * 驗證即時名冊（正線班次、整備班表、車輛狀態）的有效任務選取，跑真正的 SQL 範本。
 *
 * 在一個交易裡放假訂單（舊營運日的故障與待發、今天的執行中、跨午夜的長整備、遠期待發），
 * 以「現在」為營運時間換掉 operating_* 巨集後查詢，最後 ROLLBACK，不留任何資料。
 *
 * 用法：cd frontend && npx tsx scripts/verify-live-task-sql.ts
 * 連線讀 backend/.env（本機），拒絕非 loopback 主機。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  VEHICLE_STATUS_ROW_SQL,
} from '../src/features/dashboard/constants/demoSql';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const req = createRequire(path.join(backendDir, 'package.json'));
req('dotenv').config({ path: path.join(backendDir, '.env') });
const { Client } = req('pg');

const TZ_OFFSET = 8 * 3600_000;
const dayOf = (ms: number) => new Date(ms + TZ_OFFSET).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) - TZ_OFFSET;

function render(sql: string, now: number): string {
  const day = dayOf(now);
  return sql
    .replace(/\boperating_now_ms\(\s*\)/gi, `(${now}::bigint)`)
    .replace(/\boperating_day_start_ms\(\s*\)/gi, `(${dayStart(day)}::bigint)`)
    .replace(/\boperating_day\(\s*\)/gi, `'${day}'`);
}

async function main() {
  const host = process.env.DB_HOST ?? '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`只在本機資料庫驗證，DB_HOST=${host}`);
  const c = new Client({
    host, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  await c.connect();
  let failed = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
    if (!ok) failed += 1;
  };
  const now = Date.now();
  const today = dayOf(now);
  const oldDay = dayOf(now - 11 * 86400_000);
  const V = ['PMS10', 'PMS11'];
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM operation_orders WHERE vehicle_code = ANY($1) AND status IN ('PENDING','PROCESSING','FAULTED')`, [V]);
    let seq = 0;
    const insert = async (o: {
      vehicle: string; status: string; start: number; end: number | null; day: string;
      kind: 'passenger' | 'maintenance'; updatedAgo?: number; trip: string;
    }) => {
      seq += 1;
      const id = `VERIFY-LIVE-${seq}`;
      const payload: Record<string, unknown> = {
        kind: o.kind,
        operating_day: o.day,
        ...(o.kind === 'maintenance' ? { task_type: 'charging', maintenance_task_type: 'charging' } : {}),
        stations: [
          { role: 'origin', order: 1, station_id: 's1', station_name: '甲', dwell_seconds: 0 },
          { role: 'terminal', order: 2, station_id: 's2', station_name: '乙', dwell_seconds: 40 },
        ],
        ...(o.updatedAgo != null ? { updated_at: now - o.updatedAgo } : {}),
      };
      await c.query(
        `INSERT INTO operation_orders
           (order_id, trip_code, vehicle_code, priority_level, status, payload, created_at, planned_start, planned_end, line_kind)
         VALUES ($1,$2,$3,50,$4,$5::jsonb,$6,$7,$8,$9)`,
        [id, o.trip, o.vehicle, o.status, JSON.stringify(payload), now, now + o.start, o.end == null ? null : now + o.end,
          o.kind === 'maintenance' ? 'MAINTENANCE' : 'MAINLINE'],
      );
      return id;
    };
    const run = async (sql: string) => (await c.query(render(sql, now))).rows as Array<Record<string, unknown>>;

    // PMS10：舊營運日（重播）留下的故障與待發 + 今天執行中 + 遠期待發
    await insert({ vehicle: 'PMS10', status: 'FAULTED', start: -11 * 86400_000, end: -11 * 86400_000 + 300_000, day: oldDay, kind: 'passenger', trip: 'OLD-F' });
    await insert({ vehicle: 'PMS10', status: 'PENDING', start: -11 * 86400_000 + 600_000, end: -11 * 86400_000 + 900_000, day: oldDay, kind: 'passenger', trip: 'OLD-P' });
    await insert({ vehicle: 'PMS10', status: 'FAULTED', start: -300_000, end: 30_000, day: today, kind: 'passenger', trip: 'TODAY-F' });
    await insert({ vehicle: 'PMS10', status: 'PROCESSING', start: -60_000, end: 240_000, day: today, kind: 'passenger', updatedAgo: 2_000, trip: 'TODAY-RUN' });
    await insert({ vehicle: 'PMS10', status: 'PENDING', start: 5 * 3600_000, end: 5 * 3600_000 + 300_000, day: today, kind: 'passenger', trip: 'FAR-P' });
    // PMS11：昨天開始、跨午夜還在做的長整備 + 今天真的故障的正線 + 遠期整備待發
    await insert({ vehicle: 'PMS11', status: 'PROCESSING', start: -10 * 3600_000, end: 2 * 3600_000, day: dayOf(now - 86400_000), kind: 'maintenance', updatedAgo: 3_000, trip: 'LONG-M' });
    await insert({ vehicle: 'PMS11', status: 'PENDING', start: 6 * 3600_000, end: 7 * 3600_000, day: today, kind: 'maintenance', trip: 'FAR-M' });

    const main = await run(MAINLINE_SHIFTS_SQL);
    const pms10 = main.filter((r) => r.vehicle_code === 'PMS10');
    check('正線：舊營運日故障／待發不出現', !main.some((r) => String(r.trip_code).startsWith('OLD-')), main.map((r) => r.trip_code).join(','));
    check('正線：同一台車執行中優先於今天稍早的故障', pms10.length === 1 && pms10[0].trip_code === 'TODAY-RUN', pms10.map((r) => r.trip_code).join(','));
    check('正線：兩小時外的待發不進名冊', !main.some((r) => r.trip_code === 'FAR-P'));

    const maint = await run(MAINTENANCE_SHIFTS_SQL);
    check('整備：跨午夜仍在做的長整備保留', maint.some((r) => r.trip_code === 'LONG-M'), maint.map((r) => r.trip_code).join(','));
    check('整備：遠期待發不列', !maint.some((r) => r.trip_code === 'FAR-M'));
    check('整備：一台車只一張', maint.filter((r) => r.vehicle_code === 'PMS11').length === 1);

    const veh = await run(VEHICLE_STATUS_ROW_SQL);
    const v10 = veh.find((r) => r.vehicle_code === 'PMS10');
    const v11 = veh.find((r) => r.vehicle_code === 'PMS11');
    check('車輛卡：PMS10 取執行中那張', v10?.trip_code === 'TODAY-RUN', String(v10?.trip_code));
    check('車輛卡：PMS11 取跨午夜整備', v11?.trip_code === 'LONG-M', String(v11?.trip_code));

    // 真故障仍顯示：PMS10 只剩今天故障
    await c.query(`DELETE FROM operation_orders WHERE order_id LIKE 'VERIFY-LIVE-%' AND trip_code IN ('TODAY-RUN')`);
    const main2 = await run(MAINLINE_SHIFTS_SQL);
    const f = main2.find((r) => r.vehicle_code === 'PMS10');
    check('正線：沒有執行中時，今天真的故障仍顯示', f?.trip_code === 'TODAY-F' && f?.status_label === '故障', `${f?.trip_code}/${f?.status_label}`);
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
  if (failed) {
    console.error(`\n${failed} 項不符`);
    process.exit(1);
  }
  console.log('\n全部符合（交易已 ROLLBACK，沒有留下資料）');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
