#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profile = resolve(homedir(), 'Library/Application Support/Cursor/Partitions/cursor-browser');
const url = process.argv[2] ?? 'http://localhost:5173/';
const outPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: ['--no-sandbox'],
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
const raw = await page.evaluate(() => localStorage.getItem('syncdrive_dashboard_planes'));
await context.close();

if (!raw) {
  console.error('無 syncdrive_dashboard_planes（請在 Cursor 內建瀏覽器開過儀表板）');
  process.exit(1);
}

const planes = JSON.parse(raw);
const demo = planes.find((p) => p.id === 'demo-plane') ?? planes[0];
writeFileSync(outPath, JSON.stringify(demo, null, 2), 'utf8');
console.log(`Wrote ${outPath} — ${demo.elements?.length ?? 0} elements, v${demo.demoLayoutVersion ?? '?'}`);
