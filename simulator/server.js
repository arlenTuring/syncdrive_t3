'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Fleet, LogBus } = require('./src/fleet');
const { load: loadCredentials } = require('./src/credentials');
const { resolveTarget, PRESETS } = require('./src/targets');
const { createApiClient } = require('./src/apiClient');
const {
  RoutePathStore,
  buildRoutes,
  describePath,
  straightPath,
  collectTracks,
} = require('./src/routePaths');
const {
  buildCanvas,
  collectCrossovers,
  fieldToPixel,
  pixelToField,
} = require('./src/mapGeometry');
const { MapSource } = require('./src/mapSource');
const { TrackGraph } = require('./src/trackRouter');

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
const routePaths = new RoutePathStore(path.join(ROOT, 'data/route-paths.json'));
const fleet = new Fleet({
  credentials,
  routePaths,
  log: (level, source, message) => logBus.push(level, source, message),
});

/**
 * 路徑編輯器用的圖資快取。
 *
 * 編輯路徑不必先讓車隊上線——那是兩件事。所以這裡自己抓一份，抓過就留著；
 * 車隊上線時會用同一份，不會重抓。
 */
let mapCache = null;

async function loadMapForEditor() {
  if (mapCache) return mapCache;
  const api = createApiClient(currentTarget, credentials);
  const mapPayload = await api.activeMap();
  const mapId = mapPayload?.mapId;
  const [operationNodes, waypoints] = await Promise.all([
    mapId ? api.operationNodes(mapId) : null,
    mapId ? api.waypoints(mapId) : null,
  ]);
  const map = new MapSource({ map: mapPayload, operationNodes, waypoints });
  const tracks = collectTracks(mapPayload);
  const canvas = buildCanvas(mapPayload);
  const crossovers = collectCrossovers(mapPayload);
  mapCache = { mapPayload, map, tracks, canvas, crossovers };
  // 車隊用同一份：編輯器上看到的方塊，就是車輛定位用的方塊
  fleet.attachMap({ mapPayload, map, track: new TrackGraph(mapPayload) });
  return mapCache;
}

function routesSnapshot(cache) {
  return buildRoutes({
    mapPayload: cache.mapPayload,
    map: cache.map,
    store: routePaths,
    canvas: cache.canvas,
  });
}

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
  const requested = req.url.split('?')[0];
  // 目錄要拿 index.html，否則 /paths/ 會讀到一個目錄然後回 404
  const urlPath = requested.endsWith('/') ? `${requested}index.html` : requested;
  // 只從 public/ 出檔，並且解析後必須仍在 public/ 底下
  const filePath = path.join(ROOT, 'public', urlPath);
  const publicDir = path.join(ROOT, 'public');
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      // 路徑編輯器要先建置。少了這一句，使用者只會看到一片空白的 404，
      // 完全看不出是「還沒建置」而不是「壞了」。
      if (urlPath.startsWith('/paths/')) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          '<meta charset="utf-8"><body style="font:14px system-ui;background:#0f1115;color:#e6e9ef;padding:32px">'
          + '<h2>路徑編輯器尚未建置</h2>'
          + '<p>它是獨立的一份網頁（重用 syncdrive_t3 前端的圖台元件），要先建置：</p>'
          + '<pre style="background:#1e222b;padding:12px;border-radius:8px">cd simulator &amp;&amp; npm install &amp;&amp; npm run build:web</pre>'
          + '<p>建置完重新整理即可，不必重開伺服器。</p></body>',
        );
        return;
      }
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      // 這是開發用的本機工具，改完就要看到。快取只會讓人拿到舊的 JS 然後
      // 對著一個早就修好的問題除錯。
      'Cache-Control': 'no-store',
    });
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
    // 換一台伺服器就是換一份圖資，快取必須丟掉
    mapCache = null;
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

  // ── 路線路徑編輯 ──────────────────────────────────────────

  'GET /api/map/geometry': async (_req, res) => {
    const cache = await loadMapForEditor();
    sendJson(res, 200, {
      mapId: cache.mapPayload?.mapId ?? null,
      displayName: cache.mapPayload?.displayName ?? null,
      ...cache.canvas,
      crossovers: cache.crossovers,
    });
  },

  /**
   * 原封不動的地圖檔。
   *
   * 路徑編輯器用的是 syncdrive_t3 那邊的圖台元件（MapAreaCanvas），它吃的是
   * parseMapFileJson 解出來的東西——所以這裡不能先整理過再送，送出去的必須是
   * 地圖檔本身。整理過的版本另外由 /api/map/geometry 提供，那是給換算用的。
   */
  'GET /api/map/document': async (_req, res) => {
    const cache = await loadMapForEditor();
    sendJson(res, 200, cache.mapPayload?.mapDocument ?? cache.mapPayload ?? {});
  },

  'GET /api/routes': async (_req, res) => {
    const cache = await loadMapForEditor();
    sendJson(res, 200, { routes: routesSnapshot(cache) });
  },

  'PUT /api/routes': async (req, res) => {
    const { routeId, waypoints } = await readBody(req);
    const cache = await loadMapForEditor();
    const routes = routesSnapshot(cache);
    const route = routes.find((item) => item.routeId === routeId);
    if (!route) throw new Error(`找不到路線 ${routeId}`);
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      throw new Error('路徑至少要有兩個點');
    }

    // 站點是班表定義的停靠順序，路徑只能決定「怎麼從這一站開到下一站」。
    // 用送進來的站點欄位回頭核對，順序或數量不符就整批拒絕——存進去之後才發現
    // 對不上，車輛會照著錯的站序跑。
    const sentStations = waypoints
      .filter((point) => point?.stationId)
      .map((point) => String(point.stationId));
    if (sentStations.join('>') !== route.stationIds.join('>')) {
      throw new Error(
        `站點順序不符：路線是 ${route.stationIds.join(' → ')}，`
        + `送來的是 ${sentStations.join(' → ') || '（沒有站點）'}`,
      );
    }

    /**
     * 編輯器送來的是<strong>圖面像素</strong>——它畫在圖台上，量得到的只有像素。
     * 換成場域公尺在這裡做，不在瀏覽器：換算靠的是每個方塊自己的參照場域範圍，
     * 兩邊各寫一份遲早會對不起來，而對不起來的後果是車輛開到別的地方去。
     */
    const cleaned = waypoints.map((point, index) => {
      const px = Number(point.px);
      const py = Number(point.py);
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        throw new Error(`第 ${index + 1} 個路徑點沒有座標`);
      }
      /*
       * 站點的場域座標是已知的，不要從像素反推。
       *
       * 像素往返會有零點幾公尺的誤差（實測 750 變成 749.02），而站點是班表定的停靠
       * 位置——那個數字必須原封不動。折線點才需要反推，因為它只存在於使用者畫的線上。
       */
      if (point.stationId) {
        const known = route.stations.find((s) => s.id === String(point.stationId));
        if (known) {
          return { x: known.x, y: known.y, px, py, stationId: String(point.stationId) };
        }
      }

      const field = pixelToField(cache.canvas.facilities, px, py, cache.crossovers);
      if (!field) {
        throw new Error(
          `第 ${index + 1} 個路徑點不在任何方塊或橫渡線上，沒有對應的場域座標——`
          + '請把它拖回軌道、站台或橫渡線上',
        );
      }
      return {
        x: field.x,
        y: field.y,
        px,
        py,
        ...(point.stationId ? { stationId: String(point.stationId) } : {}),
      };
    });

    routePaths.set(routeId, { waypoints: cleaned, updatedAt: Date.now() });
    fleet.refreshRoutes();

    const described = describePath(cleaned, cache.tracks);
    logBus.push(
      'info',
      'route',
      `${route.displayName} 路徑已存：${cleaned.length} 個折線頂點、`
        + `經過 ${described.tracks.length} 個方塊、${described.samples.length} 個路徑點`,
    );
    sendJson(res, 200, { routeId, ...described, customised: true });
  },

  'POST /api/routes/reset': async (req, res) => {
    const { routeId } = await readBody(req);
    const cache = await loadMapForEditor();
    const routes = routesSnapshot(cache);
    const route = routes.find((item) => item.routeId === routeId);
    if (!route) throw new Error(`找不到路線 ${routeId}`);
    routePaths.remove(routeId);
    fleet.refreshRoutes();
    logBus.push('info', 'route', `${route.displayName} 路徑已還原成站點直線`);
    const described = describePath(straightPath(route.stations), cache.tracks);
    sendJson(res, 200, { routeId, ...described, customised: false });
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
