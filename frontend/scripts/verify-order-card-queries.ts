/**
 * 用隔離資料驗收「訂單 → 卡片／正線營運數」的分類（不動真實資料）。
 *
 * 做法：同一條連線裡建 TEMP 表（operation_orders、vehicles、vehicle_monitor_demo），
 * PostgreSQL 先找暫存表，所以查詢讀到的只有這裡塞的測試列；連線結束暫存表就消失，
 * 不鎖、不改正式資料表。
 *
 * 查詢本身用「從資料庫讀出的版面裡實際保存的 SQL」，經 upgradeSystemQueries 升級後執行
 * （跟前端載入版面時同一套升級）；另外也跑一次 demoSql.ts 的常數，兩邊結果要一樣。
 *
 * 用法（frontend 目錄）：npx tsx scripts/verify-order-card-queries.ts
 * 連線設定讀 backend/.env。
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as demoSql from '../src/features/dashboard/constants/demoSql.ts';
import { SYSTEM_QUERY_FAMILIES } from '../src/features/dashboard/constants/systemQueryFamilies.ts';
import { classifySql, upgradeSystemQueries } from '../src/features/dashboard/utils/systemQueries.ts';
import { collectAllChildArrays } from '../src/features/dashboard/template/childArrayVariants.ts';
import type { DashboardPlane } from '../src/features/dashboard/types.ts';

const backendDir = resolve(import.meta.dirname, '../../backend');
const require = createRequire(resolve(backendDir, 'package.json'));
require('dotenv').config({ path: resolve(backendDir, '.env'), quiet: true });
const { Client } = require('pg');

const FAMILIES = ['mainline-shifts', 'maintenance-shifts', 'mainline-fleet', 'vehicle-status'] as const;

function savedSqlByFamily(plane: DashboardPlane): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const push = (sql: string | undefined) => {
    const verdict = classifySql(sql);
    if (verdict.kind === 'current' && sql) out.set(verdict.family.id, [...(out.get(verdict.family.id) ?? []), sql]);
  };
  for (const el of plane.elements) {
    push(el.sqlQuery);
    for (const source of el.genericGroup?.sources ?? []) push(source.sqlQuery);
    for (const child of collectAllChildArrays(el).flat()) push((child as { sqlQuery?: string }).sqlQuery);
  }
  return out;
}

const now = Date.now();
const MIN = 60_000;
type Row = { id: string; vehicle: string; line: string | null; status: string; start: number; end: number; payload: Record<string, unknown>; maint?: [string, string, string, string] };
const rows: Row[] = [
  { id: 'SIM-T-pax', vehicle: 'ZZSIM1', line: 'MAINLINE', status: 'PROCESSING', start: now - 2 * MIN, end: now + 3 * MIN,
    payload: { source: 'plan_replay', kind: 'passenger', task_type: 'passenger', card_label: '上行', updated_at: now } },
  { id: 'SIM-T-move', vehicle: 'ZZSIM2', line: 'TRANSITION', status: 'PROCESSING', start: now - MIN, end: now + 2 * MIN,
    payload: { source: 'plan_replay', kind: 'movement', task_type: 'dispatch', card_label: '出廠', updated_at: now } },
  { id: 'SIM-T-charge', vehicle: 'ZZSIM3', line: 'MAINTENANCE', status: 'PROCESSING', start: now - 10 * MIN, end: now + 20 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'charging', maintenance_task_type: 'charging', yard_slot_id: 'E1', updated_at: now },
    maint: ['充電', '#052e16', '#4ade80', 'E1'] },
  { id: 'SIM-T-service', vehicle: 'ZZSIM4', line: 'MAINTENANCE', status: 'PROCESSING', start: now - 60 * MIN, end: now + 300 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'servicing', maintenance_task_type: 'servicing', yard_slot_id: 'M3', updated_at: now },
    maint: ['保養', '#422006', '#FD9A00', 'M3'] },
  { id: 'SIM-T-standby', vehicle: 'ZZSIM5', line: 'TRANSITION', status: 'PROCESSING', start: now - 5 * MIN, end: now + 60 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'standby', maintenance_task_type: 'standby', yard_slot_id: 'D3', card_label: '待命', updated_at: now } },
  // 舊版模擬器單：line_kind=TEST，只能靠 kind＋整備子類型換算
  { id: 'SIM-T-legacy-service', vehicle: 'ZZSIM6', line: 'TEST', status: 'PROCESSING', start: now - 30 * MIN, end: now + 600 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', maintenance_task_type: 'servicing', yard_slot_id: 'M4', card_label: '模擬整日重播', updated_at: now } },
  { id: 'SIM-T-legacy-unknown', vehicle: 'ZZSIM7', line: 'TEST', status: 'PROCESSING', start: now - 30 * MIN, end: now + 60 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', updated_at: now } },
  // 人工測試單：維持 TEST，不算正線營運
  { id: 'TEST-ZZ99-1', vehicle: 'ZZSIM9', line: 'TEST', status: 'PROCESSING', start: now - MIN, end: now + 5 * MIN,
    payload: { source: 'manual_test', kind: 'passenger', updated_at: now } },
  // 中心端取消、車端回報 FAULTED 結案的單：不是故障，不列；同一台車正在執行的單照常顯示
  { id: 'SIM-T-cancelled', vehicle: 'ZZSIMB', line: 'TRANSITION', status: 'FAULTED', start: now - 10 * MIN, end: now + 120 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'standby', cancel_requested_at: now - 5 * MIN, updated_at: now } },
  { id: 'SIM-T-after-cancel', vehicle: 'ZZSIMB', line: 'TRANSITION', status: 'PROCESSING', start: now - MIN, end: now + 60 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'standby', updated_at: now } },
  // 計畫結束已過、仍在執行的長保養：車端剛回報過 → 照樣看得到；十分鐘沒回報 → 視為殘留不列
  { id: 'SIM-T-overrun-live', vehicle: 'ZZSIM8', line: 'MAINTENANCE', status: 'PROCESSING', start: now - 300 * MIN, end: now - 5 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'inspection', updated_at: now - MIN }, maint: ['行檢', '#1e1b4b', '#a5b4fc', 'P1'] },
  { id: 'SIM-T-overrun-stale', vehicle: 'ZZSIMA', line: 'MAINTENANCE', status: 'PROCESSING', start: now - 300 * MIN, end: now - 30 * MIN,
    payload: { source: 'plan_replay', kind: 'maintenance', task_type: 'inspection', updated_at: now - 30 * MIN }, maint: ['行檢', '#1e1b4b', '#a5b4fc', 'P2'] },
];

const client = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
await client.connect();
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
};
try {
  // 1. 版面裡實際保存的 SQL：升級（只換系統原文）
  const planes = (await client.query('SELECT plane_id, name, elements FROM dashboard_planes')).rows;
  const savedByFamily = new Map<string, string[]>();
  for (const row of planes) {
    const plane = { id: row.plane_id, name: row.name, elements: row.elements } as unknown as DashboardPlane;
    const upgraded = upgradeSystemQueries(plane);
    console.log(`版面「${row.name}」：${upgraded.changes.length} 處系統查詢可升級，${upgraded.unconfirmed.length} 處像系統查詢但對不上（不動）`);
    for (const change of upgraded.changes) console.log(`  ↑ ${change.family}｜${change.location}`);
    for (const item of upgraded.unconfirmed) console.log(`  ? ${item.family}｜${item.location}`);
    for (const [family, list] of savedSqlByFamily(upgraded.plane)) savedByFamily.set(family, [...(savedByFamily.get(family) ?? []), ...list]);
  }

  // 2. 隔離資料
  await client.query(`CREATE TEMP TABLE operation_orders (LIKE public.operation_orders INCLUDING DEFAULTS)`);
  await client.query(`CREATE TEMP TABLE vehicles (LIKE public.vehicles INCLUDING DEFAULTS)`);
  await client.query(`CREATE TEMP TABLE vehicle_monitor_demo (LIKE public.vehicle_monitor_demo INCLUDING DEFAULTS)`);
  const vehicleCols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='vehicles' AND table_schema='public' AND is_nullable='NO' AND column_default IS NULL`)).rows.map((r: { column_name: string }) => r.column_name);
  for (const code of [...new Set(rows.map((r) => r.vehicle))]) {
    const values: Record<string, unknown> = { vehicle_code: code, display_name: code, is_active: true };
    for (const col of vehicleCols) if (!(col in values)) values[col] = col.endsWith('_at') ? now : col === 'id' ? code : code;
    const cols = Object.keys(values);
    await client.query(`INSERT INTO vehicles (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  }
  for (const r of rows) {
    await client.query(
      `INSERT INTO operation_orders (order_id, trip_code, vehicle_code, priority_level, status, payload, created_at, line_kind,
         planned_start, planned_end, maint_type_label, maint_type_bg, maint_type_color, maint_station)
       VALUES ($1,$1,$2,50,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [r.id, r.vehicle, r.status, r.payload, now, r.line, r.start, r.end, ...(r.maint ?? [null, null, null, null])],
    );
  }

  const run = async (family: string, sql: string) => (await client.query(sql)).rows as Array<Record<string, unknown>>;
  const constants = Object.fromEntries(SYSTEM_QUERY_FAMILIES.map((f) => [f.id, String((demoSql as Record<string, unknown>)[f.constantName])]));
  for (const family of FAMILIES) {
    console.log(`[${family}] 版面裡實際保存 ${(savedByFamily.get(family) ?? []).length} 份（升級後）`);
  }

  const mainline = await run('mainline-shifts', constants['mainline-shifts']);
  const maint = await run('maintenance-shifts', constants['maintenance-shifts']);
  const fleet = await run('mainline-fleet', constants['mainline-fleet']);
  const status = await run('vehicle-status', constants['vehicle-status'].replace("AND v.vehicle_code LIKE 'PMS%'", "AND v.vehicle_code LIKE 'ZZSIM%'"));
  const keys = (list: Array<Record<string, unknown>>) => list.map((r) => String(r.shift_key)).sort();
  console.log('\n正線／過渡卡：', mainline.map((r) => `${r.shift_key}(${r.business_kind},${r.direction_label})`).join('、'));
  console.log('整備卡：', maint.map((r) => `${r.shift_key}(${r.maint_type_label})`).join('、'));
  console.log('正線營運：', fleet[0]?.mainline_fleet_line);
  console.log('車輛徽章：', status.map((r) => `${r.vehicle_code}:${r.line_kind ?? '-'}/${r.badge_label ?? '-'}`).join('、'));

  check('載客 → 正線卡', keys(mainline).includes('SIM-T-pax') && mainline.find((r) => r.shift_key === 'SIM-T-pax')?.business_kind === 'MAINLINE');
  check('過渡與待命列的樣板欄位是 mainline（正線卡樣板），不會落到整備卡樣板',
    ['SIM-T-move', 'SIM-T-standby'].every((k) => mainline.find((r) => r.shift_key === k)?.line_kind === 'mainline'));
  check('出廠移動 → 過渡卡，標籤「過渡」', mainline.find((r) => r.shift_key === 'SIM-T-move')?.direction_label === '過渡');
  check('待命 → 過渡卡（不是整備）', mainline.find((r) => r.shift_key === 'SIM-T-standby')?.business_kind === 'TRANSITION' && !keys(maint).includes('SIM-T-standby'));
  check('充電 → 整備卡「充電」', maint.find((r) => r.shift_key === 'SIM-T-charge')?.maint_type_label === '充電');
  check('長時間保養執行中 → 整備卡', keys(maint).includes('SIM-T-service'));
  check('舊版 TEST 重播保養 → 整備卡', keys(maint).includes('SIM-T-legacy-service'));
  check('舊版 TEST 子類型不明 → 不進任何卡', !keys(maint).includes('SIM-T-legacy-unknown') && !keys(mainline).includes('SIM-T-legacy-unknown'));
  check('超過計畫結束但車端剛回報 → 仍可見', keys(maint).includes('SIM-T-overrun-live'));
  check('超過計畫結束且十分鐘沒回報 → 不列', !keys(maint).includes('SIM-T-overrun-stale'));
  check('中心端取消的 FAULTED 單不列；同車正在執行的單照常顯示',
    !keys(mainline).includes('SIM-T-cancelled') && keys(mainline).includes('SIM-T-after-cancel'));
  const overlap = keys(mainline).filter((k) => keys(maint).includes(k));
  check('同一張單不會同時出現在正線與整備', overlap.length === 0, overlap.join('、'));
  check('正線營運只算載客正線的車（1 台）', String(fleet[0]?.mainline_fleet_line ?? '').startsWith('正線營運 1 /'), String(fleet[0]?.mainline_fleet_line));
  check('沒有「模擬」卡片標籤（新單）', !mainline.some((r) => r.shift_key !== 'SIM-T-legacy-service' && String(r.direction_label).includes('模擬')));
  check('車輛徽章：保養車是整備、待命車不是正線',
    status.find((r) => r.vehicle_code === 'ZZSIM4')?.line_kind === 'MAINTENANCE'
      && status.find((r) => r.vehicle_code === 'ZZSIM5')?.line_kind === 'TRANSITION');

  // 版面實際保存的 SQL 跑出來要跟常數一樣
  for (const family of FAMILIES) {
    for (const [i, sql] of (savedByFamily.get(family) ?? []).entries()) {
      const finalSql = family === 'vehicle-status' ? sql.replace("AND v.vehicle_code LIKE 'PMS%'", "AND v.vehicle_code LIKE 'ZZSIM%'") : sql;
      const a = JSON.stringify(await run(family, finalSql));
      const expected = { 'mainline-shifts': mainline, 'maintenance-shifts': maint, 'mainline-fleet': fleet, 'vehicle-status': status }[family];
      check(`版面保存的 ${family} 第 ${i + 1} 份與常數結果相同`, a === JSON.stringify(expected));
    }
  }

  // 3. 清空訂單：卡片全部消失
  await client.query('DELETE FROM operation_orders');
  const emptyMain = await run('m', constants['mainline-shifts']);
  const emptyMaint = await run('m', constants['maintenance-shifts']);
  const emptyFleet = await run('m', constants['mainline-fleet']);
  check('訂單清空 → 正線卡 0、整備卡 0', emptyMain.length === 0 && emptyMaint.length === 0);
  check('訂單清空 → 正線營運 0', String(emptyFleet[0]?.mainline_fleet_line ?? '').startsWith('正線營運 0 /'), String(emptyFleet[0]?.mainline_fleet_line));
} finally {
  await client.end();
}
console.log(failed ? `\n${failed} 項不符` : '\n全部符合');
process.exit(failed ? 1 : 0);
