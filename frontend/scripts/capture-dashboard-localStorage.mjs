#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? 'http://localhost:5173/';
const outPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);

const raw = await page.evaluate(() => localStorage.getItem('syncdrive_dashboard_planes'));
await browser.close();

if (!raw) {
  console.error('localStorage 無 syncdrive_dashboard_planes');
  process.exit(1);
}

const planes = JSON.parse(raw);
const demo = planes.find((p) => p.id === 'demo-plane') ?? planes[0];
writeFileSync(outPath, JSON.stringify(demo, null, 2), 'utf8');
console.log(`Wrote ${outPath} (${demo.elements?.length ?? 0} elements, v${demo.demoLayoutVersion ?? '?'})`);
