'use strict';

const mqtt = require('mqtt');
const { mqttUrl } = require('./targets');

/**
 * 一台模擬的自駕車。
 *
 * 它的世界觀只有訂單：收到 assign、去拉任務內容、照著 A→B 開、回報進度。
 * <strong>它不知道班表長什麼樣，也不需要知道。</strong>這條界線是刻意的——換成
 * 真車時車端介面完全不變。
 *
 * <pre>
 *   MQTT  operation/assign  ──▶  GET  /order/queryById
 *                                 │
 *                                 ▼
 *                           PUT /order/updateOrderProgress?status=processing
 *                                 │
 *                    ┌────────────┴────────────┐
 *                    │  沿站序前進，1 Hz 回報   │
 *                    │  telemetry / operation  │
 *                    └────────────┬────────────┘
 *                                 ▼
 *                           PUT …?status=end
 * </pre>
 */

/**
 * 位置更新的節拍。
 *
 * 圖台是靠兩筆 telemetry 之間插值把車畫順的，所以「一秒一筆」在 1 倍速下夠用
 * （8 m/s，一次跳 8 公尺），但倍速一開就不夠了：10 倍速下車在圖面上每秒跑 80 公尺，
 * 一秒一筆等於每次瞬移 80 公尺，看起來就是一頓一頓的。
 *
 * 所以回報頻率跟著倍速走——倍速多少就多發幾筆，讓<strong>每一筆之間的位移維持差不多</strong>。
 * 上限 10 Hz：再密下去頻寬與圖台的處理都划不來，而 10 Hz 已經是每次約 8 公尺。
 */
const TELEMETRY_BASE_INTERVAL_MS = 1000;
const TELEMETRY_MIN_INTERVAL_MS = 100;
/** 動作節拍固定 100 ms：位置本來就是照時間算的，算得細一點不花什麼成本 */
const TICK_INTERVAL_MS = 100;
const HEALTH_INTERVAL_MS = 5000;

/** 沒有實測位移可用時的預設車速（起步第一筆） */
const CRUISE_SPEED_MPS = 8;

/**
 * 訂單種類 → 協議上的 line_kind。
 *
 * <strong>只有載客班次進正線班表</strong>，空車移動與整備一律歸整備班次——
 * 出廠、入廠、讓站是把車在場區之間挪位置，車還沒開始營運。
 */
const LINE_KIND_BY_ORDER_KIND = {
  passenger: 'MAINLINE',
  movement: 'MAINTENANCE',
  maintenance: 'MAINTENANCE',
};

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 折線上依比例取點，順便給出當下的航向 */
function walkPolyline(points, ratio) {
  if (points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y, heading: 0, legIndex: 0 };

  const legs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const length = distance(points[i], points[i + 1]);
    legs.push(length);
    total += length;
  }
  if (total <= 0) {
    return { x: points[0].x, y: points[0].y, heading: 0, legIndex: 0 };
  }

  let remaining = Math.max(0, Math.min(1, ratio)) * total;
  for (let i = 0; i < legs.length; i += 1) {
    if (remaining > legs[i] && i < legs.length - 1) {
      remaining -= legs[i];
      continue;
    }
    const from = points[i];
    const to = points[i + 1];
    const t = legs[i] > 0 ? Math.min(1, remaining / legs[i]) : 1;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      heading: Math.atan2(to.y - from.y, to.x - from.x),
      legIndex: i,
    };
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, heading: 0, legIndex: legs.length - 1 };
}

class SimulatedVehicle {
  constructor({ code, password, target, api, map, track, routeFor, log, speed, home }) {
    this.code = code;
    this.password = password;
    this.target = target;
    this.api = api;
    this.map = map;
    this.track = track;
    this.routeFor = routeFor;
    this.log = log;
    this.speedRef = speed;

    this.client = null;
    this.connected = false;
    this.lastError = null;

    /** 目前執行中的訂單 */
    this.order = null;
    /** 故障閂鎖。閂上之後停在原地，直到清除。 */
    this.faulted = false;
    this.battery = 80 + Math.random() * 15;

    /*
     * 待命時停在場區格位。
     *
     * 一定要有初始位置：publishTelemetry 沒有位置就直接 return，那台車在圖台上
     * 等於不存在——第一次接單才憑空出現，跑完又消失。真實的車停著也一直在回報。
     */
    this.home = home ?? null;
    this.position = home ? { x: home.x, y: home.y } : null;
    this.heading = 0;
    this.timers = [];
    this.stats = { assigns: 0, completed: 0, published: 0 };
  }

  get speed() {
    return this.speedRef();
  }

  connect() {
    if (this.client) return;
    const url = mqttUrl(this.target, this.code, this.password);
    this.client = mqtt.connect(url, {
      clientId: `sim-${this.code}-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });

    this.client.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      this.client.subscribe(`v1/vtms/${this.code}/operation/assign`);
      this.client.subscribe(`v1/vtms/${this.code}/command/execute`);
      this.log('info', this.code, 'MQTT 已連線，訂閱 operation/assign 與 command/execute');
    });

    this.client.on('error', (error) => {
      // 帳密錯誤在這裡現形。broker 關閉匿名連線，帳號必須等於車輛代號。
      this.lastError = error.message;
      this.log('error', this.code, `MQTT 錯誤：${error.message}`);
    });

    this.client.on('close', () => {
      if (this.connected) this.log('warn', this.code, 'MQTT 連線中斷');
      this.connected = false;
    });

    this.client.on('message', (topic, buffer) => {
      let payload;
      try {
        payload = JSON.parse(buffer.toString());
      } catch {
        return;
      }
      if (topic.endsWith('/operation/assign')) void this.onAssign(payload);
      else if (topic.endsWith('/command/execute')) this.onCommand(payload);
    });

    this.timers.push(setInterval(() => this.tick(), TICK_INTERVAL_MS));
    this.timers.push(setInterval(() => this.publishHealth(), HEALTH_INTERVAL_MS));
  }

  disconnect() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.connected = false;
    this.order = null;
  }

  publish(suffix, payload, options = {}) {
    if (!this.client || !this.connected) return;
    this.client.publish(`v1/vtms/${this.code}/${suffix}`, JSON.stringify(payload), options);
    this.stats.published += 1;
  }

  // ── 訂單 ─────────────────────────────────────────────────────

  /**
   * 收到指派。
   *
   * assign 只帶 order_id——任務內容要自己去拉，這是協議 §四 的契約。中心端不會
   * 把整包任務塞在 MQTT 訊息裡，因為那條通道不保證順序也不保證只送一次。
   */
  async onAssign(assign) {
    const orderId = assign?.order_id;
    if (!orderId) return;
    this.stats.assigns += 1;

    if (this.faulted) {
      this.log('warn', this.code, `故障中，暫不接單 ${orderId}`);
      return;
    }
    if (this.order && this.order.id === orderId) return;

    try {
      const order = await this.api.queryOrder(orderId);
      const { points: stops, missing } = this.map.polylineFor(order);

      // 有人畫過這條路線的路徑就照畫的走；沒有才自動沿軌找最短路。
      //
      // 人畫的優先，是因為「實際要走哪一條」只有人知道——同樣兩站之間可能有
      // 好幾條走法，最短的那條未必是現場真的會走的那條。
      const stationIds = (order?.payload?.stations ?? [])
        .map((station) => station?.station_id)
        .filter(Boolean)
        .map(String);
      const drawn = this.routeFor ? this.routeFor(stationIds) : null;
      const points = drawn
        ? drawn.samples.map((point) => ({ ...point }))
        : this.routeThroughStops(stops);
      if (points.length < 2) {
        this.log(
          'error',
          this.code,
          `訂單 ${orderId} 取不到可用座標（缺 ${missing.join('、') || '起訖點'}），不執行`,
        );
        return;
      }
      if (missing.length > 0) {
        this.log('warn', this.code, `訂單 ${orderId} 有 ${missing.length} 個點在圖資裡查不到，已略過`);
      }

      const plannedStart = Number(order.plannedStart ?? order.planned_start ?? 0);
      const plannedEnd = Number(order.plannedEnd ?? order.planned_end ?? 0);
      const plannedMs = plannedEnd > plannedStart ? plannedEnd - plannedStart : 3 * 60_000;

      await this.api.updateOrderProgress(orderId, 'processing');

      this.order = {
        id: orderId,
        raw: order,
        // 站名用<strong>原始站序</strong>，不要用規劃後的折線：折線去重時，若終點
        // 與前一個軌道節點重疊，被丟掉的會是帶著名字的那一個，畫面上就變成
        // 「H3 → undefined」。
        from: stops[0]?.name ?? null,
        to: stops[stops.length - 1]?.name ?? null,
        /** 是否照使用者畫的路徑走 */
        drawnRouteId: drawn?.routeId ?? null,
        tripCode: order.tripCode ?? order.trip_code ?? '',
        kind: order.payload?.kind ?? 'passenger',
        yardSlotId: order.payload?.yard_slot_id ?? null,
        routeId: order.routeId ?? order.route_id ?? null,
        points,
        startedAt: Date.now(),
        plannedMs,
        progress: 0,
      };
      this.position = { x: points[0].x, y: points[0].y };

      this.log(
        'order',
        this.code,
        `接單 ${orderId}（${this.order.from ?? '?'} → ${this.order.to ?? '?'}，`
          + `計畫 ${Math.round(plannedMs / 1000)} 秒`
          + `${drawn ? `，走 ${drawn.displayName} 的自訂路徑` : ''}）`,
      );
    } catch (error) {
      this.lastError = error.message;
      this.log('error', this.code, `處理 ${orderId} 失敗：${error.message}`);
    }
  }

  /**
   * 把站序展開成沿軌折線。
   *
   * 每一段各自走軌道圖；某一段找不到路徑（例如兩端都在場區內）就退回直線，
   * 不要因為一段規劃失敗就讓整趟不能跑。
   */
  routeThroughStops(stops) {
    if (!this.track || stops.length < 2) return stops;
    const out = [stops[0]];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const leg = this.track.route(stops[i], stops[i + 1]);
      const tail = leg ? leg.slice(1) : [stops[i + 1]];
      for (const point of tail) out.push(point);
    }
    return out;
  }

  async finishOrder() {
    const order = this.order;
    if (!order) return;
    this.order = null;
    try {
      await this.api.updateOrderProgress(order.id, 'end');
      this.stats.completed += 1;
      this.log('order', this.code, `完成 ${order.id}`);
    } catch (error) {
      this.lastError = error.message;
      this.log('error', this.code, `回報完成 ${order.id} 失敗：${error.message}`);
    }
  }

  // ── 指令 ─────────────────────────────────────────────────────

  /**
   * 中心端下指令。先 ack 再動作——ack 是「收到」，不是「做完」。
   */
  onCommand(command) {
    if (!command?.command_id || !command?.action) return;
    this.publish('command/ack', {
      command_id: command.command_id,
      vehicle_code: this.code,
      timestamp: Date.now(),
      status: 'ACCEPTED',
    });
    this.log('command', this.code, `收到指令 ${command.action}`);

    if (command.action === 'EMERGENCY_STOP') {
      this.raiseFault('PATH_BLOCKED', 'CRITICAL', '緊急停止指令，路徑受阻至人工復歸', command.command_id);
    }
  }

  /** 主動上報異常。CRITICAL 會閂鎖成故障，WARNING 只是事件。 */
  raiseFault(eventCode, severity, detail, commandId) {
    if (severity === 'CRITICAL') this.faulted = true;
    this.publish('event/report', {
      event_id: `EVT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      vehicle_code: this.code,
      timestamp: Date.now(),
      event_code: eventCode,
      severity,
      location: { lat: 25.0776, lng: 121.2325 },
      detail,
      ...(commandId ? { command_id: commandId } : {}),
    });
    this.log(severity === 'CRITICAL' ? 'error' : 'warn', this.code, `上報 ${eventCode}（${severity}）`);
  }

  clearFault() {
    if (!this.faulted) return;
    this.faulted = false;
    this.log('info', this.code, '故障已清除，恢復接單');
  }

  // ── 每秒 ─────────────────────────────────────────────────────

  tick() {
    if (!this.connected) return;

    if (this.order && !this.faulted) {
      // 倍速是壓縮計畫時間，不是加大車速——這樣一小時的班表可以在幾分鐘內走完，
      // 而每一段的<strong>相對</strong>長短仍與計畫一致。
      const elapsed = (Date.now() - this.order.startedAt) * this.speed;
      this.order.progress = Math.min(1, elapsed / Math.max(1000, this.order.plannedMs));
      const at = walkPolyline(this.order.points, this.order.progress);
      if (at) {
        this.position = { x: at.x, y: at.y };
        this.heading = at.heading;
      }
      if (this.order.progress >= 1) {
        void this.finishOrder();
      }
    }

    // 電量照真實時間掉，不照倍速——倍速壓縮的是班表，不是電池
    this.battery = Math.max(5, this.battery - (this.order ? 0.0002 : 0.00004));

    // 倍速多少就多發幾筆，讓每筆之間的位移維持差不多
    const interval = Math.max(
      TELEMETRY_MIN_INTERVAL_MS,
      TELEMETRY_BASE_INTERVAL_MS / Math.max(1, this.speed),
    );
    const now = Date.now();
    if (now - (this.lastTelemetryAt ?? 0) < interval) return;
    this.lastTelemetryAt = now;

    this.publishTelemetry();
    if (this.order) this.publishOperation();
  }

  publishTelemetry() {
    if (!this.position) return;
    // 整備訂單起訖是同一格，車停在那裡做事——不該顯示成在跑。
    // 空車移動雖然也歸整備班次，但車是真的在開，速度照常。
    const moving = Boolean(this.order)
      && this.order.kind !== 'maintenance'
      && !this.faulted
      && this.order.progress < 1;

    /*
     * 速度用<strong>實際位移</strong>算，不是填一個固定值。
     *
     * 圖台會拿速度去外推兩筆之間的位置。固定回報 8 m/s 但實際在 10 倍速下每秒跑
     * 80 公尺的話，外推出來的位置跟下一筆實際位置對不上，畫面就會一直「衝過頭再被拉回」
     * ——看起來比不外推還鈍。
     */
    let velocity = 0;
    if (moving) {
      const previous = this.lastPublished;
      const dt = previous ? (Date.now() - previous.at) / 1000 : 0;
      velocity = dt > 0
        ? Math.hypot(this.position.x - previous.x, this.position.y - previous.y) / dt
        : CRUISE_SPEED_MPS;
    }
    this.lastPublished = { x: this.position.x, y: this.position.y, at: Date.now() };
    this.publish(
      'telemetry/update',
      {
        vehicle_code: this.code,
        timestamp: Date.now(),
        ...(this.order?.tripCode ? { trip_code: this.order.tripCode, badge_label: this.order.tripCode } : {}),
        global_pose: { latitude: 25.0776, longitude: 121.2325, altitude: 6.0 },
        local_pose: {
          position: { x: this.position.x, y: this.position.y, z: 6.0 },
          orientation: {
            w: Math.cos(this.heading / 2),
            x: 0,
            y: 0,
            z: Math.sin(this.heading / 2),
          },
          heading: this.heading,
        },
        kinematics: {
          velocity: Math.round(velocity * 100) / 100,
          acceleration: moving ? 0.05 : 0,
          angular_velocity: 0.02,
        },
        actuation_feedback: {
          throttle: moving ? 15 : 0,
          brake: moving ? 0 : 12,
          steering_angle: 0,
          gear: moving ? 'D' : 'N',
        },
        energy: { battery_level: Math.round(this.battery) },
        signals: { turn_indicator: 'NONE', hazard_light: this.faulted },
      },
      { qos: 0 },
    );
  }

  publishOperation() {
    const order = this.order;
    if (!order) return;
    const last = order.points[order.points.length - 1];
    const at = walkPolyline(order.points, order.progress);
    const nextPoint = order.points[Math.min(order.points.length - 1, (at?.legIndex ?? 0) + 1)];
    const remainingMs = Math.max(0, order.plannedMs * (1 - order.progress));

    this.publish(
      'operation/update',
      {
        vehicle_code: this.code,
        timestamp: Date.now(),
        order_id: order.id,
        ...(order.tripCode ? { trip_code: order.tripCode } : {}),
        // 三種訂單各自標記。中心端會拿車端回報的 line_kind 覆寫訂單上的分類，
        // 所以這裡標錯不只是顯示問題——整備訂單被標成 MOVEMENT 之後，資料庫裡
        // 就再也找不到任何一筆 MAINTENANCE，整備分佈與整備分頁跟著全空。
        line_kind: LINE_KIND_BY_ORDER_KIND[order.kind] ?? 'MOVEMENT',
        ...(order.yardSlotId ? { yard_slot_id: order.yardSlotId } : {}),
        ...(order.routeId ? { route_id: order.routeId } : {}),
        order_status: this.faulted ? 'FAULTED' : 'PROCESSING',
        vehicle_phase: this.faulted ? 'FAULTED' : 'RUNNING',
        current_leg: {
          target_station_id: nextPoint?.id ?? last.id,
          distance_to_target_m: this.position ? Math.round(distance(this.position, nextPoint ?? last)) : 0,
          eta_seconds: Math.round(remainingMs / 1000),
          // 這一段的總秒數。中心端拿它當分母算段落剩餘百分比；不給的話它只能拿
          // 「目前看過的最大 eta」當分母，於是每一段的進度都從 0% 開始往上跳。
          leg_eta_max: Math.max(1, Math.round(order.plannedMs / 1000 / Math.max(1, order.points.length - 1))),
        },
        // 兩個名字都給：route_progress 是圖台元件的預設欄位名
        route_progress: Math.round(order.progress * 100),
        progress_percent: Math.round(order.progress * 100),
      },
      { qos: 0 },
    );
  }

  publishHealth() {
    this.publish('health/heartbeat', {
      vehicle_code: this.code,
      timestamp: Date.now(),
      overall_health: this.faulted ? 'FAULT' : 'OK',
      subsystems: {
        COMPUTING: { status: 'OK', error_codes: [] },
        SENSING: { status: this.faulted ? 'FAULT' : 'OK', error_codes: this.faulted ? ['PATH_BLOCKED'] : [] },
        COMMUNICATION: { status: 'OK', error_codes: [] },
        CHASSIS: { status: 'OK', error_codes: [] },
      },
    });
  }

  snapshot() {
    return {
      code: this.code,
      connected: this.connected,
      faulted: this.faulted,
      battery: Math.round(this.battery),
      lastError: this.lastError,
      position: this.position,
      stats: { ...this.stats },
      order: this.order
        ? {
          id: this.order.id,
          tripCode: this.order.tripCode,
          kind: this.order.kind,
          progress: Math.round(this.order.progress * 100),
          from: this.order.from,
          to: this.order.to,
          drawnRouteId: this.order.drawnRouteId,
        }
        : null,
    };
  }
}

module.exports = { SimulatedVehicle, walkPolyline };
