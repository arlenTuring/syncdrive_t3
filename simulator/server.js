'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Fleet, LogBus } = require('./src/fleet');
const { load: loadCredentials } = require('./src/credentials');
const { resolveTarget, PRESETS } = require('./src/targets');
const { createApiClient } = require('./src/apiClient');

/**
 * 本地模擬器：控制面 ＋ 網頁。
 *
 * <h3>為什麼需要一個本地服務，不能只有網頁</h3>
 * 瀏覽器連不了原生 MQTT（只有 WebSocket），而 broker 開的是 1883 的 TCP。而且
 * 把 API 金鑰與 11 組車輛密碼放進網頁，等於把憑證送給任何打得開那一頁的人。
 * 所以憑證與所有對外連線都留在這個 Node 程序裡，網頁只下指令、看狀態。
 *
 * <pre>
 *   瀏覽器 ──HTTP──▶ 這支程序 ──MQTT 1883──▶ 伺服器（GCP 或本地）
 *                          └──HTTP 3100 x-api-key──▶
 *                          └──HTTP 80  Basic Auth──▶
 * </pre>
 */

const ROOT = __dirname;
const PORT = Number(process.env.PORT ?? 4300);

const logBus = new LogBus();
const credentials = loadCredentials(ROOT);
const fleet = new Fleet({
  credentials,
  log: (level, source, message) => logBus.push(level, source, message),
});

let currentTarget = resolveTarget({ id: process.env.SIM_TARGET ?? 'gcp' });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`請求內容不是合法 JSON：${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  // 只從 public/ 出檔，並且解析後必須仍在 public/ 底下
  const filePath = path.join(ROOT, 'public', urlPath);
  const publicDir = path.join(ROOT, 'public');
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

function state() {
  return {
    target: currentTarget,
    presets: Object.values(PRESETS),
    credentials: credentials.summary(),
    missing: credentials.missing(),
    fleet: fleet.snapshot(),
  };
}

/** 三條通道各打一次，回報通不通。連不上時這一頁要能指出是哪一條。 */
async function probe(target) {
  const api = createApiClient(target, credentials);
  const results = [];

  const attempt = async (name, channel, run) => {
    const startedAt = Date.now();
    try {
      const detail = await run();
      results.push({ name, channel, ok: true, ms: Date.now() - startedAt, detail });
    } catch (error) {
      results.push({ name, channel, ok: false, ms: Date.now() - startedAt, detail: error.message });
    }
  };

  await attempt('對外 API：班表', 'external', async () => {
    const trips = await api.timetableTrips();
    return `${trips?.trip_count ?? 0} 班`;
  });
  await attempt('對外 API：即時 ETA', 'external', async () => {
    const eta = await api.etaByVehicle();
    const count = Array.isArray(eta?.vehicles) ? eta.vehicles.length : 0;
    return `${count} 台車`;
  });
  await attempt('內部 API：圖資', 'internal', async () => {
    const map = await api.activeMap();
    return map?.displayName ?? map?.mapId ?? '已取得';
  });
  await attempt('內部 API：調度引擎', 'internal', async () => {
    const status = await api.dispatchStatus();
    return `${status?.enabled ? '已啟用' : '已停用'}，今日 ${status?.today_trip_count ?? 0} 張`;
  });

  return results;
}

const routes = {
  'GET /api/state': async (_req, res) => sendJson(res, 200, state()),

  'POST /api/target': async (req, res) => {
    if (fleet.running) throw new Error('車隊在線上時不能切換目標，請先停止');
    currentTarget = resolveTarget(await readBody(req));
    logBus.push('info', 'target', `目標 → ${currentTarget.label}（${currentTarget.host}）`);
    sendJson(res, 200, state());
  },

  'POST /api/probe': async (_req, res) => {
    sendJson(res, 200, { target: currentTarget, results: await probe(currentTarget) });
  },

  'POST /api/fleet/start': async (req, res) => {
    const body = await readBody(req);
    sendJson(res, 200, await fleet.start(currentTarget, body.codes));
  },

  'POST /api/fleet/stop': async (_req, res) => sendJson(res, 200, await fleet.stop()),

  'POST /api/fleet/speed': async (req, res) => {
    const body = await readBody(req);
    sendJson(res, 200, { speedMultiplier: fleet.setSpeed(body.multiplier) });
  },

  'POST /api/vehicle/fault': async (req, res) => {
    const { code, kind } = await readBody(req);
    const vehicle = fleet.vehicle(code);
    if (kind === 'clear') {
      vehicle.clearFault();
    } else if (kind === 'obstacle') {
      vehicle.raiseFault('OBSTACLE_DETECTED', 'WARNING', '偵測到障礙物，減速觀察');
    } else {
      vehicle.raiseFault('PATH_BLOCKED', 'CRITICAL', '模擬車端緊急停止，路徑受阻');
    }
    sendJson(res, 200, vehicle.snapshot());
  },

  'POST /api/dispatch/enable': async (req, res) => {
    const { enabled } = await readBody(req);
    const api = createApiClient(currentTarget, credentials);
    const result = await api.setDispatchEnabled(enabled !== false);
    logBus.push('info', 'dispatch', `伺服器端調度引擎 → ${result?.enabled ? '啟用' : '停用'}`);
    sendJson(res, 200, result);
  },

  'GET /api/dispatch/status': async (_req, res) => {
    const api = createApiClient(currentTarget, credentials);
    sendJson(res, 200, await api.dispatchStatus());
  },
};

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    for (const event of logBus.recent()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const unsubscribe = logBus.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.on('close', unsubscribe);
    return;
  }

  const handler = routes[`${req.method} ${url}`];
  if (!handler) {
    if (req.method === 'GET') serveStatic(req, res);
    else sendJson(res, 404, { error: `找不到 ${req.method} ${url}` });
    return;
  }

  handler(req, res).catch((error) => {
    logBus.push('error', 'api', error.message);
    sendJson(res, 400, { error: error.message });
  });
});

server.listen(PORT, () => {
  console.log(`SyncDrive T3 本地模擬器 → http://127.0.0.1:${PORT}`);
  console.log(`目前目標：${currentTarget.label}（${currentTarget.host}）`);
  const missing = credentials.missing();
  if (missing.length > 0) {
    console.log('尚缺憑證，請複製 .env.example 為 .env 後填入：');
    for (const item of missing) console.log(`  - ${item}`);
  }
});

process.on('SIGINT', () => {
  void fleet.stop().finally(() => process.exit(0));
});
