/**
 * 「清空訂單後儀表板仍顯示班次卡」驗收：在本機隔離環境（本機 PostgreSQL／broker）實際操作
 * 5173 畫面，逐案記錄訂單筆數、資料庫讀回的 SQL 執行結果與畫面卡片數。
 *
 * 用法（frontend 目錄；後端 :3000、vite :5173、broker :1883 都要開著）：
 *   node scripts/accept-stale-shift-cards.mjs <舊版面備份.json>
 *
 * 會建立／刪除 ACC- 開頭的測試訂單，並用「清空」API 重置 PMS05／PMS06；不要對正式環境執行。
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(resolve('../backend/package.json'));
const mqtt = require('mqtt');

const WEB = 'http://127.0.0.1:5173';
const OUT = resolve('artifacts/acceptance');
const ML_VEHICLE = 'PMS05';
const MT_VEHICLE = 'PMS06';
const MODULE_PAGE_ID = 'acceptance-stale-cards';
mkdirSync(OUT, { recursive: true });

const backupPath = process.argv[2];
if (!backupPath) throw new Error('請指定舊版面備份 JSON');

const results = [];
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 「清空」是主管功能，跟畫面上的資料管理介面送同樣的角色標頭（有設金鑰時從環境變數帶） */
const ADMIN_HEADERS = {
  'x-syncdrive-role': 'supervisor',
  ...(process.env.DATA_ADMIN_API_KEY ? { 'x-syncdrive-admin-key': process.env.DATA_ADMIN_API_KEY } : {}),
};

async function api(method, path, body) {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(path.includes('/data-admin/') ? ADMIN_HEADERS : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = async (query) => (await api('POST', '/syncdrive-api/datasource/query', { query })).rows;
const orderCount = async () => (await sql('SELECT count(*)::int AS n FROM operation_orders'))[0].n;

/** 從資料庫讀回版面，逐一執行泛用群組來源「存在資料庫裡的」SQL */
async function storedSourceRows() {
  const planes = await api('GET', '/syncdrive-api/dashboard/planes');
  const out = {};
  for (const plane of planes) {
    for (const el of plane.elements) {
      for (const source of el.genericGroup?.sources ?? []) {
        const rows = await sql(source.sqlQuery);
        out[`${el.label} › ${source.id}`] = rows.length;
      }
    }
  }
  return { version: planes[0]?.version, rows: out };
}

const cardLocator = (page) => page.locator('[data-generic-group] [data-slot-uid]');
async function cardOrigins(page) {
  return cardLocator(page).evaluateAll((nodes) => nodes.map((n) => `${n.getAttribute('data-slot-uid')}=${n.getAttribute('data-row-origin')}`));
}
async function cardTexts(page) {
  return (await cardLocator(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}
async function waitCards(page, expected, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  let n = -1;
  while (Date.now() < end) {
    n = await cardLocator(page).count();
    if (n === expected) return n;
    await sleep(250);
  }
  return n;
}
async function emptyText(page) {
  return (await page.locator('[data-generic-group] [data-group-empty]').allInnerTexts()).join(' / ');
}

async function record(id, title, page, extra = {}) {
  const shot = `${OUT}/${id}.png`;
  if (page) await page.screenshot({ path: shot });
  const entry = {
    id,
    title,
    orders: await orderCount(),
    cards: page ? await cardLocator(page).count() : null,
    empty: page ? await emptyText(page) : null,
    screenshot: page ? shot : null,
    ...extra,
  };
  results.push(entry);
  log(id, title, JSON.stringify({ ...entry, screenshot: undefined }));
  return entry;
}

function taipeiHhmm(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
  return parts.replace(':', '');
}

async function createMainlineOrder(orderId, vehicle) {
  const now = Date.now();
  return api('POST', '/syncdrive-api/order/save', {
    order_id: orderId, vehicle_code: vehicle, trip_code: `D${taipeiHhmm(now)}`, line_kind: 'MAINLINE',
    route_id: 'ROUTE-MAINLINE-DOWN', planned_start: now - 60_000, planned_end: now + 30 * 60_000,
    payload: { source: 'acceptance', kind: 'passenger' },
  });
}
async function createMaintenanceOrder(orderId, vehicle) {
  const now = Date.now();
  return api('POST', '/syncdrive-api/order/save', {
    order_id: orderId, vehicle_code: vehicle, trip_code: orderId, line_kind: 'MAINTENANCE',
    planned_start: now - 60_000, planned_end: now + 30 * 60_000, maint_type_label: '驗收整備',
    payload: { source: 'acceptance' },
  });
}
async function clearVehicles(codes) {
  const executed = await api('POST', '/syncdrive-api/data-admin/live-reset/execute', { vehicleCodes: codes });
  await api('POST', '/syncdrive-api/data-admin/live-reset/resume', { vehicleCodes: codes });
  return executed;
}

async function openModulePage(page) {
  const link = page.getByText('驗收總控大屏', { exact: true }).first();
  await page.getByText('數據監控模組', { exact: true }).first().waitFor({ timeout: 20_000 });
  if (!(await link.isVisible())) await page.getByText('數據監控模組', { exact: true }).first().click();
  await link.click();
}

/** 統計瀏覽器實際收到、含指定單號的即時訊息框數（證明舊單 MQTT 確實送到畫面） */
const wsFrames = [];
async function openRuntime(context) {
  const page = await context.newPage();
  page.on('websocket', (ws) => ws.on('framereceived', (frame) => {
    const text = typeof frame.payload === 'string' ? frame.payload : '';
    if (text.includes('operation/update')) wsFrames.push({ at: Date.now(), text });
  }));
  await page.goto(WEB);
  await openModulePage(page);
  await page.locator('[data-generic-group]').first().waitFor({ timeout: 20_000 });
  return page;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const broker = mqtt.connect('mqtt://127.0.0.1:1883');
await new Promise((ok, fail) => { broker.once('connect', ok); broker.once('error', fail); });

let publishing = null;
function startOperationMqtt(vehicle, payloadFor) {
  stopOperationMqtt();
  const send = () => broker.publish(`v1/vtms/${vehicle}/operation/update`, JSON.stringify({ ...payloadFor(), timestamp: Date.now() }));
  send();
  publishing = setInterval(send, 1000);
}
function stopOperationMqtt() {
  if (publishing) clearInterval(publishing);
  publishing = null;
}

try {
  // ── 前置：清掉這兩台車的殘留、建立模組頁 ────────────────────────────────
  await clearVehicles([ML_VEHICLE, MT_VEHICLE]);
  const planesNow = await api('GET', '/syncdrive-api/dashboard/planes');
  const planeId = planesNow[0].planeId;
  await api('PUT', '/syncdrive-api/dashboard/module-pages', {
    items: [{ id: MODULE_PAGE_ID, moduleId: 'monitor', label: '驗收總控大屏', planeId, sortOrder: 0, createdAt: Date.now() }],
  });
  const inUse = await sql("SELECT shift_id FROM operation_shifts WHERE usage_status = 'in_use'");

  // ── 8：把舊版面（整備來源還是舊班表查詢）寫回資料庫，確認問題真的重現 ────────
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const oldPlane = (Array.isArray(backup) ? backup : backup.planes)[0];
  const current = planesNow.find((p) => p.planeId === oldPlane.planeId);
  await api('PUT', `/syncdrive-api/dashboard/planes/${encodeURIComponent(oldPlane.planeId)}`, {
    planeId: oldPlane.planeId, name: oldPlane.name, width: oldPlane.width, height: oldPlane.height,
    viewportMode: oldPlane.viewportMode, elements: oldPlane.elements, expectedVersion: current.version,
  });
  const restored = await storedSourceRows();
  log('寫回舊版面後，資料庫存的 SQL 執行結果', JSON.stringify(restored));

  // ── 1：訂單 0 筆、班表使用中 → 執行畫面 0 張卡（舊版面在記憶體內遷移） ──────
  const ctxA = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  let page = await openRuntime(ctxA);
  await sleep(4000);
  await record('S1', '訂單清空但班表使用中：0 張卡（資料庫仍是舊查詢時，執行畫面遷移後查詢）', page, {
    inUseSchedules: inUse.map((r) => r.shift_id),
    storedSqlBeforeEditor: restored,
  });

  // ── 8：開編輯器載入舊版面 → 自動升級並單張存回後端，版面不變 ─────────────────
  const editor = await ctxA.newPage();
  await editor.goto(WEB);
  await editor.locator('header button').last().click();
  await editor.getByText('進階管理模式', { exact: true }).click();
  await editor.getByText('儀表介面管理', { exact: true }).waitFor({ timeout: 15_000 });
  let after = await storedSourceRows();
  for (let i = 0; i < 40 && after.version === restored.version; i += 1) {
    await sleep(500);
    after = await storedSourceRows();
  }
  const savedPlane = (await api('GET', '/syncdrive-api/dashboard/planes')).find((p) => p.planeId === oldPlane.planeId);
  const layoutDiff = [];
  const keyOf = (el) => JSON.stringify({ ...el, sqlQuery: undefined, genericGroup: el.genericGroup ? { ...el.genericGroup, sources: el.genericGroup.sources?.map((s) => ({ ...s, sqlQuery: undefined })) } : undefined });
  for (const el of oldPlane.elements) {
    const now = savedPlane.elements.find((x) => x.id === el.id);
    if (!now) layoutDiff.push(`${el.label}（${el.id}）不見了`);
    else if (keyOf(now) !== keyOf(el)) layoutDiff.push(`${el.label}（${el.id}）SQL 以外有變`);
  }
  await editor.close();
  await record('S8', '舊泛用群組載入後被升級並存回後端，版面／樣板／來源 ID 不變', null, {
    versionBefore: restored.version,
    versionAfter: after.version,
    storedSqlAfterEditor: after,
    elementsWithNonSqlChanges: layoutDiff,
  });

  // ── 9／5／3：新的有效訂單出現；沒有 MQTT 時照訂單狀態顯示 ──────────────────
  await createMainlineOrder('ACC-ML-1', ML_VEHICLE);
  await createMaintenanceOrder('ACC-MT-1', MT_VEHICLE);
  await waitCards(page, 2);
  const sqlOnlyTexts = await cardTexts(page);
  await record('S9', '新增有效訂單（正線＋整備各一）→ 顯示', page, { texts: sqlOnlyTexts });
  await record('S5', 'SQL 有效、沒有 MQTT：照訂單狀態顯示，不補假回報', page, { texts: sqlOnlyTexts, origins: await cardOrigins(page) });
  await record('S3', '從未收過 MQTT：沒有任何只靠 MQTT 長出的卡（卡數＝SQL 訂單數）', page, {
    sqlOrders: (await sql("SELECT order_id FROM operation_orders WHERE order_id LIKE 'ACC-%'")).map((r) => r.order_id),
  });

  // ── 4：MQTT 有效時更新同一張單；停止後 5 秒期限到就退回 SQL 內容 ─────────────
  const firstStation = (await sql("SELECT station_id FROM operation_route_stations WHERE route_id = 'ROUTE-MAINLINE-DOWN' ORDER BY sequence_order OFFSET 1 LIMIT 1"))[0]?.station_id;
  const tripCode = (await sql("SELECT trip_code FROM operation_orders WHERE order_id = 'ACC-ML-1'"))[0].trip_code;
  const livePayload = () => ({
    vehicle_code: ML_VEHICLE, order_id: 'ACC-ML-1', trip_code: tripCode, order_status: 'PROCESSING',
    vehicle_phase: 'TRANSITING', current_leg: { target_station_id: firstStation, eta_seconds: 3599 },
  });
  startOperationMqtt(ML_VEHICLE, livePayload);
  await sleep(4000);
  const liveTexts = await cardTexts(page);
  await record('S4a', 'MQTT 有效：同一張單的欄位被回報更新', page, { texts: liveTexts, origins: await cardOrigins(page) });
  stopOperationMqtt();
  const stoppedAt = Date.now();
  let expiredAfterMs = null;
  while (Date.now() - stoppedAt < 15_000) {
    if (!(await cardOrigins(page)).some((o) => o.endsWith('sql+mqtt'))) { expiredAfterMs = Date.now() - stoppedAt; break; }
    await sleep(200);
  }
  await record('S4', 'MQTT 停送超過期限：卡片不再套用回報（沒有新訊息也會自動失效）', page, {
    texts: await cardTexts(page),
    origins: await cardOrigins(page),
    overlayExpiredAfterMs: expiredAfterMs,
    note: '後端會把車端回報寫進訂單，所以過期後 SQL 本身也帶有進度；這裡以卡片的資料來源標記判斷 MQTT 是否仍在套用',
  });

  // ── 2：清空 SQL 訂單，車端仍持續送舊單的 MQTT → 不復活 ────────────────────
  startOperationMqtt(ML_VEHICLE, livePayload);
  await sleep(2000);
  const clear1 = await clearVehicles([ML_VEHICLE, MT_VEHICLE]);
  const clearedAt = Date.now();
  await waitCards(page, 0);
  await sleep(8000); // 舊單 MQTT 持續在送
  await record('S2', 'SQL 已刪除、MQTT 仍送舊單：卡片不復活', page, {
    resetSteps: clear1.steps?.map((s) => `${s.id}:${s.status}`),
    mqttStillPublishing: publishing !== null,
    oldOrderFramesReceivedAfterClear: wsFrames.filter((f) => f.at > clearedAt && f.text.includes('ACC-ML-1')).length,
  });
  stopOperationMqtt();

  // ── 6：清空前送出的查詢晚回來 → 不能把舊卡補回 ───────────────────────────
  await createMaintenanceOrder('ACC-MT-2', MT_VEHICLE);
  await waitCards(page, 1);
  let holdNext = false;
  let held = null;
  await page.route('**/syncdrive-api/datasource/query', async (route) => {
    const body = route.request().postData() ?? '';
    if (holdNext && body.includes("o.line_kind = 'MAINTENANCE'")) {
      holdNext = false;
      const response = await route.fetch();
      held = { route, response, body: await response.text() };
      return;
    }
    await route.continue();
  });
  holdNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  for (let i = 0; i < 40 && !held; i += 1) await sleep(250);
  const heldRows = held ? JSON.parse(held.body).rows.length : null;
  await clearVehicles([MT_VEHICLE]);
  await waitCards(page, 0);
  if (held) await held.route.fulfill({ response: held.response, body: held.body });
  await sleep(4000);
  await record('S6', '清空前送出的查詢（含舊單）在清空後才回來：不還原', page, { heldQueryRows: heldRows });
  await page.unroute('**/syncdrive-api/datasource/query');

  // ── 7：重新整理、另一個瀏覽器環境（等同換帳號，無任何本機快取） ─────────────
  await page.reload();
  await openModulePage(page);
  await page.locator('[data-generic-group]').first().waitFor({ timeout: 20_000 });
  await sleep(4000);
  await record('S7a', '重新整理後', page);
  const ctxB = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const pageB = await openRuntime(ctxB);
  await sleep(4000);
  await record('S7b', '全新瀏覽器環境（另一位使用者）', pageB, { storedSql: await storedSourceRows() });

  page = pageB;
  await record('FINAL', '最終：訂單 0 筆、卡片 0 張', page, { storedSql: await storedSourceRows() });
} finally {
  stopOperationMqtt();
  broker.end(true);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
