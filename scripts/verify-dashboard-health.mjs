#!/usr/bin/env node
/**
 * 儀表板健康檢查：SQL 查詢、模擬 API、Playwright 截圖
 * 輸出：.dev/verify/dashboard-*.png + .dev/verify/report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.dev/verify');
const API = 'http://127.0.0.1:3000';
const UI = 'http://localhost:5173';

fs.mkdirSync(OUT, { recursive: true });

const report = {
  at: new Date().toISOString(),
  checks: [],
  screenshots: [],
};

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
  return { status: res.status, body };
}

async function runSqlChecks() {
  const ping = await fetch(`${API}/syncdrive-api/datasource/ping`);
  if (!ping.ok) {
    fail('backend_ping', `HTTP ${ping.status}`);
    return;
  }
  pass('backend_ping', `${(await ping.json()).latencyMs}ms`);

  // 注入小數 eta 到一筆 PROCESSING 訂單（重現 fractional eta_seconds 問題）
  const seedRes = await postQuery(`
    UPDATE operation_orders
    SET payload = jsonb_set(
      COALESCE(payload, '{}'::jsonb),
      '{current_leg,eta_seconds}',
      '17.4'::jsonb,
      true
    )
    WHERE line_kind = 'MAINLINE' AND status = 'PROCESSING'
    LIMIT 1
    RETURNING order_id
  `.replace('LIMIT 1', '').trim() + `
    AND order_id IN (
      SELECT order_id FROM operation_orders
      WHERE line_kind = 'MAINLINE' AND status = 'PROCESSING'
      LIMIT 1
    )
    RETURNING order_id
  `);

  // 若 UPDATE 被 datasource 阻擋（只允許 SELECT），改直接 SELECT 測試 expression
  const fracTest = await postQuery(`
    SELECT
      FLOOR(17.4::numeric)::int AS eta_floor,
      COALESCE((jsonb_build_object('current_leg', jsonb_build_object('eta_seconds', 17.4))->'current_leg'->>'eta_seconds')::numeric, 0) AS eta_numeric
  `);
  if (fracTest.status === 200 && fracTest.body.rows?.length) {
    pass('fractional_eta_cast', JSON.stringify(fracTest.body.rows[0]));
  } else {
    fail('fractional_eta_cast', `HTTP ${fracTest.status} ${JSON.stringify(fracTest.body).slice(0, 200)}`);
  }

  const { readFileSync } = await import('node:fs');
  const demoSqlPath = path.join(ROOT, 'frontend/src/features/dashboard/constants/demoSql.ts');
  const src = readFileSync(demoSqlPath, 'utf8');
  const mainlineMatch = src.match(/export const MAINLINE_SHIFTS_SQL = `([\s\S]*?)`\.trim\(\)/);
  if (!mainlineMatch) {
    fail('mainline_sql_extract', '無法從 demoSql.ts 擷取 MAINLINE_SHIFTS_SQL');
    return;
  }
  let mainlineSql = mainlineMatch[1].replace(/\$\{DAY_MS\}/g,
    `(EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000)::bigint`);
  const mainlineRes = await postQuery(mainlineSql);
  if (mainlineRes.status === 200) {
    pass('mainline_shifts_sql', `${mainlineRes.body.rowCount ?? mainlineRes.body.rows?.length ?? 0} rows`);
  } else {
    fail('mainline_shifts_sql', `HTTP ${mainlineRes.status} ${mainlineRes.body.message ?? JSON.stringify(mainlineRes.body).slice(0, 300)}`);
  }

  const capMatch = src.match(/export const CAPACITY_TREND_SUMMARY_SQL = `([\s\S]*?)`\.trim\(\)/);
  if (capMatch) {
    const capRes = await postQuery(capMatch[1]);
    if (capRes.status === 200) {
      pass('capacity_trend_summary_sql', `${capRes.body.rows?.length ?? 0} rows`);
    } else {
      fail('capacity_trend_summary_sql', `HTTP ${capRes.status} ${capRes.body.message ?? ''}`);
    }
  }
}

async function startSimulation() {
  try {
    const res = await fetch(`${API}/syncdrive-api/demo/simulation/start`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.running) {
      pass('simulation_start', `pid=${body.pid ?? '?'}`);
      await fetch(`${API}/syncdrive-api/demo/simulation/transport`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speedMultiplier: 12 }),
      });
      return true;
    }
    report.checks.push({ name: 'simulation_start', ok: false, detail: JSON.stringify(body).slice(0, 200) });
    console.warn('⚠ simulation start skipped:', body.message ?? res.status);
    return false;
  } catch (e) {
    fail('simulation_start', String(e));
    return false;
  }
}

async function captureScreenshots(simRunning) {
  const uiPing = await fetch(UI).catch(() => null);
  if (!uiPing?.ok) {
    fail('frontend_ping', '5173 無回應');
    return;
  }
  pass('frontend_ping', '200');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    await page.goto(`${UI}/`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(3000);
    const p1 = path.join(OUT, '01-dashboard-idle.png');
    await page.screenshot({ path: p1, fullPage: false });
    report.screenshots.push(p1);
    pass('screenshot_idle', path.basename(p1));

    if (simRunning) {
      await page.waitForTimeout(8000);
      const p2 = path.join(OUT, '02-dashboard-sim-12x.png');
      await page.screenshot({ path: p2, fullPage: false });
      report.screenshots.push(p2);
      pass('screenshot_sim', path.basename(p2));
    }

    const ds400 = consoleErrors.filter((e) => e.includes('400') || e.includes('datasource/query'));
    const mqttLogs = consoleErrors.filter((e) => e.includes('MapMqttLive'));
    if (ds400.length === 0) {
      pass('console_no_datasource_400', '無 datasource/query 400');
    } else {
      fail('console_no_datasource_400', ds400.slice(0, 3).join(' | '));
    }
    report.consoleErrors = consoleErrors.slice(0, 20);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('==> SyncDrive 儀表板健康檢查\n');
  await runSqlChecks();
  const simRunning = await startSimulation();
  await captureScreenshots(simRunning);

  const outJson = path.join(OUT, 'report.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(`\n報告：${outJson}`);
  console.log(`截圖：${report.screenshots.join(', ') || '(無)'}`);

  const failed = report.checks.filter((c) => !c.ok);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
