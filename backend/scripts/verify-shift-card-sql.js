#!/usr/bin/env node
/**
 * 驗證儀表板「主線班次卡」SQL 的挑單規則。
 *
 * 在一個交易裡塞幾張假訂單、跑真正的 MAINLINE_SHIFTS_SQL、看挑出哪一張，最後 ROLLBACK——
 * 不會留下任何資料。規則：
 *   1. 車實際在做的（PROCESSING）永遠優先，就算計畫結束時間過了、下一班的時間窗已經開始
 *   2. 逾時仍在跑：標「延誤」，並說明後續班次在等前班
 *   3. 車端半分鐘沒回報：標「資料過期」，不換成別的班次
 *   4. 十分鐘以上沒回報的執行中單是殭屍單：不列，輪到下一班
 *   5. 沒有進行中的單時，才顯示到點的 PENDING
 *
 * 用法：cd backend && node scripts/verify-shift-card-sql.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const src = fs.readFileSync(
  path.join(__dirname, '../../frontend/src/features/dashboard/constants/demoSql.ts'),
  'utf8',
);
const head = 'export const MAINLINE_SHIFTS_SQL = `';
const start = src.indexOf(head) + head.length;
const SQL = src.slice(start, src.indexOf('`', start));

const VEHICLE = 'PMS10';

async function main() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();
  let failed = 0;
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
    if (!ok) failed += 1;
  };

  try {
    await c.query('BEGIN');
    const now = Date.now();
    // 這台車真實的進行中單先清掉（交易內，最後還原）
    await c.query(
      `DELETE FROM operation_orders WHERE vehicle_code = $1 AND status IN ('PENDING','PROCESSING','FAULTED')`,
      [VEHICLE],
    );
    let seq = 0;
    const insert = async ({ status, start, end, updatedAgo = null, trip }) => {
      seq += 1;
      const id = `VERIFY-${seq}`;
      const payload = {
        kind: 'passenger',
        card_label: '營運',
        stations: [
          { role: 'origin', order: 1, station_id: 's1', station_name: '甲', dwell_seconds: 0 },
          { role: 'terminal', order: 2, station_id: 's2', station_name: '乙', dwell_seconds: 40 },
        ],
        ...(updatedAgo != null ? { updated_at: now - updatedAgo } : {}),
      };
      await c.query(
        `INSERT INTO operation_orders
           (order_id, trip_code, vehicle_code, priority_level, status, payload, created_at,
            planned_start, planned_end, line_kind)
         VALUES ($1,$2,$3,50,$4,$5::jsonb,$6,$7,$8,'MAINLINE')`,
        [id, trip, VEHICLE, status, JSON.stringify(payload), now, now + start, now + end],
      );
      return id;
    };
    const pick = async () => {
      const { rows } = await c.query(SQL);
      return rows.find((r) => r.vehicle_code === VEHICLE) ?? null;
    };
    const clear = () =>
      c.query(`DELETE FROM operation_orders WHERE order_id LIKE 'VERIFY-%'`);

    // 1+2：前班逾時 40 秒仍在跑，下一班的時間窗已經開始
    await insert({ status: 'PROCESSING', start: -240_000, end: -40_000, updatedAgo: 2_000, trip: 'TS0001' });
    await insert({ status: 'PENDING', start: -10_000, end: 170_000, trip: 'TS0002' });
    let row = await pick();
    check('前班逾時仍在跑、下一班已到點：卡片仍是前班', row?.trip_code === 'TS0001', `拿到 ${row?.trip_code}`);
    check('  狀態標「延誤」', row?.status_label === '延誤', `拿到 ${row?.status_label}`);
    check('  說明後續班次等待前班完成', /等待前班完成/.test(row?.eta_label ?? ''), row?.eta_label);
    await clear();

    // 1'：沒逾時、下一班時間窗重疊
    await insert({ status: 'PROCESSING', start: -100_000, end: 80_000, updatedAgo: 1_000, trip: 'TS0001' });
    await insert({ status: 'PENDING', start: -5_000, end: 175_000, trip: 'TS0002' });
    row = await pick();
    check('時間窗重疊時仍以實際執行中的為準', row?.trip_code === 'TS0001' && row?.status_label === '準時', `${row?.trip_code}/${row?.status_label}`);
    await clear();

    // 3：半分鐘沒回報
    await insert({ status: 'PROCESSING', start: -200_000, end: -20_000, updatedAgo: 120_000, trip: 'TS0001' });
    await insert({ status: 'PENDING', start: -10_000, end: 170_000, trip: 'TS0002' });
    row = await pick();
    check('通訊中斷（2 分鐘沒回報）：仍顯示原班，標「資料過期」', row?.trip_code === 'TS0001' && row?.status_label === '資料過期', `${row?.trip_code}/${row?.status_label}`);
    await clear();

    // 4：殭屍單
    await insert({ status: 'PROCESSING', start: -3_600_000, end: -3_400_000, updatedAgo: 1_800_000, trip: 'TS0001' });
    await insert({ status: 'PENDING', start: -10_000, end: 170_000, trip: 'TS0002' });
    row = await pick();
    check('30 分鐘沒回報的執行中單是殭屍單：不列，輪到下一班', row?.trip_code === 'TS0002', `拿到 ${row?.trip_code}`);
    await clear();

    // 5：只有 PENDING
    await insert({ status: 'PENDING', start: 60_000, end: 240_000, trip: 'TS0003' });
    await insert({ status: 'PENDING', start: -10_000, end: 170_000, trip: 'TS0002' });
    row = await pick();
    check('沒有進行中的單：顯示時間窗涵蓋現在的 PENDING', row?.trip_code === 'TS0002' && row?.status_label === '待發', `${row?.trip_code}/${row?.status_label}`);
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
