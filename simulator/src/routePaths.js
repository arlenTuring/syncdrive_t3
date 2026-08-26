'use strict';

const fs = require('fs');
const path = require('path');
const {
  collectTracks,
  fieldBounds,
  tracksAlongPath,
  samplePath,
  pathLength,
} = require('./mapGeometry');

/**
 * 路線的虛擬路徑。
 *
 * <h3>為什麼需要這個</h3>
 * 訂單只給 A/B 點，車輛得自己想辦法開過去。自動沿軌道找最短路能跑，但那是機器
 * 猜的——實際要走哪一條、在哪裡轉、繞不繞，只有人知道。這一層讓人把每條路線的
 * 路徑<strong>畫下來</strong>，車輛照畫的走。
 *
 * <h3>編出來的東西</h3>
 * <pre>
 *   折線頂點  使用者拉的：站點是固定錨點，中間的是自己加的折線點
 *   經過方塊  折線壓過哪些軌道段，含各段的參照場域範圍
 *   路徑點    折線切成等距的一串座標，車輛就是照這串走
 * </pre>
 *
 * 站點<strong>不能刪也不能拖</strong>：那是班表定義的停靠順序，路徑只能決定
 * 「怎麼從這一站開到下一站」，不能改成停別的站。
 */

const SAMPLE_STEP_METERS = 5;

class RoutePathStore {
  constructor(file) {
    this.file = file;
    this.paths = new Map();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      for (const [routeId, entry] of Object.entries(raw.routes ?? {})) {
        if (Array.isArray(entry?.waypoints)) this.paths.set(routeId, entry);
      }
    } catch (error) {
      // 壞掉的檔案不該讓模擬器起不來——當成沒有存過，使用者重畫即可
      console.warn(`[route-paths] 讀取失敗，忽略既有內容：${error.message}`);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const routes = {};
    for (const [routeId, entry] of this.paths) routes[routeId] = entry;
    fs.writeFileSync(this.file, JSON.stringify({ version: 1, routes }, null, 2));
  }

  get(routeId) {
    return this.paths.get(routeId) ?? null;
  }

  set(routeId, entry) {
    this.paths.set(routeId, entry);
    this.save();
  }

  remove(routeId) {
    this.paths.delete(routeId);
    this.save();
  }

  get size() {
    return this.paths.size;
  }
}

/**
 * 路線的預設路徑：站點兩兩直線相接。
 *
 * 這是使用者開始編輯前看到的樣子——沒有任何折線，一眼就看得出哪幾段穿牆。
 */
function straightPath(stations) {
  return stations.map((station) => ({
    x: station.x,
    y: station.y,
    stationId: station.id,
  }));
}

/** 把一條路徑算成可以交付的樣子：經過的方塊、路徑點、總長 */
function describePath(waypoints, tracks) {
  const points = waypoints.map((w) => ({ x: w.x, y: w.y }));
  return {
    waypoints,
    tracks: tracksAlongPath(points, tracks),
    samples: samplePath(points, SAMPLE_STEP_METERS),
    lengthM: Math.round(pathLength(points) * 10) / 10,
  };
}

/**
 * 路線清單，含站點座標與目前的路徑。
 *
 * 站點座標查不到的路線仍然列出來，但標成不可編輯——直接消失的話，使用者會以為
 * 地圖裡沒有那條路線，而不是「那條路線的站點在圖資裡找不到」。
 */
function buildRoutes({ mapPayload, map, store }) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const tracks = collectTracks(mapPayload);
  const out = [];

  for (const route of doc?.routes ?? []) {
    const stationIds = Array.isArray(route.stationIds) ? route.stationIds : [];
    const stations = [];
    const missing = [];
    for (const id of stationIds) {
      const point = map.point(id);
      if (point) stations.push({ id, name: point.name, x: point.x, y: point.y });
      else missing.push(id);
    }

    const saved = store.get(route.routeId);
    const usable = stations.length >= 2;
    const waypoints = saved?.waypoints ?? (usable ? straightPath(stations) : []);

    out.push({
      routeId: route.routeId,
      displayName: route.displayName ?? route.routeId,
      stationIds,
      stations,
      missing,
      editable: usable,
      customised: Boolean(saved),
      ...(usable ? describePath(waypoints, tracks) : { waypoints: [], tracks: [], samples: [], lengthM: 0 }),
    });
  }

  return out;
}

/**
 * 訂單對應到哪一條路線。
 *
 * 用<strong>站序</strong>比對，不用路線名稱：名稱是給人看的、會被改，站序是班表
 * 實際排出來的內容。完全相同才算，前綴相同不算——那可能是另一條更長的路線。
 */
function matchRouteForStations(routes, stationIds) {
  if (!Array.isArray(stationIds) || stationIds.length < 2) return null;
  const key = stationIds.join('>');
  return routes.find((route) => route.stationIds.join('>') === key) ?? null;
}

module.exports = {
  RoutePathStore,
  buildRoutes,
  describePath,
  straightPath,
  matchRouteForStations,
  fieldBounds,
  collectTracks,
  SAMPLE_STEP_METERS,
};
