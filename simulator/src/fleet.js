'use strict';

const { SimulatedVehicle } = require('./vehicle');
const { createApiClient } = require('./apiClient');
const { MapSource } = require('./mapSource');
const { TrackGraph } = require('./trackRouter');
const { buildRoutes, matchRouteForStations } = require('./routePaths');
const { collectYardSlots } = require('./mapGeometry');

/**
 * 車隊管理。網頁上的每一個按鈕最後都落到這裡。
 *
 * 上線順序是有原因的：<strong>先取圖資，再連 MQTT</strong>。反過來的話，車可能
 * 在還不知道站點座標時就收到指派，只能把訂單丟掉——而指派不會重送。
 */

const MAX_EVENTS = 300;

class Fleet {
  constructor({ credentials, log, routePaths }) {
    this.credentials = credentials;
    /** 使用者畫的路線路徑；有畫的路線，車輛照畫的走 */
    this.routePaths = routePaths;
    this.mapPayload = null;
    this.routes = [];
    this.log = log;
    this.target = null;
    this.api = null;
    this.map = null;
    this.track = null;
    this.vehicles = new Map();
    this.speedMultiplier = 1;
    this.startedAt = null;
    this.lastError = null;
  }

  get running() {
    return this.vehicles.size > 0;
  }

  /**
   * 上線。
   *
   * <code>codes</code> 沒給就用「有密碼的全部車輛」——沒有密碼的車連不上 broker，
   * 列進來只會產生一排連線失敗。
   */
  /**
   * 掛上圖資。
   *
   * 路徑編輯器與車隊用<strong>同一份</strong>圖資：兩邊各抓一次的話，使用者在
   * 編輯器上看到的方塊，和車輛實際定位用的方塊可能是不同版本。
   */
  attachMap({ mapPayload, map, track }) {
    this.mapPayload = mapPayload;
    this.map = map;
    this.track = track;
    this.refreshRoutes();
  }

  async start(target, codes) {
    if (this.running) await this.stop();

    const missing = this.credentials.missing();
    if (missing.length > 0) {
      throw new Error(`憑證不完整：${missing.join('；')}。請補進 simulator/.env`);
    }

    this.target = target;
    this.api = createApiClient(target, this.credentials);

    if (!this.map) {
      this.log('info', 'fleet', `取圖資中（${target.host}）…`);
      const mapPayload = await this.api.activeMap();
      const mapId = mapPayload?.mapId;
      // 站點別名與渡線途經點是另外兩支端點；少了它們，正線班次的站序有一半查不到
      const [operationNodes, waypoints] = await Promise.all([
        mapId ? this.api.operationNodes(mapId) : null,
        mapId ? this.api.waypoints(mapId) : null,
      ]);
      this.attachMap({
        mapPayload,
        map: new MapSource({ map: mapPayload, operationNodes, waypoints }),
        // 軌道圖：沒有人畫路徑時的退路，車輛自己沿軌找最短路
        track: new TrackGraph(mapPayload),
      });
    }
    if (this.map.size === 0) {
      throw new Error('圖資裡沒有任何帶座標的站點或設施，車輛無法定位');
    }
    this.log(
      'info',
      'fleet',
      `圖資就緒：${this.map.displayName ?? this.map.mapId}`
        + `（${this.map.size} 個點位、${this.track.size} 個軌道節點）`,
    );

    const wanted = codes?.length ? codes : [...this.credentials.vehiclePasswords.keys()];

    /*
     * 沒有訂單時車停在哪。
     *
     * 沒有位置就發不出 telemetry，圖台上那台車等於不存在——要等到它第一次接單才會
     * 憑空冒出來，跑完又消失。實測 11 台車只有 2 台在圖台上看得到，其餘 9 台從連線
     * 到現在一個封包都沒送過。
     *
     * 依車號順序分配格位，讓每次啟動的位置都一樣。格位不夠就繞回去；圖資裡 H1～M4
     * 的參照場域範圍是同一塊，停在那裡的車本來就會疊在一起。
     */
    const slots = this.mapPayload ? collectYardSlots(this.mapPayload) : [];
    const order = [...wanted].sort();
    const parking = (code) => {
      if (slots.length === 0) return null;
      const index = order.indexOf(code);
      const slot = slots[(index < 0 ? 0 : index) % slots.length];
      return { x: slot.x, y: slot.y, slot: slot.code };
    };
    if (slots.length > 0) {
      this.log('info', 'fleet', `${slots.length} 個場區格位可停放，車輛待命時回報所在格位`);
    }
    for (const code of wanted) {
      const password = this.credentials.vehiclePasswords.get(code);
      if (!password) {
        this.log('warn', 'fleet', `${code} 沒有 MQTT 密碼，略過`);
        continue;
      }
      const vehicle = new SimulatedVehicle({
        code,
        password,
        target,
        home: parking(code),
        api: this.api,
        map: this.map,
        track: this.track,
        routeFor: (stationIds) => this.routeForStations(stationIds),
        log: this.log,
        speed: () => this.speedMultiplier,
      });
      vehicle.connect();
      this.vehicles.set(code, vehicle);
    }

    if (this.vehicles.size === 0) {
      throw new Error('沒有任何車輛可以上線——請確認 simulator/.env 裡的 MQTT 密碼');
    }

    this.startedAt = Date.now();
    this.log('info', 'fleet', `${this.vehicles.size} 台車上線，等待 operation/assign`);
    return this.snapshot();
  }

  /** 重新整理路線清單（載入圖資後、或使用者存檔後呼叫） */
  refreshRoutes() {
    if (!this.mapPayload || !this.map) return [];
    this.routes = buildRoutes({
      mapPayload: this.mapPayload,
      map: this.map,
      store: this.routePaths,
    });
    return this.routes;
  }

  /** 這組站序有沒有人畫過路徑；沒有就回 null，車輛退回自動沿軌 */
  routeForStations(stationIds) {
    const route = matchRouteForStations(this.routes, stationIds);
    if (!route || !route.customised || route.samples.length < 2) return null;
    return route;
  }

  async stop() {
    // 圖資與路線保留：路徑編輯不需要車隊在線上
    for (const vehicle of this.vehicles.values()) vehicle.disconnect();
    this.vehicles.clear();
    this.startedAt = null;
    this.log('info', 'fleet', '車隊已下線');
    return this.snapshot();
  }

  setSpeed(multiplier) {
    const value = Number(multiplier);
    if (!Number.isFinite(value) || value <= 0) throw new Error('倍速必須是正數');
    this.speedMultiplier = Math.min(60, value);
    this.log('info', 'fleet', `倍速 → ${this.speedMultiplier}×`);
    return this.speedMultiplier;
  }

  vehicle(code) {
    const found = this.vehicles.get(code);
    if (!found) throw new Error(`${code} 不在線上`);
    return found;
  }

  snapshot() {
    return {
      running: this.running,
      startedAt: this.startedAt,
      speedMultiplier: this.speedMultiplier,
      target: this.target,
      routeCount: this.routes.length,
      customisedRoutes: this.routes.filter((r) => r.customised).length,
      map: this.map
        ? {
          id: this.map.mapId,
          name: this.map.displayName,
          version: this.map.version,
          points: this.map.size,
          trackNodes: this.track?.size ?? 0,
        }
        : null,
      lastError: this.lastError,
      vehicles: [...this.vehicles.values()].map((vehicle) => vehicle.snapshot()),
    };
  }
}

/** 事件記錄。網頁靠這個看到「現在發生了什麼」，不必去翻終端機。 */
class LogBus {
  constructor() {
    this.events = [];
    this.listeners = new Set();
  }

  push(level, source, message) {
    const event = { at: Date.now(), level, source, message };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* 一個壞掉的訂閱者不該讓其他訂閱者收不到 */
      }
    }
    const stamp = new Date(event.at).toLocaleTimeString('zh-TW', { hour12: false });
    console.log(`[${stamp}] ${level.padEnd(7)} ${source} ${message}`);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit = 120) {
    return this.events.slice(-limit);
  }
}

module.exports = { Fleet, LogBus };
