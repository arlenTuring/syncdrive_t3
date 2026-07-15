#!/usr/bin/env node
/** 清除儀表板／地圖 stale localStorage，注入最新 seed，驗證 DB 整備格 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname, '../public/dashboard-templates/dashboard-localStorage-seed.json');
const url = process.argv[2] ?? 'http://localhost:5173/';
const API = 'http://127.0.0.1:3000';

if (!existsSync(seedPath)) {
  console.error(`找不到 ${seedPath}`);
  process.exit(1);
}
const storage = JSON.parse(readFileSync(seedPath, 'utf8'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

const cleared = await page.evaluate(() => {
  const prefixes = [
    'syncdrive-map-draft-',
    'syncdrive-map-official-',
    'syncdrive_vehicle_trajectory_',
  ];
  const removed = [];
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (prefixes.some((p) => key.startsWith(p))) {
      removed.push(key);
      localStorage.removeItem(key);
    }
  }
  return removed;
});

await page.evaluate((data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}, storage);

await page.evaluate(() => localStorage.setItem('syncdrive-map-library-v1', '[]'));
await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(4000);

const mapInfo = await page.evaluate(async () => {
  const raw = localStorage.getItem('syncdrive-map-library-v1');
  const entries = raw ? JSON.parse(raw) : [];
  const main = entries.find(
    (e) => e.builtinId === 't3-main-version' || e.libraryId === 't3-main-version',
  );
  if (main?.mapDocument) {
    const parking = (main.mapDocument.areas || [])
      .flatMap((a) => a.facilities || [])
      .filter((f) => /^P[1-4]$/.test(String(f.customName || '').trim()))
      .map((f) => f.customName.trim())
      .sort();
    return { seeded: true, version: main.mapDocument.version, parking, entryCount: entries.length };
  }
  const res = await fetch('/maps/t3-main-version.json', { cache: 'no-store' });
  const json = await res.json();
  const parking = (json.areas || [])
    .flatMap((a) => a.facilities || [])
    .filter((f) => /^P[1-4]$/.test(String(f.customName || '').trim()))
    .map((f) => f.customName.trim())
    .sort();
  return { seeded: false, fetchedVersion: json.version, parking, entryCount: entries.length };
});

await browser.close();

const dbRes = await fetch(`${API}/syncdrive-api/datasource/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "SELECT slot_id, display_name FROM facility_slots WHERE zone = '整備-臨停' ORDER BY slot_id",
    limit: 10,
  }),
});
const db = await dbRes.json();

const report = {
  clearedDraftKeys: cleared.length,
  mapInfo,
  dbParkingSlots: db.rows?.map((r) => `${r.slot_id} (${r.display_name})`),
};
console.log(JSON.stringify(report, null, 2));

const ok =
  (mapInfo.parking?.length === 4 || mapInfo.fetchedVersion === 'v0.1.10') &&
  db.rows?.length === 4;
process.exit(ok ? 0 : 1);
