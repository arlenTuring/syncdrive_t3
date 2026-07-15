#!/usr/bin/env node
/**
 * 截取總控大屏各 Canvas 模組截圖，供 document/模組指引/數據監控模組.html 使用。
 *
 * 用法（需 frontend + backend 已啟動）：
 *   node scripts/capture-dashboard-module-screenshots.mjs
 *   UI=http://127.0.0.1:4173 node scripts/capture-dashboard-module-screenshots.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const { chromium } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'frontend/node_modules/playwright/index.mjs')).href
);
const OUT = path.join(REPO_ROOT, 'document/模組指引/images');
const API = process.env.API ?? 'http://127.0.0.1:3000';
const UI = process.env.UI ?? 'http://localhost:5173';

/** label → 輸出檔名 */
const MODULES = [
  { label: '__overview__', file: '00-overview.png' },
  { label: '班次中心', file: '03-shift-center.png' },
  { label: '正線班次', file: '04-mainline-shifts.png' },
  { label: '整備班表', file: '05-maintenance-shifts.png' },
  { label: '運能趨勢', file: '06-capacity-trend.png' },
  { label: '整備分佈', file: '07-maintenance-distribution.png' },
  { label: '車輛分佈', file: '08-vehicle-distribution.png' },
  { label: '即時圖台', file: '09-live-map.png' },
  { label: '車輛狀態', file: '10-vehicle-status.png' },
];

/** 總控大屏設計解析度（demoPlane.ts PLANE_W × PLANE_H） */
const PLANE_W = 3840;
const PLANE_H = 1080;
/** Retina 倍率：元素 screenshot 為 CSS 像素 × DPR，文字較銳利 */
const DEVICE_SCALE = 2;

fs.mkdirSync(OUT, { recursive: true });

async function navigateToDashboard(page) {
  await page.goto(`${UI}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /儀表板編輯器/i }).click();
  await page.waitForSelector('text=儀表板管理', { timeout: 30_000 });
  const planeCard = page.getByText(/SyncDrive 總控大屏|總控大屏/).first();
  await planeCard.waitFor({ state: 'visible', timeout: 15_000 });
  await planeCard.click();
  await page.waitForSelector('[data-dashboard-canvas="事件中心"]', { timeout: 45_000 });
  await page.waitForTimeout(2500);
}

async function tryStartSimulation(page) {
  const stopBtn = page.getByRole('button', { name: '停止模擬' });
  if (await stopBtn.isVisible().catch(() => false)) return;
  const startBtn = page.getByRole('button', { name: '開始模擬' });
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForSelector('text=停止模擬', { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return;
  }
  try {
    await fetch(`${API}/syncdrive-api/demo/simulation/start`, { method: 'POST' });
    await page.waitForTimeout(3000);
  } catch { /* optional */ }
}

async function main() {
  const ping = await fetch(UI).catch(() => null);
  if (!ping?.ok) {
    console.error(`前端無回應：${UI}（請先 npm run dev 或 npm run preview）`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: PLANE_W, height: PLANE_H },
    deviceScaleFactor: DEVICE_SCALE,
  });

  try {
    await navigateToDashboard(page);
    await tryStartSimulation(page);
    await page.waitForTimeout(5000);

    for (const mod of MODULES) {
      const outPath = path.join(OUT, mod.file);
      if (mod.label === '__overview__') {
        await page.locator('[data-dashboard-plane="workspace"]').screenshot({ path: outPath });
        console.log(`✓ ${mod.file}（全屏概覽）`);
        continue;
      }

      const el = page.locator(`[data-dashboard-canvas="${mod.label}"]`).first();
      await el.waitFor({ state: 'visible', timeout: 10_000 });
      await el.screenshot({ path: outPath });
      console.log(`✓ ${mod.file} ← ${mod.label}`);
    }

    const unionPath = path.join(OUT, '01-event-block.png');
    const clip = await page.evaluate(() => {
      const labels = ['事件中心', '事件輪播'];
      const rects = labels
        .map((l) => document.querySelector(`[data-dashboard-canvas="${l}"]`)?.getBoundingClientRect())
        .filter(Boolean);
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return {
        x: Math.max(0, Math.floor(left) - 4),
        y: Math.max(0, Math.floor(top) - 4),
        width: Math.ceil(right - left) + 8,
        height: Math.ceil(bottom - top) + 8,
      };
    });
    if (clip) {
      await page.screenshot({ path: unionPath, clip });
      console.log('✓ 01-event-block.png ← 事件中心+事件輪播');
    }
  } finally {
    await browser.close();
  }

  console.log(`\n輸出目錄：${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
