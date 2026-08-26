'use strict';

const { SimulatedVehicle } = require('./vehicle');
const { createApiClient } = require('./apiClient');
const { MapSource } = require('./mapSource');
const { TrackGraph } = require('./trackRouter');

/**
 * 車隊管理。網頁上的每一個按鈕最後都落到這裡。
 *
 * 上線順序是有原因的：<strong>先取圖資，再連 MQTT</strong>。反過來的話，車可能
 * 在還不知道站點座標時就收到指派，只能把訂單丟掉——而指派不會重送。
 */

const MAX_EVENTS = 300;

class Fleet {
  constructor({ credentials, log }) {
    this.credentials = credentials;
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
  async start(target, codes) {
    if (this.running) await this.stop();

    const missing = this.credentials.missing();
    if (missing.length > 0) {
      throw new Error(`憑證不完整：${missing.join('；')}。請補進 simulator/.env`);
    }

    this.target = target;
    this.api = createApiClient(target, this.credentials);

    this.log('info', 'fleet', `取圖資中（${target.host}）…`);
    const mapPayload = await this.api.activeMap();
    const mapId = mapPayload?.mapId;
    // 站點別名與渡線途經點是另外兩支端點；少了它們，正線班次的站序有一半查不到
    const [operationNodes, waypoints] = await Promise.all([
      mapId ? this.api.operationNodes(mapId) : null,
      mapId ? this.api.waypoints(mapId) : null,
    ]);
    this.map = new MapSource({ map: mapPayload, operationNodes, waypoints });
    // 軌道圖：車輛靠它把 A→B 走成沿軌的折線，而不是切過空地的直線
    this.track = new TrackGraph(mapPayload);
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
        api: this.api,
        map: this.map,
        track: this.track,
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

  async stop() {
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
