#!/usr/bin/env node
/** 儀表板健康檢查 + Playwright 截圖 → ../../.dev/verify/（驗收回報後須 npm run verify:dashboard:clean） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.dev/verify');
const API = 'http://127.0.0.1:3000';
const UI = 'http://localhost:5173';

if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

const report = { at: new Date().toISOString(), checks: [], screenshots: [], consoleErrors: [] };

function pass(name, detail) {
  report.checks.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail) {
  report.checks.push({ name, ok: false, detail });
  console.error(`✗ ${name}: ${detail}`);
}

async function postQuery(query) {
  const res = await fetch(`${API}/syncdrive-api/datasource/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 20 }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

function extractSql(src, exportName) {
  const re = new RegExp(`export const ${exportName} = \`([\\s\\S]*?)\`\\.trim\\(\\)`);
  const m = src.match(re);
  return m?.[1]?.replace(/\$\{DAY_MS\}/g,
    `(EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000)::bigint`) ?? null;
}

async function runSqlChecks() {
  const ping = await fetch(`${API}/syncdrive-api/datasource/ping`);
  if (!ping.ok) { fail('backend_ping', `HTTP ${ping.status}`); return; }
  pass('backend_ping', `${(await ping.json()).latencyMs}ms`);

  const fracTest = await postQuery(`
    SELECT FLOOR(17.4::numeric)::int AS eta_floor,
      (jsonb_build_object('current_leg', jsonb_build_object('eta_seconds', 17.4))->'current_leg'->>'eta_seconds')::numeric AS eta_numeric
  `);
  if (fracTest.ok) pass('fractional_eta_cast', JSON.stringify(fracTest.body.rows?.[0]));
  else fail('fractional_eta_cast', fracTest.body.message ?? String(fracTest.status));

  const demoSql = fs.readFileSync(path.join(ROOT, 'frontend/src/features/dashboard/constants/demoSql.ts'), 'utf8');
  for (const name of ['MAINLINE_SHIFTS_SQL', 'CAPACITY_TREND_SUMMARY_SQL', 'MAINTENANCE_SHIFTS_SQL']) {
    const sql = extractSql(demoSql, name);
    if (!sql) { fail(name, 'extract failed'); continue; }
    const res = await postQuery(sql);
    if (res.ok) pass(name, `${res.body.rows?.length ?? res.body.rowCount ?? 0} rows`);
    else fail(name, res.body.message ?? `HTTP ${res.status}`);
  }
}

async function navigateToDashboard(page) {
  await page.goto(`${UI}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /儀表板編輯器/i }).click();
  await page.waitForSelector('text=儀表板管理', { timeout: 30_000 });
  const planeCard = page.getByText(/SyncDrive 總控大屏|總控大屏/).first();
  await planeCard.waitFor({ state: 'visible', timeout: 15_000 });
  await planeCard.click();
  await page.waitForSelector('text=事件中心', { timeout: 45_000 });
  await page.waitForTimeout(3000);
}

async function ensureSimulationRunning(page) {
  const stopBtn = page.getByRole('button', { name: '停止模擬' });
  if (await stopBtn.isVisible().catch(() => false)) {
    pass('simulation_ui', '已在運行');
    return true;
  }
  const startBtn = page.getByRole('button', { name: '開始模擬' });
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForSelector('text=停止模擬', { timeout: 25_000 });
    pass('simulation_ui', '已從 UI 啟動');
    return true;
  }
  try {
    const res = await fetch(`${API}/syncdrive-api/demo/simulation/start`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.running) {
      pass('simulation_ui', `API 啟動 pid=${body.pid ?? '?'}`);
      await page.waitForTimeout(2000);
      return true;
    }
  } catch { /* fall through */ }
  fail('simulation_ui', '無法啟動模擬');
  return false;
}

async function setSimSpeed(multiplier) {
  await fetch(`${API}/syncdrive-api/demo/simulation/transport`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speedMultiplier: multiplier }),
  });
}

async function captureScreenshots() {
  const uiPing = await fetch(UI).catch(() => null);
  if (!uiPing?.ok) { fail('frontend_ping', 'localhost:5173 無回應'); return; }
  pass('frontend_ping', '200');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    await navigateToDashboard(page);
    pass('navigate_dashboard', '總控大屏已開啟');

    const p1 = path.join(OUT, '01-dashboard-load.png');
    await page.screenshot({ path: p1, fullPage: false });
    report.screenshots.push(p1);
    pass('screenshot_load', path.basename(p1));

    if (await ensureSimulationRunning(page)) {
      await setSimSpeed(8);
      await page.waitForTimeout(10_000);
      const p8 = path.join(OUT, '02-dashboard-sim-8x.png');
      await page.screenshot({ path: p8, fullPage: false });
      report.screenshots.push(p8);
      pass('screenshot_sim_8x', path.basename(p8));
    }

    const ds400 = consoleErrors.filter((e) => /400|datasource\/query|invalid input syntax/i.test(e));
    if (ds400.length === 0) pass('console_no_sql_400', 'OK');
    else fail('console_no_sql_400', ds400.slice(0, 2).join(' | '));
    report.consoleErrors = consoleErrors.slice(0, 15);
  } catch (e) {
    fail('browser_capture', String(e));
    try {
      const errShot = path.join(OUT, '00-error-state.png');
      await page.screenshot({ path: errShot });
      report.screenshots.push(errShot);
    } catch { /* ignore */ }
  } finally {
    await browser.close();
  }
}

await runSqlChecks();
await captureScreenshots();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n報告: ${path.join(OUT, 'report.json')}`);
console.log(`截圖: ${report.screenshots.join(', ')}`);
process.exit(report.checks.some((c) => !c.ok) ? 1 : 0);
