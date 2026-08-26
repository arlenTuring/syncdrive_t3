/**
 * 清掉資料庫裡的陳腐資料。
 *
 * <strong>預設只列出、不刪除。</strong>加 --apply 才會動手，而且動手之前一定會把
 * 每一筆要刪的列備份成 JSON——這支刪的東西沒有回收桶，備份是唯一的退路。
 *
 * 用法：
 *   node scripts/purge-stale-data.mjs                    列出（本機）
 *   node scripts/purge-stale-data.mjs --apply            執行（本機）
 *   node scripts/purge-stale-data.mjs --env deploy/.env  指定連線設定
 *
 * <h3>只清「確定沒有人在用」的東西</h3>
 * 每一項都附了判斷依據。看得懂為什麼可以刪，才刪得下去；判斷不了的一律留著，
 * 列在最後讓人決定——那些多半是班表草稿、時間模板這種「看起來舊但可能還要用」
 * 的東西，機器不該替人決定。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// pg 裝在 backend 底下；這支放在 scripts/，從那裡借用而不是再裝一份
const pg = createRequire(path.join(ROOT, 'backend/package.json'))('pg');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const envArg = args.indexOf('--env');
const envPath = path.resolve(ROOT, envArg >= 0 ? args[envArg + 1] : 'backend/.env');

function readEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`找不到連線設定：${file}`);
  const out = {};
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * 要清的項目。
 *
 * <code>select</code> 是備份與計數用的完整列，<code>remove</code> 是實際刪除。
 * 兩者的 WHERE 必須一致，否則備份會對不上刪掉的東西。
 */
const TARGETS = [
  {
    key: 'legacy-orders',
    label: '舊格式示範訂單',
    why:
      'line_kind 是空的＝在訂單分成正線／整備之前建立的，班次代號也是舊的 D/U 格式。'
      + '現行的圖台查詢與調度引擎都不認這一批。',
    select: "select * from operation_orders where line_kind is null",
    remove: [
      "delete from order_events where order_id in (select order_id from operation_orders where line_kind is null)",
      "delete from order_action_states where order_id in (select order_id from operation_orders where line_kind is null)",
      "delete from operation_orders where line_kind is null",
    ],
  },
  {
    key: 'unused-slots',
    label: '沒有人用的整備格位',
    why:
      'zone 不是「整備-」開頭的格位：整備分佈只查「整備-」那幾區，這些格位也沒有'
      + '任何一筆 slot_statuses。留著只會讓格位總數對不上現場。',
    select:
      "select * from facility_slots where zone not like '整備-%'",
    remove: [
      "delete from slot_statuses where slot_id in (select slot_id from facility_slots where zone not like '整備-%')",
      "delete from facility_slots where zone not like '整備-%'",
    ],
  },
  {
    key: 'order-update-logs',
    label: '訂單狀態變更的稽核紀錄',
    why:
      '車端每次回報進度都會寫一筆。一天約兩千筆，而內容只是「某訂單轉成 processing」'
      + '——訂單本身已經有狀態，這張表對排查沒有增加資訊。',
    select: "select * from operator_action_logs where action_type = 'ORDER_UPDATE'",
    remove: ["delete from operator_action_logs where action_type = 'ORDER_UPDATE'"],
  },
  {
    key: 'orphan-action-states',
    label: '孤兒站點動作',
    why: '對應的訂單已經不存在，任何查詢都 join 不到。',
    select:
      'select s.* from order_action_states s'
      + ' left join operation_orders o on o.order_id = s.order_id'
      + ' where o.order_id is null',
    remove: [
      'delete from order_action_states s'
      + ' using (select s2.action_id from order_action_states s2'
      + ' left join operation_orders o on o.order_id = s2.order_id'
      + ' where o.order_id is null) dead'
      + ' where s.action_id = dead.action_id',
    ],
  },
  {
    key: 'orphan-order-events',
    label: '孤兒訂單事件',
    why: '對應的訂單已經不存在。',
    select:
      'select e.* from order_events e'
      + ' left join operation_orders o on o.order_id = e.order_id'
      + ' where o.order_id is null',
    remove: [
      'delete from order_events e'
      + ' using (select e2.event_id from order_events e2'
      + ' left join operation_orders o on o.order_id = e2.order_id'
      + ' where o.order_id is null) dead'
      + ' where e.event_id = dead.event_id',
    ],
  },
];

/** 這些看起來舊，但要不要留是人的決定，不是機器的。 */
const REVIEW = [
  {
    label: '班表草稿',
    sql:
      "select shift_id, name, usage_status, publish_status,"
      + " to_char(to_timestamp(updated_at/1000) at time zone 'Asia/Taipei','YYYY-MM-DD') as updated"
      + ' from operation_shifts order by updated_at desc',
    note: '部署中（in_use）的那一份絕對不能刪，調度引擎讀的就是它。',
  },
  {
    label: '時間模板',
    sql:
      "select template_id, name,"
      + " to_char(to_timestamp(updated_at/1000) at time zone 'Asia/Taipei','YYYY-MM-DD') as updated"
      + ' from time_templates order by updated_at desc',
    note: 'TT-BASIC-OPS／TT-HOLIDAY-FIXED／TT-EXTREME-WEATHER 是內建範本，不是使用者草稿。',
  },
  {
    label: '整備任務',
    sql: 'select task_id, name from maintenance_tasks',
    note: '被班表引用中的不能刪。',
  },
];

const env = readEnv(envPath);
const client = new pg.Client({
  host: env.DB_HOST ?? '127.0.0.1',
  port: Number(env.DB_PORT ?? 5432),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
});

await client.connect();
console.log(`連線：${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
console.log(apply ? '模式：執行刪除\n' : '模式：只列出，不刪除（加 --apply 才會動手）\n');

const backupDir = path.join(ROOT, '.purge-backup');
if (apply) fs.mkdirSync(backupDir, { recursive: true });

let total = 0;
for (const target of TARGETS) {
  const { rows } = await client.query(target.select);
  console.log(`${target.label}：${rows.length} 筆`);
  console.log(`  依據：${target.why}`);
  if (rows.length === 0) continue;
  total += rows.length;

  if (!apply) continue;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `${stamp}-${target.key}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`  已備份 → ${path.relative(ROOT, file)}`);

  for (const sql of target.remove) {
    const res = await client.query(sql);
    console.log(`  刪除 ${res.rowCount} 筆`);
  }
}

console.log(`\n${apply ? '已刪除' : '可刪除'}合計：${total} 筆`);

console.log('\n── 以下請人決定，這支不會動 ──');
for (const item of REVIEW) {
  const { rows } = await client.query(item.sql);
  console.log(`\n${item.label}（${rows.length}）：${item.note}`);
  for (const row of rows) {
    console.log('  ', Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' | '));
  }
}

await client.end();
