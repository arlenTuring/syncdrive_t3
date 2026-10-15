import {
  CATEGORY_ORDER,
  displayPath,
  EXPECTED_TOP_FIELDS,
  resolveField,
  valueLabel,
  type FieldCategory,
} from "./fieldLabels";
import type { ReplayFrame, ReplayState } from "./replayState";

/**
 * 車輛資料面板的內容（純函式）：游標當下這台車每個串流的最後一筆，全部欄位攤開分類。
 *
 * 只用游標之前保存的資料；沒有就說沒有、說原因，不拿即時資料或目前狀態補。
 */
export type ValueKind =
  | "missing"
  | "null"
  | "empty-string"
  | "empty-array"
  | "empty-object"
  | "boolean"
  | "number"
  | "string"
  | "object"
  | "array";

export type FieldNode = {
  id: string;
  stream: string;
  /** 原始路徑（含陣列索引），一律顯示 */
  path: string;
  /** 中文名稱；null＝尚無中文對照 */
  label: string | null;
  unit?: string;
  kind: ValueKind;
  value: unknown;
  /** 列舉值的中文（與原值並列） */
  valueText: string | null;
  children: FieldNode[];
};

export type PanelSection = { category: FieldCategory; nodes: FieldNode[] };

export type StreamStatus = {
  stream: string;
  label: string;
  frame: ReplayFrame | null;
  /** 游標時刻 − 這筆在回放時間軸上的時刻 */
  ageMs: number | null;
  stale: boolean;
  /** 沒有資料或資料過期的原因 */
  note: string | null;
};

export const PANEL_STREAMS: ReadonlyArray<{ stream: string; label: string }> = [
  { stream: "telemetry", label: "遙測" },
  { stream: "operation", label: "營運狀態" },
  { stream: "health", label: "健康" },
  { stream: "event", label: "最近事件" },
  { stream: "command_ack", label: "最近指令回應" },
];

/** 健康內容沒變時降頻保存：判斷過期要把保存間隔算進去，不然會誤判 */
export function streamStatuses(
  state: ReplayState | null,
  vehicleCode: string,
  cursorT: number | null,
  staleAfterMs: number,
  options: { healthKeepaliveMs?: number; hiddenReason?: "stale" | "gap" | null } = {},
): StreamStatus[] {
  return PANEL_STREAMS.map(({ stream, label }) => {
    const frame = state?.byKey.get(`${stream}|${vehicleCode}`) ?? null;
    if (!frame || cursorT == null) {
      return {
        stream,
        label,
        frame: null,
        ageMs: null,
        stale: false,
        note:
          stream === "event" || stream === "command_ack"
            ? "游標之前沒有保存這台車的此類訊息"
            : "游標之前沒有保存這台車的此串流資料（當時未錄製、車輛未回報或不在回放時段內）",
      };
    }
    const ageMs = Math.max(0, cursorT - frame.t);
    const threshold =
      stream === "health" ? staleAfterMs + (options.healthKeepaliveMs ?? 0) : staleAfterMs;
    const continuous = stream === "telemetry" || stream === "operation" || stream === "health";
    const stale = continuous && ageMs > threshold;
    let note: string | null = null;
    if (stale) note = `已 ${Math.round(ageMs / 1000)} 秒沒有新資料（超過 ${Math.round(threshold / 1000)} 秒判定過期），以下是最後保存的內容`;
    if (stream === "telemetry" && options.hiddenReason === "gap")
      note = "最後一筆在資料缺段之前，缺段期間位置不明，地圖不顯示";
    return { stream, label, frame, ageMs, stale, note };
  });
}

function kindOf(value: unknown): ValueKind {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? "empty-string" : "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return value.length === 0 ? "empty-array" : "array";
  if (typeof value === "object") return Object.keys(value as object).length === 0 ? "empty-object" : "object";
  return "string";
}

function buildNode(stream: string, path: (string | number)[], value: unknown, idPrefix: string): FieldNode {
  const resolved = resolveField(stream, path);
  const kind = kindOf(value);
  const children: FieldNode[] = [];
  if (kind === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>))
      children.push(buildNode(stream, [...path, key], child, idPrefix));
  } else if (kind === "array") {
    (value as unknown[]).forEach((child, index) => children.push(buildNode(stream, [...path, index], child, idPrefix)));
  }
  const last = path.at(-1);
  // 陣列元素：沒有個別名稱時以「第 n 項」稱呼，內容是物件時帶上任務名稱或 ID 方便辨認
  let label = resolved.label;
  if (typeof last === "number") {
    const item = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    const hint = item ? (item.task_name ?? item.task_id ?? item.action_id ?? item.station_id ?? null) : null;
    label = `${resolved.label ?? "項目"}・第 ${last + 1} 項${hint != null ? `（${String(hint)}）` : ""}`;
  }
  return {
    id: `${idPrefix}:${displayPath(path)}`,
    stream,
    path: displayPath(path),
    label,
    unit: resolved.unit,
    kind,
    value,
    valueText: valueLabel(path, value),
    children,
  };
}

/** 一筆資料的 payload → 依分類放的欄位樹（含文件規定但這筆沒有的欄位） */
function framesToSections(entries: Array<{ frame: ReplayFrame; idPrefix: string }>): Map<FieldCategory, FieldNode[]> {
  const byCategory = new Map<FieldCategory, FieldNode[]>();
  const push = (category: FieldCategory, node: FieldNode) => {
    const list = byCategory.get(category) ?? [];
    list.push(node);
    byCategory.set(category, list);
  };
  for (const { frame, idPrefix } of entries) {
    const payload = frame.payload ?? {};
    for (const [key, value] of Object.entries(payload)) {
      push(resolveField(frame.stream, [key]).category, buildNode(frame.stream, [key], value, idPrefix));
    }
    for (const key of EXPECTED_TOP_FIELDS[frame.stream] ?? []) {
      if (key in payload) continue;
      push(resolveField(frame.stream, [key]).category, buildNode(frame.stream, [key], undefined, idPrefix));
    }
    // 後端判定的位置（衍生資料）：與車端原始內容分開標示
    const derived = frame.derived && typeof frame.derived === "object" ? frame.derived : null;
    if (derived && "location" in derived) {
      const node = buildNode("derived", ["location"], derived.location, `${idPrefix}:derived`);
      node.label = "後端判定位置（衍生，非車端原始欄位）";
      push("pose", node);
    }
  }
  return byCategory;
}

/**
 * 面板分類內容：遙測、營運、健康、事件、指令回應，加上目前訂單與站點動作（保存的變更紀錄）。
 */
export function buildPanelSections(state: ReplayState | null, vehicleCode: string): PanelSection[] {
  if (!state) return [];
  const entries: Array<{ frame: ReplayFrame; idPrefix: string }> = [];
  for (const { stream } of PANEL_STREAMS) {
    const frame = state.byKey.get(`${stream}|${vehicleCode}`);
    if (frame) entries.push({ frame, idPrefix: stream });
  }
  const operation = state.byKey.get(`operation|${vehicleCode}`);
  const orderId = typeof operation?.payload.order_id === "string" ? operation.payload.order_id : null;
  if (orderId) {
    const order = state.byKey.get(`order|${orderId}`) ?? state.orders.get(orderId);
    if (order) entries.push({ frame: order, idPrefix: "order" });
  }
  const sections = framesToSections(entries);
  if (orderId) {
    const actions = [...state.byKey.values()]
      .filter((frame) => frame.stream === "order_action" && frame.order_id === orderId)
      .sort((a, b) => String(a.payload.action_id ?? "").localeCompare(String(b.payload.action_id ?? "")));
    if (actions.length) {
      const list = sections.get("tasks") ?? [];
      actions.forEach((frame, index) => {
        const node = buildNode("order_action", [], frame.payload, `order_action:${frame.stream_key ?? index}`);
        node.label = `站點動作・${String(frame.payload.action_type ?? frame.payload.action_id ?? index + 1)}`;
        node.path = frame.stream_key ?? `order_action[${index}]`;
        list.push(node);
      });
      sections.set("tasks", list);
    }
  }
  return CATEGORY_ORDER.map((category) => ({ category, nodes: sections.get(category) ?? [] }));
}

/** 搜尋：名稱、原始路徑、值有包含關鍵字的欄位（連同它的上層）才留下 */
export function filterNodes(nodes: readonly FieldNode[], query: string): FieldNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];
  const out: FieldNode[] = [];
  for (const node of nodes) {
    const children = filterNodes(node.children, query);
    const self =
      (node.label ?? "").toLowerCase().includes(needle) ||
      node.path.toLowerCase().includes(needle) ||
      (node.kind !== "object" && node.kind !== "array" && String(node.value ?? "").toLowerCase().includes(needle)) ||
      (node.valueText ?? "").toLowerCase().includes(needle);
    if (self) out.push(node);
    else if (children.length) out.push({ ...node, children });
  }
  return out;
}

export function countLeaves(nodes: readonly FieldNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.children.length ? countLeaves(node.children) : 1), 0);
}
