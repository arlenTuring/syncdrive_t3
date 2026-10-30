#!/usr/bin/env node
/**
 * 驗證班次清單（order/list）的分類條件與排序。
 *
 * 只在本 session 的 TEMP 表上做事：先複製 operation_orders 成同名 TEMP 表（遮住正式表），
 * 再塞各種舊資料型態的合成列，連線結束 TEMP 表就消失——不會改到任何正式資料。
 *
 *   1. orderBusinessKindFilterSql 的 direct／legacy 兩段，跟原本整段 CASE（orderBusinessKindSql）
 *      逐列結果相同、互不重疊：line_kind 空白／NULL／TEST／未知值／小寫 × source × kind × 子類型。
 *   2. 同一計畫時刻、同一建立時刻的單，照清單的排序一頁一頁翻，不漏不重複。
 *   3. 清單只取部分欄位＋payload 摘要（LIST_COLUMNS／LIST_PAYLOAD_SQL）：每一張單算出的列表
 *      內容（狀態、路線、時間…）跟拿完整一列算的完全相同，只有 payload 變成摘要。
 *
 * 用法：cd backend && node scripts/verify-order-list-kind-sql.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } });
const { Client } = require('pg');
const { orderBusinessKindSql, orderBusinessKindFilterSql } = require('../src/order/order-business-kind');
const { LIST_PAYLOAD_SQL, toShiftRecordListItem } = require('../src/order/order-list.util');

/** snake_case 欄位 → OperationOrder 屬性（只轉列表用得到的） */
function toEntity(row, payload) {
  return {
    id: row.order_id,
    tripCode: row.trip_code,
    routeId: row.route_id,
    vehicleCode: row.vehicle_code,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    lineKind: row.line_kind,
    delayMinutes: row.delay_minutes,
    nextStation: row.next_station,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    maintStation: row.maint_station,
    payload,
  };
}

const TABS = {
  mainline: ['MAINLINE', 'TRANSITION', 'TEST'],
  maintenance: ['MAINTENANCE'],
};
const ORDER_BY = 'o.planned_start DESC NULLS LAST, o.created_at DESC, o.order_id DESC';

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
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`);
    if (!ok) failed += 1;
  };
  try {
    await c.query('CREATE TEMP TABLE operation_orders AS SELECT * FROM public.operation_orders');
    const ns = await c.query(
      "SELECT n.nspname FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace WHERE r.oid = to_regclass('operation_orders')",
    );
    if (!/^pg_temp/.test(ns.rows[0]?.nspname ?? '')) throw new Error('TEMP 表沒有遮住正式表，停止');

    await c.query(`INSERT INTO operation_orders (order_id, trip_code, vehicle_code, status, payload, created_at, line_kind, planned_start)
      SELECT 'SYN-' || row_number() OVER (), 'SYN', 'PMS99', 'END', p, 1, lk,
             CASE WHEN row_number() OVER () % 5 = 0 THEN NULL ELSE 1700000000000 END
      FROM unnest(ARRAY[NULL, '', 'TEST', 'MAINLINE', 'TRANSITION', 'MAINTENANCE', 'FOO', 'mainline']) lk,
           unnest(ARRAY[NULL, 'plan_replay', 'traffic_e2e']) src,
           unnest(ARRAY[NULL, 'passenger', 'movement', 'maintenance', 'other']) kd,
           unnest(ARRAY[NULL, '', 'passenger', 'dispatch', 'standby', 'idle', 'charge']) tt,
           LATERAL (SELECT jsonb_strip_nulls(jsonb_build_object(
             'source', src, 'kind', kd, 'task_type', tt,
             'maintenance_task_type', CASE WHEN tt = 'charge' THEN 'charge' END)) p) x`);

    for (const [tab, kinds] of Object.entries(TABS)) {
      const f = orderBusinessKindFilterSql('o', kinds);
      const old = `COALESCE((${orderBusinessKindSql('o')}) IN (${kinds.map((k) => `'${k}'`).join(', ')}), false)`;
      const direct = `COALESCE(${f.direct ?? 'false'}, false)`;
      const legacy = `COALESCE(${f.legacy}, false)`;
      const { rows } = await c.query(`SELECT
          count(*) FILTER (WHERE ${old} IS DISTINCT FROM (${direct} OR ${legacy})) AS differ,
          count(*) FILTER (WHERE ${direct} AND ${legacy}) AS overlap,
          count(*) FILTER (WHERE ${old}) AS matched,
          count(*) FILTER (WHERE order_id LIKE 'SYN-%') AS synthetic
        FROM operation_orders o`);
      const r = rows[0];
      check(`${tab}：兩段條件與原本 CASE 逐列相同`, r.differ === '0', `不同 ${r.differ} 列（共比對含 ${r.synthetic} 筆合成舊資料）`);
      check(`${tab}：兩段互斥，分開數再相加就是精確總數`, r.overlap === '0', `重疊 ${r.overlap} 列，符合 ${r.matched} 列`);
    }

    // 部分欄位＋payload 摘要算出的列表內容，跟完整一列算的一樣（含合成舊資料）
    {
      const { rows } = await c.query(`SELECT o.*, ${LIST_PAYLOAD_SQL} AS list_payload FROM operation_orders o`);
      let mismatched = 0;
      let example = '';
      for (const row of rows) {
        const { payload: _full, ...fromFull } = toShiftRecordListItem(toEntity(row, row.payload));
        const { payload: _slim, ...fromSlim } = toShiftRecordListItem(toEntity(row, row.list_payload));
        if (JSON.stringify(fromFull) !== JSON.stringify(fromSlim)) {
          mismatched += 1;
          example ||= `${row.order_id}: ${JSON.stringify(fromFull)} ≠ ${JSON.stringify(fromSlim)}`;
        }
        const cancelled = Boolean(row.payload?.cancel_requested_at) === Boolean(row.list_payload?.cancel_requested_at);
        if (!cancelled) {
          mismatched += 1;
          example ||= `${row.order_id}: cancel_requested_at 不一致`;
        }
      }
      const full = rows.reduce((sum, row) => sum + JSON.stringify(row.payload ?? null).length, 0);
      const slim = rows.reduce((sum, row) => sum + JSON.stringify(row.list_payload ?? null).length, 0);
      check('payload 摘要算出的列表內容與完整一列相同', mismatched === 0, mismatched ? example : `${rows.length} 張單；payload 合計 ${full} → ${slim} bytes`);
    }

    // 同時刻 45 張單：每頁 20 筆翻三頁，不漏不重複
    await c.query(`INSERT INTO operation_orders (order_id, trip_code, vehicle_code, status, payload, created_at, line_kind, planned_start)
      SELECT 'TIE-' || lpad(i::text, 3, '0'), 'TIE', 'PMS98', 'PENDING', '{}'::jsonb, 4102444800000, 'MAINLINE', 4102444800000
      FROM generate_series(1, 45) i`);
    const seen = [];
    for (let page = 0; page < 3; page += 1) {
      const { rows } = await c.query(
        `SELECT o.order_id FROM operation_orders o WHERE o.trip_code = 'TIE' ORDER BY ${ORDER_BY} LIMIT 20 OFFSET ${page * 20}`,
      );
      seen.push(...rows.map((row) => row.order_id));
    }
    check('同時刻翻頁不漏不重複', seen.length === 45 && new Set(seen).size === 45, `取到 ${seen.length} 筆、不重複 ${new Set(seen).size} 筆`);
  } finally {
    await c.end();
  }
  if (failed) {
    console.error(`\n${failed} 項未通過`);
    process.exit(1);
  }
  console.log('\n全部通過（TEMP 表已隨連線結束消失，未改動正式資料）');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
