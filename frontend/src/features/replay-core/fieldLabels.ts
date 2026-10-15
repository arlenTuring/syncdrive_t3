/**
 * 車輛資料面板的欄位對照：中文名稱、單位、分類。
 *
 * 依據既有介接文件（《車輛動態協議》《營運任務狀態協議》《設備健康與異常告警協議》
 * 《動態控制與特殊事件協議》）。這裡只是顯示用的對照，不新增、不改寫車端欄位；
 * 對照不到的欄位照原始路徑顯示並標「尚無中文對照」，一個都不丟。
 *
 * 路徑寫法：物件以「.」連接，陣列元素以「[]」代表（task_group[].status）。
 */
export type FieldCategory =
  | "basic"
  | "pose"
  | "motion"
  | "actuation"
  | "energy"
  | "operation"
  | "leg"
  | "tasks"
  | "health"
  | "events"
  | "other";

export const CATEGORY_ORDER: readonly FieldCategory[] = [
  "basic",
  "pose",
  "motion",
  "actuation",
  "energy",
  "operation",
  "leg",
  "tasks",
  "health",
  "events",
  "other",
];

export const CATEGORY_LABEL: Record<FieldCategory, string> = {
  basic: "基本與時間",
  pose: "位置與姿態",
  motion: "運動",
  actuation: "操控回饋",
  energy: "電力與燈號",
  operation: "營運與班次",
  leg: "當前路段",
  tasks: "任務動作（task_group）",
  health: "健康",
  events: "相關事件／指令",
  other: "其他欄位",
};

type FieldInfo = { label: string; unit?: string; category: FieldCategory };

const f = (label: string, category: FieldCategory, unit?: string): FieldInfo => ({ label, category, unit });

/** 各串流的已知欄位（精確路徑） */
export const FIELD_LABELS: Record<string, Record<string, FieldInfo>> = {
  telemetry: {
    vehicle_code: f("車號", "basic"),
    timestamp: f("車端資料時間", "basic", "Unix ms"),
    global_pose: f("全域定位", "pose"),
    "global_pose.latitude": f("緯度（WGS84）", "pose", "度"),
    "global_pose.longitude": f("經度（WGS84）", "pose", "度"),
    "global_pose.altitude": f("海拔高度", "pose", "m"),
    local_pose: f("場域座標與姿態", "pose"),
    "local_pose.position": f("場域座標", "pose"),
    "local_pose.position.x": f("場域座標 X", "pose", "m"),
    "local_pose.position.y": f("場域座標 Y", "pose", "m"),
    "local_pose.position.z": f("場域座標 Z", "pose", "m"),
    "local_pose.orientation": f("姿態四元數", "pose"),
    "local_pose.orientation.w": f("四元數 w", "pose"),
    "local_pose.orientation.x": f("四元數 x", "pose"),
    "local_pose.orientation.y": f("四元數 y", "pose"),
    "local_pose.orientation.z": f("四元數 z", "pose"),
    "local_pose.heading": f("車頭朝向角", "pose", "rad"),
    kinematics: f("運動學", "motion"),
    "kinematics.velocity": f("縱向速度", "motion", "m/s"),
    "kinematics.acceleration": f("加速度", "motion", "m/s²"),
    "kinematics.angular_velocity": f("角速度", "motion", "rad/s"),
    prediction: f("自駕規劃預測", "motion"),
    "prediction.path": f("預測路徑點", "motion"),
    "prediction.path[]": f("路徑點", "motion"),
    "prediction.path[].x": f("X", "motion", "m"),
    "prediction.path[].y": f("Y", "motion", "m"),
    actuation_feedback: f("線控回饋", "actuation"),
    "actuation_feedback.throttle": f("油門／動力輸出", "actuation", "%"),
    "actuation_feedback.brake": f("煞車／制動輸出", "actuation", "%"),
    "actuation_feedback.steering_angle": f("前輪實際轉角", "actuation", "rad"),
    "actuation_feedback.gear": f("檔位", "actuation"),
    energy: f("能源", "energy"),
    "energy.battery_level": f("電池電量（SoC）", "energy", "%"),
    signals: f("燈號", "energy"),
    "signals.turn_indicator": f("方向燈", "energy"),
    "signals.hazard_light": f("雙黃警示燈", "energy"),
  },
  operation: {
    vehicle_code: f("車號", "basic"),
    timestamp: f("車端資料時間", "basic", "Unix ms"),
    order_id: f("訂單號", "operation"),
    trip_code: f("班次代碼", "operation"),
    vehicle_phase: f("車輛階段", "operation"),
    current_leg: f("當前路段", "leg"),
    "current_leg.target_station_id": f("目標停靠點", "leg"),
    "current_leg.distance_to_target_m": f("距目標停靠點", "leg", "m"),
    "current_leg.eta_seconds": f("預估抵達（車端推算）", "leg", "秒"),
    task_group: f("任務群組", "tasks"),
    "task_group[]": f("任務", "tasks"),
    "task_group[].task_id": f("任務 ID", "tasks"),
    "task_group[].task_name": f("任務行為", "tasks"),
    "task_group[].task_params": f("節點參數", "tasks"),
    "task_group[].task_params.node_id": f("節點 ID", "tasks"),
    "task_group[].status": f("任務狀態", "tasks"),
    "task_group[].actual_start_time": f("實際開始", "tasks", "Unix ms"),
    "task_group[].actual_end_time": f("實際結束", "tasks", "Unix ms"),
    "task_group[].note": f("備註", "tasks"),
  },
  health: {
    vehicle_code: f("車號", "basic"),
    timestamp: f("車端資料時間", "basic", "Unix ms"),
    overall_health: f("整機健康總評", "health"),
    subsystems: f("子系統", "health"),
    "subsystems.COMPUTING": f("運算模組", "health"),
    "subsystems.COMPUTING.status": f("運算模組狀態", "health"),
    "subsystems.COMPUTING.error_codes": f("運算模組錯誤碼", "health"),
    "subsystems.SENSING": f("感測模組", "health"),
    "subsystems.SENSING.status": f("感測模組狀態", "health"),
    "subsystems.SENSING.error_codes": f("感測模組錯誤碼", "health"),
    "subsystems.COMMUNICATION": f("通訊模組", "health"),
    "subsystems.COMMUNICATION.status": f("通訊模組狀態", "health"),
    "subsystems.COMMUNICATION.error_codes": f("通訊模組錯誤碼", "health"),
    "subsystems.CHASSIS": f("線控與底盤", "health"),
    "subsystems.CHASSIS.status": f("線控與底盤狀態", "health"),
    "subsystems.CHASSIS.error_codes": f("線控與底盤錯誤碼", "health"),
  },
  event: {
    event_id: f("事件編號", "events"),
    vehicle_code: f("車號", "events"),
    timestamp: f("車端事件時間", "events", "Unix ms"),
    event_code: f("事件代碼", "events"),
    severity: f("嚴重度", "events"),
    location: f("事件位置", "events"),
    "location.lat": f("緯度", "events", "度"),
    "location.lng": f("經度", "events", "度"),
    detail: f("說明", "events"),
    params: f("事件參數", "events"),
  },
  command_ack: {
    command_id: f("指令編號", "events"),
    vehicle_code: f("車號", "events"),
    timestamp: f("車端回應時間", "events", "Unix ms"),
    action: f("指令動作", "events"),
    status: f("回應狀態", "events"),
    result: f("回應結果", "events"),
    reason: f("原因", "events"),
  },
  order: {
    order_id: f("訂單號", "operation"),
    trip_code: f("班次代碼", "operation"),
    vehicle_code: f("指派車輛", "operation"),
    status: f("訂單契約狀態", "operation"),
    line_kind: f("路線類型", "operation"),
    route_id: f("路線 ID", "operation"),
    priority_level: f("優先權", "operation"),
    planned_start: f("計畫開始", "operation", "Unix ms"),
    planned_end: f("計畫結束", "operation", "Unix ms"),
    delay_minutes: f("延誤", "operation", "分"),
    plan_shift_id: f("計畫班次 ID", "operation"),
    plan_digest: f("計畫摘要碼", "operation"),
    plan_trip_code: f("計畫班次代碼", "operation"),
    plan_block_id: f("計畫車次區塊", "operation"),
    plan_run_id: f("計畫輪次", "operation"),
    transition_purpose: f("調度用途", "operation"),
    transition_facility: f("調度設施", "operation"),
    created_at: f("建立時間", "operation", "Unix ms"),
    completed_at: f("完成時間", "operation", "Unix ms"),
    origin: f("起點", "operation"),
    destination: f("終點", "operation"),
    route_name: f("路線", "operation"),
    stations: f("站序", "operation"),
    vehicle_phase: f("最後回報階段", "operation"),
    actual_started_at: f("實際開始", "operation", "Unix ms"),
    op_started_at: f("營運開始", "operation", "Unix ms"),
    op_completed_at: f("營運完成", "operation", "Unix ms"),
    vehicle_progress_at: f("各階段回報時刻", "operation"),
    cancel_requested_at: f("要求取消時刻", "operation", "Unix ms"),
    closed_reason: f("結案原因", "operation"),
    vehicle_fault: f("車輛異常", "operation"),
    operating_day: f("營運日", "operation"),
    change: f("本次變更", "operation"),
  },
  order_action: {
    action_id: f("動作 ID", "tasks"),
    order_id: f("訂單號", "tasks"),
    station_id: f("停靠點", "tasks"),
    action_type: f("動作類型", "tasks"),
    action_status: f("動作狀態", "tasks"),
    node_id: f("節點 ID", "tasks"),
    trigger_offset_m: f("觸發距離", "tasks", "m"),
    actual_start_time: f("實際開始", "tasks", "Unix ms"),
    actual_end_time: f("實際結束", "tasks", "Unix ms"),
    note: f("備註", "tasks"),
    change: f("本次變更", "tasks"),
  },
};

/** 已知前綴的分類（精確對照不到時，至少放進對的分類） */
const PREFIX_CATEGORY: Array<[string, FieldCategory]> = [
  ["global_pose", "pose"],
  ["local_pose", "pose"],
  ["kinematics", "motion"],
  ["prediction", "motion"],
  ["actuation_feedback", "actuation"],
  ["energy", "energy"],
  ["signals", "energy"],
  ["current_leg", "leg"],
  ["task_group", "tasks"],
  ["subsystems", "health"],
];

/** 一般路徑（task_group.0.status）→ 對照用路徑（task_group[].status） */
export function patternPath(path: readonly (string | number)[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += "[]";
    else out += out ? `.${part}` : part;
  }
  return out;
}

export function displayPath(path: readonly (string | number)[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${part}` : part;
  }
  return out;
}

export type ResolvedField = { label: string | null; unit?: string; category: FieldCategory };

/** 欄位的中文名稱、單位、分類；label＝null 代表尚無中文對照 */
export function resolveField(stream: string, path: readonly (string | number)[]): ResolvedField {
  const pattern = patternPath(path);
  const known = FIELD_LABELS[stream]?.[pattern];
  if (known) return { label: known.label, unit: known.unit, category: known.category };
  const top = typeof path[0] === "string" ? path[0] : "";
  const byPrefix = PREFIX_CATEGORY.find(([prefix]) => top === prefix)?.[1];
  const streamCategory: FieldCategory | undefined =
    stream === "health" ? "health" : stream === "event" || stream === "command_ack" ? "events" : stream === "order_action" ? "tasks" : stream === "order" ? "operation" : undefined;
  return { label: null, category: byPrefix ?? streamCategory ?? "other" };
}

/** 文件規定、這筆卻沒有的欄位（顯示「缺少」，與 null／空值區分） */
export const EXPECTED_TOP_FIELDS: Record<string, readonly string[]> = {
  telemetry: ["vehicle_code", "timestamp", "global_pose", "local_pose", "kinematics", "actuation_feedback", "energy", "signals", "prediction"],
  operation: ["vehicle_code", "timestamp", "order_id", "trip_code", "vehicle_phase", "current_leg", "task_group"],
  health: ["vehicle_code", "timestamp", "overall_health", "subsystems"],
};

/** 列舉值的中文（顯示在原值旁邊，不取代原值） */
export const VALUE_LABELS: Record<string, Record<string, string>> = {
  "actuation_feedback.gear": { P: "駐車", R: "倒車", N: "空檔", D: "前進" },
  "signals.turn_indicator": { NONE: "無", LEFT: "左轉", RIGHT: "右轉" },
  overall_health: { OK: "正常", WARNING: "警告", ERROR: "錯誤", OFFLINE: "離線" },
  "task_group[].status": { PENDING: "未抵達節點", IN_PROGRESS: "執行中", COMPLETED: "已完成", FAILED: "失敗" },
  "task_group[].task_name": {
    PRE_DEPARTURE_BROADCAST: "發車前語音",
    CLOSE_DOORS: "關門",
    STATION_DEPARTURE: "發車出站",
    PLATFORM_DOCKING: "精準對位停靠",
    OPEN_DOORS: "開門",
  },
  severity: { INFO: "資訊", WARNING: "警告", CRITICAL: "嚴重" },
};

export function valueLabel(path: readonly (string | number)[], value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pattern = patternPath(path);
  const table = VALUE_LABELS[pattern] ?? (pattern.startsWith("subsystems.") && pattern.endsWith(".status") ? VALUE_LABELS.overall_health : undefined);
  return table?.[value] ?? null;
}
