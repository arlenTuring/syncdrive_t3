/**
 * 正線任務規格：與 seed-operation-routes.sql 的 sequence_order / node_id 對齊。
 * task_id 格式：{order_id}_{task_name}_{sequence}（sequence 為兩位數）
 *
 * 不含 STATION_ARRIVAL（進站減速由自動駕駛自行處理）。
 * PLATFORM_DOCKING / STATION_DEPARTURE 優先用地圖 DockingPoint 座標觸發；
 * 其餘任務依 current_leg 剩餘距離（distance_to_target_m）與靠站狀態觸發。
 */
const {
  loadOperationNodeRegistry,
  resolveNodeIdForRouteAction,
  distanceM,
} = require('./map-operation-nodes');
const { buildMainlineCurrentLeg } = require('./t3-v0-0-5-track-motion');

function taskId(orderId, taskName, sequence) {
  return `${orderId}_${taskName}_${String(sequence).padStart(2, '0')}`;
}

const VOICE_BROADCAST_MIN_DISTANCE_M = 150;
const DOCK_APPROACH_M = 25;
const AT_STATION_M = 3;

const ROUTE_MAINLINE_TASK_SPECS_BASE = {
  // seq 為「每張訂單全域遞增」的序號（依行進順序），確保 task_id 唯一。
  // 同一路線可有多個同類型動作（T3 與終點站各一次 PLATFORM_DOCKING），
  // 若用站內局部序號會產生重複 task_id。
  'ROUTE-MAINLINE-DOWN': [
    { type: 'PRE_DEPARTURE_BROADCAST', seq: 0, nodeId: 'ND-N2W-VOICE-01', station: 'N2W' },
    { type: 'STATION_DEPARTURE', seq: 1, nodeId: 'ND-N2W-DEP-01', station: 'N2W', mapAction: 'STATION_DEPARTURE' },
    { type: 'PLATFORM_DOCKING', seq: 2, nodeId: 'ND-T3-STOP-01', station: 'T3', mapAction: 'PLATFORM_DOCKING' },
    { type: 'OPEN_DOORS', seq: 3, nodeId: 'ND-T3-DOOR-01', station: 'T3' },
    { type: 'CLOSE_DOORS', seq: 4, nodeId: 'ND-T3-DOOR-01', station: 'T3' },
    { type: 'STATION_DEPARTURE', seq: 5, nodeId: 'ND-T3-DEP-01', station: 'T3' },
    { type: 'PLATFORM_DOCKING', seq: 6, nodeId: 'ND-S2W-STOP-01', station: 'S2W', mapAction: 'PLATFORM_DOCKING' },
  ],
  'ROUTE-MAINLINE-UP': [
    { type: 'PRE_DEPARTURE_BROADCAST', seq: 0, nodeId: 'ND-S2W-VOICE-01', station: 'S2W' },
    { type: 'STATION_DEPARTURE', seq: 1, nodeId: 'ND-S2W-DEP-01', station: 'S2W', mapAction: 'STATION_DEPARTURE' },
    { type: 'PLATFORM_DOCKING', seq: 2, nodeId: 'ND-T3-STOP-01', station: 'T3', mapAction: 'PLATFORM_DOCKING' },
    { type: 'OPEN_DOORS', seq: 3, nodeId: 'ND-T3-DOOR-01', station: 'T3' },
    { type: 'CLOSE_DOORS', seq: 4, nodeId: 'ND-T3-DOOR-01', station: 'T3' },
    { type: 'STATION_DEPARTURE', seq: 5, nodeId: 'ND-T3-DEP-01', station: 'T3' },
    { type: 'PLATFORM_DOCKING', seq: 6, nodeId: 'ND-N2W-STOP-01', station: 'N2W', mapAction: 'PLATFORM_DOCKING' },
  ],
};

const NODE_REGISTRY = loadOperationNodeRegistry();
const NODE_TRIGGER_RADIUS_M = 22;
const NODE_DONE_RADIUS_M = 10;

function resolveSpecsForRoute(routeId) {
  const base = ROUTE_MAINLINE_TASK_SPECS_BASE[routeId] ?? [];
  return base.map((spec) => {
    if (!spec.mapAction) return { ...spec };
    const fromMap = resolveNodeIdForRouteAction(
      NODE_REGISTRY,
      routeId,
      spec.station,
      spec.mapAction,
    );
    return fromMap ? { ...spec, nodeId: fromMap } : { ...spec };
  });
}

const ROUTE_MAINLINE_TASK_SPECS = {
  'ROUTE-MAINLINE-DOWN': resolveSpecsForRoute('ROUTE-MAINLINE-DOWN'),
  'ROUTE-MAINLINE-UP': resolveSpecsForRoute('ROUTE-MAINLINE-UP'),
};

function routeIdForTrip(tripCode) {
  const t = String(tripCode ?? '').trim().toUpperCase();
  if (t.startsWith('D')) return 'ROUTE-MAINLINE-DOWN';
  if (t.startsWith('U')) return 'ROUTE-MAINLINE-UP';
  return null;
}

function isOriginStation(routeId, station) {
  return routeId === 'ROUTE-MAINLINE-DOWN' ? station === 'N2W' : station === 'S2W';
}

function isAtStation(leg, station) {
  return (
    leg.target_station_id === station
    && (leg.distance_to_target_m ?? 999) <= AT_STATION_M
  );
}

function isApproachingStation(leg, station) {
  return (
    leg.target_station_id === station
    && (leg.distance_to_target_m ?? 999) <= DOCK_APPROACH_M
  );
}

function resolveTaskStatusFromMapNode(spec, motion, routeId, leg) {
  const mapKey = spec.mapAction
    ? `${routeId}|${spec.station}|${spec.mapAction}`
    : null;
  const node =
    (mapKey ? NODE_REGISTRY.byRouteStationAction.get(mapKey) : null)
    ?? NODE_REGISTRY.byId.get(spec.nodeId);

  if (node && typeof motion?.x === 'number' && typeof motion?.y === 'number') {
    const dist = distanceM(motion.x, motion.y, node.xM, node.yM);

    if (spec.type === 'PLATFORM_DOCKING') {
      if (motion.dwelling && String(motion.station ?? '').includes(spec.station)) {
        return 'COMPLETED';
      }
      if (dist <= NODE_DONE_RADIUS_M) return 'COMPLETED';
      if (dist <= NODE_TRIGGER_RADIUS_M) return 'IN_PROGRESS';
      if (isApproachingStation(leg, spec.station)) return 'IN_PROGRESS';
      return 'PENDING';
    }

    if (spec.type === 'STATION_DEPARTURE' && spec.mapAction) {
      if (motion.dwelling && dist <= NODE_TRIGGER_RADIUS_M) return 'IN_PROGRESS';
      if (!motion.dwelling && dist > NODE_TRIGGER_RADIUS_M) return 'COMPLETED';
      if (isAtStation(leg, spec.station) && motion.dwelling) return 'IN_PROGRESS';
      return 'PENDING';
    }
  }

  if (spec.type === 'PLATFORM_DOCKING') {
    if (motion.dwelling && String(motion.station ?? '').includes(spec.station)) {
      return 'COMPLETED';
    }
    if (isAtStation(leg, spec.station) && motion.dwelling) return 'COMPLETED';
    if (isApproachingStation(leg, spec.station)) return 'IN_PROGRESS';
    return 'PENDING';
  }

  if (spec.type === 'STATION_DEPARTURE' && spec.mapAction) {
    if (isAtStation(leg, spec.station) && motion.dwelling) return 'IN_PROGRESS';
    if (!motion.dwelling && leg.target_station_id !== spec.station) return 'COMPLETED';
    return 'PENDING';
  }

  return 'PENDING';
}

function resolveVoiceBroadcast(spec, motion, routeId, leg) {
  if (!isOriginStation(routeId, spec.station)) return 'PENDING';

  const node = NODE_REGISTRY.byId.get(spec.nodeId);
  if (node && typeof motion?.x === 'number' && typeof motion?.y === 'number' && motion.dwelling) {
    const dist = distanceM(motion.x, motion.y, node.xM, node.yM);
    if (dist <= NODE_TRIGGER_RADIUS_M) return 'IN_PROGRESS';
  }

  if (!motion.dwelling && (motion.progress ?? 0) > 0.01) return 'COMPLETED';

  if (
    motion.dwelling
    && leg.target_station_id === 'T3'
    && (leg.distance_to_target_m ?? 0) >= VOICE_BROADCAST_MIN_DISTANCE_M
  ) {
    return 'IN_PROGRESS';
  }
  return 'PENDING';
}

function doorOpenPercent(motion) {
  const raw = motion?.door_open_percent;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, raw));
  }
  const keys = ['door_fl_open_percent', 'door_fr_open_percent', 'door_rl_open_percent', 'door_rr_open_percent'];
  const vals = keys
    .map((k) => motion?.[k])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? Math.max(...vals) : 0;
}

function resolveOpenDoors(spec, motion, leg) {
  if (!isAtStation(leg, spec.station) || !motion.dwelling) return 'PENDING';
  const doorNode = NODE_REGISTRY.byId.get(spec.nodeId);
  if (doorNode && typeof motion?.x === 'number' && typeof motion?.y === 'number') {
    const dist = distanceM(motion.x, motion.y, doorNode.xM, doorNode.yM);
    if (dist > NODE_TRIGGER_RADIUS_M) return 'PENDING';
  }
  const pct = doorOpenPercent(motion);
  if (pct >= 85) return 'COMPLETED';
  if (pct > 5 || motion.dwelling) return 'IN_PROGRESS';
  return 'PENDING';
}

function resolveCloseDoors(spec, motion, leg) {
  const pct = doorOpenPercent(motion);
  if (!isAtStation(leg, spec.station)) {
    if (!motion.dwelling && leg.target_station_id !== spec.station && pct <= 10) {
      return 'COMPLETED';
    }
    return 'PENDING';
  }
  if (!motion.dwelling && pct <= 10) return 'COMPLETED';
  if (motion.dwelling && pct <= 10) return 'COMPLETED';
  if (motion.dwelling && pct < 85) return 'IN_PROGRESS';
  return 'PENDING';
}

function resolveGenericStationDeparture(spec, motion, leg) {
  if (isAtStation(leg, spec.station) && motion.dwelling) return 'IN_PROGRESS';
  if (!motion.dwelling && leg.target_station_id !== spec.station) return 'COMPLETED';
  return 'PENDING';
}

function resolveTaskStatus(spec, motion, tripCode, routeId, leg, priorAllCompleted) {
  if (!priorAllCompleted) return 'PENDING';

  if (spec.mapAction) {
    return resolveTaskStatusFromMapNode(spec, motion, routeId, leg);
  }

  switch (spec.type) {
    case 'PRE_DEPARTURE_BROADCAST':
      return resolveVoiceBroadcast(spec, motion, routeId, leg);
    case 'OPEN_DOORS':
      return resolveOpenDoors(spec, motion, leg);
    case 'CLOSE_DOORS':
      return resolveCloseDoors(spec, motion, leg);
    case 'STATION_DEPARTURE':
      return resolveGenericStationDeparture(spec, motion, leg);
    default:
      return 'PENDING';
  }
}

function buildTaskGroup(orderId, tripCode, motion, options = {}) {
  const routeId = routeIdForTrip(tripCode);
  if (!routeId) return [];
  const specs = ROUTE_MAINLINE_TASK_SPECS[routeId] ?? [];
  const leg = buildMainlineCurrentLeg(tripCode, motion.progress ?? 0);
  const now = Date.now();
  const statuses = [];

  const tasks = specs.map((spec, index) => {
    const priorAllCompleted = specs
      .slice(0, index)
      .every((_, j) => statuses[j] === 'COMPLETED');
    const status = resolveTaskStatus(
      spec,
      motion,
      tripCode,
      routeId,
      leg,
      priorAllCompleted,
    );
    statuses.push(status);
    const id = taskId(orderId, spec.type, spec.seq);
    return {
      task_id: id,
      task_name: spec.type,
      task_params: { node_id: spec.nodeId },
      status,
      actual_start_time: status !== 'PENDING' ? now - 3000 : null,
      actual_end_time: status === 'COMPLETED' ? now : null,
      note: status === 'IN_PROGRESS' && spec.type === 'ACQUIRE_INTERLOCK' ? 'Waiting for traffic light' : '',
    };
  });

  if (!options.interlockActive) return tasks;

  const without = tasks.filter((t) => t.task_name !== 'ACQUIRE_INTERLOCK');
  const interlockTask = {
    task_id: taskId(orderId, 'ACQUIRE_INTERLOCK', 50),
    task_name: 'ACQUIRE_INTERLOCK',
    task_params: { node_id: 'ND-T3-INTERLOCK', junction_id: 'J-T3-01' },
    status: 'IN_PROGRESS',
    actual_start_time: now - 2000,
    actual_end_time: null,
    note: 'Waiting for traffic light',
  };
  const dockIdx = without.findIndex((t) => t.task_name === 'PLATFORM_DOCKING' && t.status === 'PENDING');
  if (dockIdx >= 0) {
    return [...without.slice(0, dockIdx), interlockTask, ...without.slice(dockIdx)];
  }
  return [...without, interlockTask];
}

/** 儀表板作動圖示：進站 / 出站（進站由 PLATFORM_DOCKING 代表，不含 STATION_ARRIVAL） */
function deriveOperationActionFromTaskGroup(taskGroup) {
  if (!Array.isArray(taskGroup)) return null;
  const active = taskGroup.filter((t) => String(t?.status ?? '').toUpperCase() === 'IN_PROGRESS');
  if (active.some((t) => t.task_name === 'STATION_DEPARTURE')) return 'exit';
  if (active.some((t) => t.task_name === 'PLATFORM_DOCKING')) return 'enter';
  return null;
}

module.exports = {
  ROUTE_MAINLINE_TASK_SPECS,
  ROUTE_MAINLINE_TASK_SPECS_BASE,
  NODE_REGISTRY,
  routeIdForTrip,
  taskId,
  buildTaskGroup,
  deriveOperationActionFromTaskGroup,
};
