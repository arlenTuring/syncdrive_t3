/**
 * 整備任務顯示目錄（DISPATCH_PREP / line_kind=MAINTENANCE）
 * 車輛監控卡右上角徽章文字與配色由此解析，前端只讀 operation 欄位。
 */

const TASK_DEFS = {
  charge: {
    maint_type_label: '充電',
    maint_type_bg: '#422006',
    maint_type_color: '#fdba74',
    icon_bg_color: '#0284c7',
    progress_marker_icon: 'Zap',
  },
  park: {
    maint_type_label: '臨停',
    maint_type_bg: '#27272a',
    maint_type_color: '#a1a1aa',
    icon_bg_color: '#64748b',
    progress_marker_icon: 'CircleParking',
  },
  wash: {
    maint_type_label: '洗車',
    maint_type_bg: '#422006',
    maint_type_color: '#fdba74',
    icon_bg_color: '#0284c7',
    progress_marker_icon: 'Droplets',
  },
  maintenance: {
    maint_type_label: '整備',
    maint_type_bg: '#422006',
    maint_type_color: '#fdba74',
    icon_bg_color: '#0284c7',
    progress_marker_icon: 'ClipboardCheck',
  },
  service: {
    maint_type_label: '保養',
    maint_type_bg: '#422006',
    maint_type_color: '#fdba74',
    icon_bg_color: '#0284c7',
    progress_marker_icon: 'ClipboardCheck',
  },
};

/** yard_slot_id 首碼 → 任務類型鍵（可被 fleet_task 覆寫） */
const SLOT_PREFIX_TASK = {
  E: 'charge',
  P: 'park',
  W: 'wash',
  H: 'maintenance',
  M: 'service',
};

const FLEET_TASK_ALIAS = {
  shift_run: null,
  charge: 'charge',
  charge_queue: 'charge',
  park: 'park',
  maintenance: 'maintenance',
  standby: 'park',
};

function slotTaskKey(yardSlotId) {
  if (!yardSlotId || typeof yardSlotId !== 'string') return null;
  const prefix = yardSlotId.replace(/[0-9].*$/, '').toUpperCase();
  return SLOT_PREFIX_TASK[prefix] ?? null;
}

function resolveTaskKey({ fleet_task: fleetTask, yard_slot_id: yardSlotId }) {
  const fromFleet = fleetTask ? FLEET_TASK_ALIAS[fleetTask] : undefined;
  if (fromFleet === null) return null;
  if (typeof fromFleet === 'string') return fromFleet;
  return slotTaskKey(yardSlotId) ?? 'maintenance';
}

/**
 * @returns {null | Record<string, unknown>}
 */
function resolveMaintenanceTaskMeta(motion = {}) {
  const taskKey = resolveTaskKey(motion);
  if (!taskKey) return null;
  const def = TASK_DEFS[taskKey] ?? TASK_DEFS.maintenance;
  const charging = motion.fleet_task === 'charge' || motion.fleet_task === 'charge_queue';
  return {
    priority_level: 40,
    line_kind: 'MAINTENANCE',
    order_status: charging ? 'PROCESSING' : 'PENDING',
    maint_type_label: def.maint_type_label,
    maint_type_bg: def.maint_type_bg,
    maint_type_color: def.maint_type_color,
    icon_bg_color: def.icon_bg_color,
    progress_marker_icon: def.progress_marker_icon,
    task_key: taskKey,
  };
}

function maintenanceTripCode(motion, meta) {
  const slot = motion.yard_slot_id;
  if (typeof slot === 'string' && slot.length > 0) {
    return `S${slot.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase().padEnd(4, '0')}`;
  }
  const key = meta.task_key ?? 'maint';
  return `S${key.slice(0, 4).toUpperCase().padEnd(4, '0')}`;
}

module.exports = {
  TASK_DEFS,
  resolveMaintenanceTaskMeta,
  maintenanceTripCode,
};
