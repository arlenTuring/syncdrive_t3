'use strict';

/**
 * 把場域方交付的地圖檔收進模擬器。
 *
 * 模擬器是外部單位，執行時不跟伺服器要圖資——它讀 data/map.json。這支程式是
 * 「收檔」的動作，跟模擬器跑起來之後的行為無關：地圖改版時人工跑一次，
 * 就像廠商收到新版圖資後更新車上那一份。
 *
 *   node scripts/import-map.js <檔案路徑或網址>
 *
 * 收進來前會先確認它像一份地圖：schemaVersion、areas、routes 都在，
 * 而且解得出站點與途經點。壞檔案早點擋下來，比車輛上線後查不到座標好查。
 */

const fs = require('fs');
const path = require('path');
const { MapSource } = require('../src/mapSource');

const TARGET = path.join(__dirname, '..', 'data', 'map.json');

async function read(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`${source} 回 ${res.status}`);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(source, 'utf-8'));
}

function check(doc) {
  const problems = [];
  if (doc?.schemaVersion !== 2) problems.push(`schemaVersion 是 ${doc?.schemaVersion}，預期 2`);
  if (!Array.isArray(doc?.areas) || doc.areas.length === 0) problems.push('沒有 areas');
  if (!Array.isArray(doc?.routes) || doc.routes.length === 0) problems.push('沒有 routes');
  if (problems.length > 0) throw new Error(`這不像一份地圖檔：${problems.join('；')}`);

  const map = new MapSource({ map: doc });
  const stationIds = new Set();
  for (const route of doc.routes) for (const id of route.stationIds ?? []) stationIds.add(id);
  const missing = [...stationIds].filter((id) => !map.point(id));
  if (missing.length > 0) {
    throw new Error(`有 ${missing.length} 個站點查不到座標：${missing.slice(0, 5).join('、')}`);
  }
  return { map, stationCount: stationIds.size };
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('用法：node scripts/import-map.js <檔案路徑或網址>');
    process.exit(1);
  }

  const raw = await read(source);
  // 有些端點會把地圖包一層
  const doc = raw?.mapDocument ?? raw;
  const { map, stationCount } = check(doc);

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, JSON.stringify(doc, null, 1));

  console.log(`已收下：${doc.displayName ?? doc.mapId}（${doc.version ?? '無版本'}）`);
  console.log(`  ${doc.areas.length} 個區塊、${doc.routes.length} 條路線、${stationCount} 個站點`);
  console.log(`  索引 ${map.size} 個點位 → ${path.relative(process.cwd(), TARGET)}`);
  console.log('\n圖資換版之後，先前畫的路線路徑可能對不上，請到「路線路徑」分頁確認。');
}

main().catch((error) => {
  console.error(`匯入失敗：${error.message}`);
  process.exit(1);
});
