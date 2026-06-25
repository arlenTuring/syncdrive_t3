/**
 * VTMS 班次演示模擬器（v0.0.5 參照場域）
 *
 * 車隊：PMS-01～11 池輪替；示範場景預設場上 4 台、間隔 3 分鐘（見 ACTIVE_SLOT_COUNT，可調，非後端硬性上限）
 * 規則1（D）：N2W下行 → D02–D18 → T3下行 → D20–D34 → S2W下行（每站 36s）
 * 規則2（U）：S2W上行 → U34–U18 → T3上行 → U16–U02 → N2W上行（每站 36s）
 * 規則3：1→2 無限循環；規則4：四台車 3 分鐘發車；規則5：不跨軌道；號誌前 20m
 *
 * MANAGED=1 時由後端 TRANSPORT_API 控制速度、暫停、逐幀。
 */
const {
  resolveMaintenanceTaskMeta,
  maintenanceTripCode,
} = require('./maintenance-task-catalog');
const {
  ROUTE_MAINLINE_TASK_SPECS,
  routeIdForTrip,
  buildTaskGroup,
  deriveOperationActionFromTaskGroup,
} = require('./route-mainline-task-specs');
const fs = require('fs');
const {
  getActiveFleet,
  getVehicleMotion,
  psdOpenPercentAtDwellMs,
  T3_DOCKING_STOPS,
  T3_SIGNAL_REGISTRY,
  computeSignalLamps,
  tickFleetBatteryState,
  resetFleetBatteryState,
  getVehicleBattery,
  getVehiclePreDepartureMotion,
  getVehicleYardMotion,
  getVehiclePublishMotion,
  VEHICLE_POOL,
  buildMainlineCurrentLeg,
  buildPreDepartureCurrentLeg,
} = require('./t3-v0-0-5-track-motion');
const mqtt = require('mqtt');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const TRANSPORT_API = process.env.TRANSPORT_API || '';
const TRANSPORT_STATE_FILE = process.env.TRANSPORT_STATE_FILE || '';
const SYNC_API = process.env.SYNC_API
  || (TRANSPORT_API ? TRANSPORT_API.replace(/\/demo\/simulation\/?$/, '') : 'http://127.0.0.1:3000/syncdrive-api');
const POLL_MS = 100;
const MQTT_PUBLISH_INTERVAL_MS = 1000;
const TOTAL_DURATION_MS = 60 * 60 * 1000;

const MQTT_OPTS_TELEMETRY = { retain: false };
const MQTT_OPTS_OPERATION = { retain: true };
const MQTT_OPTS_HEALTH = { retain: true };

/** 每車 1Hz MQTT 節流（協議 telemetry / operation / health） */
const lastMqttPublishByVehicle = new Map();

/** 車端訂單狀態（assign → REST processing → MQTT update → REST end） */
const vehicleOrders = new Map();
const legEndRequested = new Set();

/** CRITICAL 故障：vehicle_phase → FAULTED（協議 P4 §六） */
const vehicleFaultState = new Map();
const FAULT_LATCH_MS = 2 * 60 * 1000;
/** 下一幀 tick 回報給後端，供工具列顯示事件描述 */
let pendingSimulatedEventAck = null;
/** 中心下發之車輛參數覆寫（限速、換向） */
const vehicleCommandOverrides = new Map();
/** 待處理之模擬器動作（如 CLEAR_FAULT，由後端 transport 注入） */
let lastProcessedSimulatorActionNonce = 0;

const FAULT_EVENT_MESSAGE = '緊急停車指令：路徑受阻，車輛已安全停車（PATH_BLOCKED / CRITICAL）';

function isVehicleFaulted(vehicleCode) {
  const fault = vehicleFaultState.get(vehicleCode);
  if (!fault) return false;
  if (Date.now() > fault.untilMs) {
    vehicleFaultState.delete(vehicleCode);
    return false;
  }
  return true;
}

function latchVehicleFault(vehicleCode, reason) {
  vehicleFaultState.set(vehicleCode, {
    untilMs: Date.now() + FAULT_LATCH_MS,
    reason: reason ?? 'EMERGENCY_STOP',
  });
}

function clearVehicleFault(vehicleCode) {
  vehicleFaultState.delete(vehicleCode);
  console.log(`[fault] ${vehicleCode} → fault cleared (manual recovery)`);
}

function buildEventId() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `EVT-${dateStr}-${seq}`;
}

function publishSecurityEventReport(client, vehicleCode, eventCode, detail, severity = 'CRITICAL') {
  const payload = {
    event_id: buildEventId(),
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    event_code: eventCode,
    severity,
    location: { lat: 25.0776, lng: 121.2325 },
    detail: detail ?? `${eventCode} reported by demo vehicle`,
  };
  client.publish(
    `v1/vtms/${vehicleCode}/event/report`,
    JSON.stringify(payload),
    { retain: false },
  );
}

function publishCommandAck(client, vehicleCode, command) {
  const ack = {
    command_id: command.command_id,
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    status: 'ACCEPTED',
  };
  client.publish(
    `v1/vtms/${vehicleCode}/command/ack`,
    JSON.stringify(ack),
    { retain: false },
  );
}

function handleCommandExecute(client, vehicleCode, command) {
  if (!command?.command_id || !command?.action) return;
  publishCommandAck(client, vehicleCode, command);
  const params = command.params ?? {};

  if (command.action === 'EMERGENCY_STOP') {
    latchVehicleFault(vehicleCode, 'EMERGENCY_STOP');
    const detail = 'Emergency stop commanded; path blocked until manual recovery';
    publishSecurityEventReport(
      client,
      vehicleCode,
      'PATH_BLOCKED',
      detail,
    );
    pendingSimulatedEventAck = {
      vehicleCode,
      eventCode: 'PATH_BLOCKED',
      severity: 'CRITICAL',
      message: FAULT_EVENT_MESSAGE,
      timestamp: Date.now(),
      commandId: command.command_id,
    };
    console.log(`[fault] ${vehicleCode} → vehicle_phase FAULTED (EMERGENCY_STOP)`);
    return;
  }

  if (command.action === 'DOOR_CONTROL') {
    const doorAction = String(params.door_action ?? '').toUpperCase();
    console.log(`[command] ${vehicleCode} DOOR_CONTROL ${doorAction} door_id=${params.door_id ?? 'ALL'}`);
    return;
  }

  if (command.action === 'SET_SPEED_LIMIT') {
    const limit = Number(params.limit_kmh);
    if (Number.isFinite(limit) && limit > 0) {
      const prev = vehicleCommandOverrides.get(vehicleCode) ?? {};
      vehicleCommandOverrides.set(vehicleCode, { ...prev, speedLimitKmh: limit });
      console.log(`[command] ${vehicleCode} speed limit → ${limit} km/h`);
    }
    return;
  }

  if (command.action === 'SET_DIRECTION') {
    const direction = String(params.direction ?? '').toUpperCase();
    if (direction === 'FORWARD' || direction === 'REVERSE') {
      const prev = vehicleCommandOverrides.get(vehicleCode) ?? {};
      vehicleCommandOverrides.set(vehicleCode, { ...prev, direction });
      console.log(`[command] ${vehicleCode} direction → ${direction}`);
    }
    return;
  }
}

function processPendingSimulatorAction(transport, client) {
  const action = transport?.pendingSimulatorAction;
  if (!action?.vehicleCode || !action?.action || !action?.nonce) return;
  if (action.nonce === lastProcessedSimulatorActionNonce) return;
  lastProcessedSimulatorActionNonce = action.nonce;

  const vehicleCode = action.vehicleCode;
  if (action.action === 'CLEAR_FAULT') {
    clearVehicleFault(vehicleCode);
    pendingSimulatedEventAck = {
      vehicleCode,
      eventCode: 'SYSTEM_HEALTH_DEGRADED',
      severity: 'INFO',
      message: `${vehicleCode} 故障已人工復歸，vehicle_phase 恢復正常`,
      timestamp: Date.now(),
    };
    return;
  }

  if (action.action === 'SIMULATE_OBSTACLE') {
    publishSecurityEventReport(
      client,
      vehicleCode,
      'OBSTACLE_DETECTED',
      'Obstacle detected on path; slowing down',
      'WARNING',
    );
    pendingSimulatedEventAck = {
      vehicleCode,
      eventCode: 'OBSTACLE_DETECTED',
      severity: 'WARNING',
      message: `${vehicleCode} 路徑障礙物偵測（OBSTACLE_DETECTED / WARNING）`,
      timestamp: Date.now(),
    };
  }
}

function resolveVehiclePhase(vehicleCode, motion) {
  if (isVehicleFaulted(vehicleCode)) return 'FAULTED';
  if (isPreDepartureMainline(motion)) return 'AWAITING_DEPARTURE';
  if (motion.dwelling) return 'DWELLING';
  return 'TRANSITING';
}

function resolveDoorFields(motion) {
  const keys = [
    'door_fl_open_percent',
    'door_fr_open_percent',
    'door_rl_open_percent',
    'door_rr_open_percent',
  ];
  const out = {};
  for (const key of keys) {
    const raw = motion[key];
    out[key] =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.max(0, Math.min(100, raw))
        : 0;
  }
  const aggregateRaw = motion.door_open_percent;
  const aggregate =
    typeof aggregateRaw === 'number' && Number.isFinite(aggregateRaw)
      ? aggregateRaw
      : Math.max(...keys.map((k) => out[k]));
  out.door_open_percent = Math.max(0, Math.min(100, aggregate));
  return out;
}

function demoOrderId(tripCode, departMs) {
  const d = new Date(departMs);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}-${String(tripCode).trim().toUpperCase()}`;
}

function isShiftTripCode(code) {
  return typeof code === 'string' && /^[DU]\d{4}$/.test(code.trim());
}

function shouldPublishVehicleMqtt(vehicleId) {
  const now = Date.now();
  const last = lastMqttPublishByVehicle.get(vehicleId) ?? 0;
  if (now - last < MQTT_PUBLISH_INTERVAL_MS) return false;
  lastMqttPublishByVehicle.set(vehicleId, now);
  return true;
}

function buildPredictionPath(x, y, heading, speedKmh, seconds = 4) {
  if (typeof x !== 'number' || typeof y !== 'number' || typeof heading !== 'number') {
    return [];
  }
  const speedMps = Math.max(0, speedKmh) / 3.6;
  const steps = 5;
  const path = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = (seconds / steps) * i;
    path.push({
      x: x + Math.cos(heading) * speedMps * t,
      y: y + Math.sin(heading) * speedMps * t,
    });
  }
  return path;
}

function resolveTurnIndicator(motion) {
  if (motion.hazard_light) return 'NONE';
  if (motion.head_light_on && !motion.tail_light_on) return 'LEFT';
  if (motion.tail_light_on && !motion.head_light_on) return 'RIGHT';
  return 'NONE';
}

function resolveMaintenanceOperationFields(motion) {
  const maintMeta = resolveMaintenanceTaskMeta(motion);
  if (!maintMeta) return null;
  return {
    priority_level: maintMeta.priority_level,
    line_kind: maintMeta.line_kind,
    trip_code: maintenanceTripCode(motion, maintMeta),
    vehicle_phase: motion.fleet_task === 'charge' || motion.fleet_task === 'charge_queue'
      ? 'CHARGING'
      : 'YARD_DWELLING',
    maint_type_label: maintMeta.maint_type_label,
    maint_type_bg: maintMeta.maint_type_bg,
    maint_type_color: maintMeta.maint_type_color,
    badge_label: maintMeta.maint_type_label,
    badge_kind: 'maintenance',
  };
}

/** 車輛動態協議：僅空間與運動學（不含營運業務欄位） */
function telemetry(vehicleCode, motion, speed, battery) {
  const { x, y, heading, steering_angle, dwelling, tripCode, track } = motion;
  const faulted = isVehicleFaulted(vehicleCode);
  const cruiseSpeed = faulted || dwelling ? 0 : speed;
  const steer = steering_angle ?? 0;
  // 頭燈隨車行方向：圖台以「車頭(head)朝 heading 方向」算繪，heading 已含上/下行方向，
  // 故行進中點亮 head_light（位於車頭、即行進方向端），停等/故障時熄滅；tail 不亮。
  const moving = cruiseSpeed > 0;
  const segmentLabel = typeof track === 'string' ? track.replace(/→.*/, '').trim() : '';
  const trip = isShiftTripCode(tripCode) ? String(tripCode).trim().toUpperCase() : undefined;
  return {
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    ...(trip ? { trip_code: trip, badge_label: trip } : {}),
    ...(segmentLabel ? { segment_label: segmentLabel } : {}),
    global_pose: { latitude: 25.0776, longitude: 121.2325, altitude: 6.0 },
    local_pose: {
      position: { x, y, z: 6.0 },
      orientation: { w: Math.cos(heading / 2), x: 0, y: 0, z: Math.sin(heading / 2) },
      heading,
    },
    kinematics: {
      velocity: cruiseSpeed,
      acceleration: dwelling ? 0 : 0.05,
      angular_velocity: steer ? steer * 0.15 : 0.02,
    },
    actuation_feedback: {
      throttle: dwelling ? 0 : 15,
      brake: dwelling ? 12 : 0,
      steering_angle: steer,
      gear: dwelling ? 'N' : 'D',
    },
    energy: { battery_level: battery },
    head_light_on: moving,
    tail_light_on: false,
    signals: {
      turn_indicator: resolveTurnIndicator(motion),
      hazard_light: faulted || Boolean(motion.hazard_light),
    },
    prediction: {
      path: buildPredictionPath(x, y, heading, cruiseSpeed),
    },
  };
}

function health(vehicleCode) {
  return {
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    overall_health: 'OK',
    subsystems: {
      COMPUTING: { status: 'OK', error_codes: [] },
      SENSING: { status: 'OK', error_codes: [] },
      COMMUNICATION: { status: 'OK', error_codes: [] },
      CHASSIS: { status: 'OK', error_codes: [] },
    },
  };
}

function isPreDepartureMainline(motion) {
  if (!isShiftTripCode(motion.tripCode)) return false;
  if (motion.preDeparture === true || motion.fleet_task === 'pre_departure') return true;
  return (
    motion.active === false
    && motion.fleet_task !== 'shift_run'
    && (motion.leg === 'down' || motion.leg === 'up')
    && typeof motion.legDepartMs === 'number'
  );
}

function isMainlineShiftMotion(motion) {
  return (
    isShiftTripCode(motion.tripCode)
    && (
      motion.fleet_task === 'shift_run'
      || motion.fleet_task === 'pre_departure'
      || motion.leg === 'down'
      || motion.leg === 'up'
    )
  );
}

function operation(vehicleCode, motion) {
  const ts = Date.now();

  if (!isMainlineShiftMotion(motion)) {
    const maintFields = resolveMaintenanceOperationFields(motion);
    if (!maintFields) {
      return { vehicle_code: vehicleCode, timestamp: ts };
    }
    return {
      vehicle_code: vehicleCode,
      timestamp: ts,
      order_id: `DEMO-ORD-${vehicleCode}`,
      yard_slot_id: motion.yard_slot_id ?? null,
      ...maintFields,
    };
  }

  const tripCode = String(motion.tripCode).trim().toUpperCase();
  const departMs = motion.legDepartMs ?? ts;
  const orderId = demoOrderId(tripCode, departMs);
  const routeId = routeIdForTrip(tripCode);

  if (isPreDepartureMainline(motion)) {
    const departEtaSeconds = motion.departEtaSeconds ?? 0;
    return {
      vehicle_code: vehicleCode,
      timestamp: ts,
      order_id: orderId,
      trip_code: tripCode,
      line_kind: 'MAINLINE',
      route_id: routeId,
      vehicle_phase: resolveVehiclePhase(vehicleCode, motion),
      order_status: 'PENDING',
      current_leg: buildPreDepartureCurrentLeg(tripCode, departEtaSeconds),
      operation_action: 'music',
    };
  }

  const interlockActive = (motion.operation_actions ?? []).includes('signal')
    || motion.operation_action === 'signal';

  const payload = {
    vehicle_code: vehicleCode,
    timestamp: ts,
    order_id: orderId,
    trip_code: tripCode,
    line_kind: 'MAINLINE',
    route_id: routeId,
    // 行進中訂單契約狀態，供前端 route 進度判定 isProcessing（缺漏會使 MQTT 即時進度被忽略）
    order_status: 'PROCESSING',
    vehicle_phase: resolveVehiclePhase(vehicleCode, motion),
    current_leg: buildMainlineCurrentLeg(tripCode, motion.progress ?? 0),
    task_group: buildTaskGroup(orderId, tripCode, motion, { interlockActive }),
  };

  const opFromTasks = deriveOperationActionFromTaskGroup(payload.task_group);
  if (opFromTasks) {
    payload.operation_action = opFromTasks;
    Object.assign(payload, resolveDoorFields(motion));
  }

  return payload;
}

function maybeEndMainlineOrder(vehicleId, motion, opPayload) {
  const orderId = opPayload.order_id;
  if (!isShiftTripCode(opPayload.trip_code) || !orderId) return;
  const state = vehicleOrders.get(vehicleId);
  if (!state || state.status !== 'PROCESSING' || state.orderId !== orderId) return;
  if ((motion.progress ?? 0) >= 0.995) {
    void requestEndOrder(vehicleId, orderId);
  }
}

function publishVehicleMqtt(client, vehicleId, motion, battery, opPayload, idx = 0) {
  if (!shouldPublishVehicleMqtt(vehicleId)) return;

  const speed = motion.dwelling ? 0 : 8 + Math.sin(Date.now() / 4000 + idx) * 2;
  client.publish(
    `v1/vtms/${vehicleId}/telemetry/update`,
    JSON.stringify(telemetry(vehicleId, motion, speed, battery)),
    MQTT_OPTS_TELEMETRY,
  );
  client.publish(
    `v1/vtms/${vehicleId}/health/heartbeat`,
    JSON.stringify(health(vehicleId)),
    MQTT_OPTS_HEALTH,
  );

  const isMainline = isShiftTripCode(opPayload.trip_code);
  if (isMainline && opPayload.order_id && process.env.MANAGED !== '1') {
    const state = vehicleOrders.get(vehicleId);
    if (!state || state.status !== 'PROCESSING' || state.orderId !== opPayload.order_id) {
      return;
    }
  }

  client.publish(
    `v1/vtms/${vehicleId}/operation/update`,
    JSON.stringify(opPayload),
    MQTT_OPTS_OPERATION,
  );
}

async function confirmAssign(vehicleCode, assignPayload) {
  const orderId = assignPayload?.order_id;
  if (!orderId) return;
  try {
    const q = await fetch(`${SYNC_API}/order/queryById?id=${encodeURIComponent(orderId)}`);
    if (!q.ok) return;
    const put = await fetch(
      `${SYNC_API}/order/updateOrderProgress/${encodeURIComponent(orderId)}?status=processing`,
      { method: 'PUT' },
    );
    if (put.ok) {
      vehicleOrders.set(vehicleCode, { orderId, status: 'PROCESSING' });
      legEndRequested.delete(`${vehicleCode}:${orderId}`);
    }
  } catch (err) {
    console.warn(`[assign] ${vehicleCode} REST confirm failed:`, err?.message ?? err);
  }
}

async function requestEndOrder(vehicleCode, orderId) {
  const key = `${vehicleCode}:${orderId}`;
  if (legEndRequested.has(key)) return;
  legEndRequested.add(key);
  try {
    const put = await fetch(
      `${SYNC_API}/order/updateOrderProgress/${encodeURIComponent(orderId)}?status=end`,
      { method: 'PUT' },
    );
    if (put.ok) {
      vehicleOrders.set(vehicleCode, { orderId, status: 'ENDED' });
    } else {
      legEndRequested.delete(key);
    }
  } catch (err) {
    legEndRequested.delete(key);
    console.warn(`[end] ${vehicleCode} ${orderId} failed:`, err?.message ?? err);
  }
}

function readTransportFile() {
  if (!TRANSPORT_STATE_FILE) return null;
  try {
    const raw = fs.readFileSync(TRANSPORT_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchTransport() {
  if (TRANSPORT_API) {
    try {
      const res = await fetch(`${TRANSPORT_API}/transport`);
      if (res.ok) {
        return res.json();
      }
    } catch {
      /* fall through to file */
    }
  }
  return readTransportFile();
}

async function ackTransportTick(virtualElapsedMs, simulatedEvent) {
  if (!TRANSPORT_API) return null;
  try {
    const body = { virtualElapsedMs };
    if (simulatedEvent) {
      body.simulatedEvent = simulatedEvent;
    }
    const res = await fetch(`${TRANSPORT_API}/transport/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function flushPendingSimulatedEventAck(localVirtualElapsed) {
  if (!pendingSimulatedEventAck) return;
  const event = pendingSimulatedEventAck;
  pendingSimulatedEventAck = null;
  void ackTransportTick(localVirtualElapsed, event);
}

function publishFleet(client, elapsedMs, simStartMs) {
  tickFleetBatteryState(elapsedMs, simStartMs);
  const activeFleet = getActiveFleet();
  const psdByEntityId = new Map();

  for (const vehicleId of VEHICLE_POOL) {
    const battery = getVehicleBattery(vehicleId);
    if (battery == null) continue;
    const motion = getVehiclePublishMotion(vehicleId, elapsedMs, simStartMs, {
      managed: process.env.MANAGED === '1',
    });
    if (!motion) continue;

    const idx = activeFleet.findIndex((v) => v.id === vehicleId);
    const opPayload = operation(vehicleId, motion);
    maybeEndMainlineOrder(vehicleId, motion, opPayload);
    publishVehicleMqtt(client, vehicleId, motion, battery, opPayload, Math.max(0, idx));

    if (motion.leg === 'yard') continue;

    if (motion.dwelling && typeof motion.station === 'string' && motion.station.includes('行')) {
      const entityId = T3_DOCKING_STOPS?.psdByDockingLabel?.[motion.station];
      if (entityId && typeof motion.eventElapsedMs === 'number') {
        const pct = psdOpenPercentAtDwellMs(motion.eventElapsedMs);
        const prev = psdByEntityId.get(entityId) ?? 0;
        psdByEntityId.set(entityId, Math.max(prev, pct));
      }
    }
  }

  // 發送 PSD 狀態（全部預設關閉；有車停靠者依上面覆蓋）
  const allPsdIds = new Set([
    ...Object.values(T3_DOCKING_STOPS?.psdByDockingLabel ?? {}),
    ...(T3_DOCKING_STOPS?.allPsdEntityIds ?? []),
  ]);
  for (const entityId of allPsdIds) {
    const pct = psdByEntityId.get(entityId) ?? 0;
    client.publish(
      entityId.startsWith('syncdrive/') ? entityId : `syncdrive/${entityId}`,
      JSON.stringify({
        openPercent: pct,
        state: pct >= 99.5 ? 'Open' : pct <= 0.5 ? 'Closed' : 'Moving',
        alarm: false,
        timestamp: Date.now(),
      }),
    );
  }

  // 號誌：預設紅燈；車輛停等 5s 後綠燈；通過後恢復紅燈
  const signalLamps = computeSignalLamps(elapsedMs, simStartMs);
  for (const signal of T3_SIGNAL_REGISTRY) {
    const lamp = signalLamps.get(signal.entityId) ?? 'red';
    client.publish(
      `syncdrive/${signal.entityId}`,
      JSON.stringify({
        lamp,
        signal: lamp,
        timestamp: Date.now(),
      }),
    );
  }
}

async function main() {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `vtms-shift-demo-${process.pid}`,
    clean: true,
  });

  const resolveSimStartMs = (transport) => {
    const fromEnv = Number(process.env.SIM_START_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    const fromTransport = Number(transport?.simStartMs);
    if (Number.isFinite(fromTransport) && fromTransport > 0) return fromTransport;
    return Date.now();
  };

  let simStartMs = resolveSimStartMs(null);
  const managed = process.env.MANAGED === '1' && !!TRANSPORT_API;

  let lastPollAt = Date.now();
  let accrualMs = 0;
  let lastStepNonce = 0;
  let localVirtualElapsed = 0;

  client.on('message', (topic, buf) => {
    const parts = topic.split('/');
    const vehicleCode = parts[2];
    if (!vehicleCode) return;
    try {
      const payload = JSON.parse(buf.toString());
      if (topic.endsWith('/operation/assign')) {
        void confirmAssign(vehicleCode, payload);
        return;
      }
      if (topic.endsWith('/command/execute')) {
        handleCommandExecute(client, vehicleCode, payload);
      }
    } catch {
      /* ignore malformed mqtt */
    }
  });

  client.on('connect', async () => {
    console.log(`VTMS shift demo connected (${MQTT_URL})`);
    for (const vehicleId of VEHICLE_POOL) {
      client.subscribe(`v1/vtms/${vehicleId}/operation/assign`);
      client.subscribe(`v1/vtms/${vehicleId}/command/execute`);
    }
    if (managed) {
      const transport = await fetchTransport();
      simStartMs = resolveSimStartMs(transport);
    }
    resetFleetBatteryState(simStartMs);

    if (!managed) {
      publishFleet(client, 0, simStartMs);
      setInterval(() => {
        client.publish(
          'v1/vtms/dashboard/capacity/live',
          JSON.stringify({
            live_val: 1080 + Math.round(Math.sin(Date.now() / 10000) * 60),
            target_val: 1200,
            timestamp: Date.now(),
          }),
        );
      }, 2000);
      const timer = setInterval(() => {
        const elapsed = Date.now() - simStartMs;
        if (elapsed > TOTAL_DURATION_MS + 5000) {
          clearInterval(timer);
          console.log('⏹️  班次演示 1 小時已結束');
          client.end();
          process.exit(0);
          return;
        }
        publishFleet(client, elapsed, simStartMs);
      }, MQTT_PUBLISH_INTERVAL_MS);
      return;
    }

    setInterval(async () => {
      const transport = await fetchTransport();
      if (!transport || !transport.running) return;

      processPendingSimulatorAction(transport, client);

      const nextSimStartMs = resolveSimStartMs(transport);
      if (nextSimStartMs !== simStartMs) {
        simStartMs = nextSimStartMs;
        resetFleetBatteryState(simStartMs);
        localVirtualElapsed = transport.virtualElapsedMs ?? localVirtualElapsed;
        accrualMs = 0;
      }

      const now = Date.now();
      const realDelta = now - lastPollAt;
      lastPollAt = now;

      if (typeof transport.virtualElapsedMs === 'number') {
        localVirtualElapsed = transport.virtualElapsedMs;
      }

      if (transport.transportPaused) {
        if (transport.stepNonce > lastStepNonce) {
          lastStepNonce = transport.stepNonce;
          localVirtualElapsed = transport.virtualElapsedMs;
          publishFleet(client, localVirtualElapsed, simStartMs);
          void ackTransportTick(localVirtualElapsed);
          flushPendingSimulatedEventAck(localVirtualElapsed);
        }
        return;
      }

      accrualMs += realDelta * transport.speedMultiplier;
      let advanced = false;
      while (accrualMs >= transport.tickMs) {
        accrualMs -= transport.tickMs;
        localVirtualElapsed += transport.tickMs;
        advanced = true;
        publishFleet(client, localVirtualElapsed, simStartMs);
      }
      if (advanced) {
        void ackTransportTick(localVirtualElapsed);
        flushPendingSimulatedEventAck(localVirtualElapsed);
      }
    }, POLL_MS);

    setInterval(() => {
      client.publish(
        'v1/vtms/dashboard/capacity/live',
        JSON.stringify({
          live_val: 1080 + Math.round(Math.sin(Date.now() / 10000) * 60),
          target_val: 1200,
          timestamp: Date.now(),
        }),
      );
    }, 2000);
  });

  client.on('error', (err) => {
    console.error('MQTT error:', err.message);
  });
}

main();
