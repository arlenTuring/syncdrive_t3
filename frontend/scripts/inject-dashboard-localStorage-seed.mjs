#!/usr/bin/env node
/**
 * 將 dashboard-localStorage-seed.json 寫入執行中前端的 localStorage（需 dev server）。
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname, '../public/dashboard-templates/dashboard-localStorage-seed.json');
const url = process.argv[2] ?? 'http://localhost:5173/';

if (!existsSync(seedPath)) {
  console.error(`找不到 ${seedPath}，請先執行 restore-dashboard-editor-backup.mjs`);
  process.exit(1);
}

const storage = JSON.parse(readFileSync(seedPath, 'utf8'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate((data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      continue;
    }
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}, storage);
await browser.close();

console.log(`已注入 localStorage（${Object.keys(storage).length} 個 key）→ ${url}`);
console.log('請在瀏覽器重新整理儀表板頁面。');
