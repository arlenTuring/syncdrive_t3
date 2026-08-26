/**
 * 把已部署圖台版面裡的 SQL 更新成 demoSql.ts 的現行版本。
 *
 * <strong>為什麼需要這一支。</strong>版面把每個元件的 sqlQuery 當成內容存進
 * dashboard_planes，所以那是<strong>建立當下的快照</strong>——之後改
 * demoSql.ts 不會回頭更新已經存在的版面。查詢改了卻沒推上去的話，畫面會安靜地
 * 沿用舊查詢：不報錯，只是永遠查不到新資料（2026-08-26 實測：班次代號格式換掉
 * 之後，正線相關元件顯示 0 筆長達數週）。
 *
 * 用法：
 *   node scripts/refresh-plane-sql.mjs <base> <user:pass> <planeId> [--apply]
 *
 * 不加 --apply 只列出會更新哪幾支，不寫入。版面配置（位置、大小、顏色）一律
 * 原樣寫回，這支只換 sqlQuery 字串。
 *
 * 例：
 *   node scripts/refresh-plane-sql.mjs http://34.80.84.224 syncdrive:xxxx demo-plane --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_SQL = path.join(ROOT, 'frontend/src/features/dashboard/constants/demoSql.ts');

/**
 * 版面上的 SQL 怎麼對回原始碼的哪一支。
 *
 * 用<strong>查詢裡的特徵字串</strong>比對，不是用元件 id——元件 id 每次重建版面
 * 都會換，特徵字串則跟著查詢本身走。
 */
const MATCHERS = [
  ['MAINLINE_SHIFTS_SQL', 'active_orders'],
  ['VEHICLE_STATUS_ROW_SQL', 'vehicle_monitor_demo'],
  ['MAINLINE_FLEET_STATUS_SQL', 'roster_count'],
  ['VEHICLE_DISTRIBUTION_SQL', 'status_code'],
  ['MAINTENANCE_SHIFTS_SQL', 'maint_type_label'],
];

function readSourceQueries() {
  const source = fs.readFileSync(DEMO_SQL, 'utf-8');
  const out = new Map();
  for (const [name] of MATCHERS) {
    const match = source.match(
      new RegExp(`export const ${name} = \`([\\s\\S]*?)\`\\.trim\\(\\);`),
    );
    if (match) out.set(name, match[1].trim());
  }
  return out;
}

const [, , base, auth, planeId, ...flags] = process.argv;
if (!base || !auth || !planeId) {
  console.error('用法：node scripts/refresh-plane-sql.mjs <base> <user:pass> <planeId> [--apply]');
  process.exit(1);
}

const apply = flags.includes('--apply');
const headers = { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` };
const queries = readSourceQueries();

const planeRes = await fetch(`${base}/syncdrive-api/dashboard/planes/${planeId}`, { headers });
if (!planeRes.ok) {
  console.error(`讀取版面失敗：${planeRes.status}`);
  process.exit(1);
}
const plane = await planeRes.json();

const changes = [];
function walk(node) {
  if (Array.isArray(node)) return node.map(walk);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'sqlQuery' && typeof value === 'string') {
      const hit = MATCHERS.find(([, marker]) => value.includes(marker));
      const next = hit ? queries.get(hit[0]) : null;
      if (next && next !== value) {
        changes.push({ name: hit[0], from: value.length, to: next.length });
        out[key] = next;
        continue;
      }
    }
    out[key] = walk(value);
  }
  return out;
}
const elements = walk(plane.elements);

if (changes.length === 0) {
  console.log(`版面 ${planeId}：SQL 已是最新，無須更新`);
  process.exit(0);
}
console.log(`版面 ${planeId}：${changes.length} 支查詢要更新`);
for (const change of changes) {
  console.log(`  ${change.name}：${change.from} → ${change.to} 字元`);
}
if (!apply) {
  console.log('（未加 --apply，沒有寫入）');
  process.exit(0);
}

const put = await fetch(`${base}/syncdrive-api/dashboard/planes`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    {
      planeId,
      name: plane.name,
      width: plane.width,
      height: plane.height,
      viewportMode: plane.viewportMode,
      elements,
      isTemplate: plane.isTemplate,
      version: plane.version,
    },
  ]),
});
console.log(put.ok ? '已寫回' : `寫回失敗：${put.status} ${await put.text()}`);
