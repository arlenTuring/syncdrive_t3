import type {
  AlertRule,
  ChartAxisBandConfig,
  ChildWidget,
  LineChartSeriesConfig,
  RouteActionIconRule,
  SlotStatusColorRule,
  StatusBadgeRule,
  WidgetType,
} from '../types';

export type WidgetFormatSnapshot = {
  sourceType: WidgetType;
  data: Record<string, unknown>;
};

const LAYOUT_PRESERVE = new Set(['id', 'x', 'y', 'type']);

/** 貼格式時保留目標元件的語意文字（標籤文案、內文等） */
const CONTENT_PRESERVE: Partial<Record<WidgetType, readonly string[]>> = {
  text: ['content'],
  'stat-card': ['label'],
  image: ['src'],
  database: ['title'],
  'line-chart': ['title'],
  gauge: ['title'],
  'slot-grid': ['title'],
  'maintenance-distribution': ['title'],
  'segment-bar': ['title'],
  'bar-chart': ['title'],
  'empty-state': ['label', 'subLabel'],
  'progress-bar': ['label'],
  'alert-banner': ['content'],
  'route-progress': ['stations'],
  'map-canvas': ['mapId'],
};

/** 明確列出的資料綁定鍵（補充命名規則 isBindingKey） */
const BINDING_PRESERVE = new Set([
  'dataUrl',
  'dataSourceId',
  'sqlQuery',
  'mqttDataSourceId',
  'mqttTopic',
  'mqttValuePath',
  'refreshInterval',
  'mqttProgressPath',
  'mqttTelemetryTopic',
  'mqttHealthTopic',
  'mqttHealthDataSourceId',
  'mqttOperationTopic',
  'stationSource',
  'actionIconRules',
  'statusColorRules',
  'iteratorField',
  'variableName',
  'slotKeyField',
  'activeValues',
  'triggerField',
  'triggerMode',
  'triggerValue',
]);

/** 由專用 strip/merge 處理（不走 isBindingKey 短路） */
const NESTED_FORMAT_ARRAY_KEYS = new Set([
  'actionIconRules',
  'statusColorRules',
  'triggerConditions',
  'rules',
  'series',
  'axisBands',
]);

/** 含 DB 狀態／門檻對照，整包不複製 */
const SKIP_FORMAT_KEYS = new Set(['colorRules']);

function isBindingKey(key: string): boolean {
  if (BINDING_PRESERVE.has(key)) return true;
  if (NESTED_FORMAT_ARRAY_KEYS.has(key)) return false;
  if (SKIP_FORMAT_KEYS.has(key)) return true;
  // 範例數值動畫／同步（會覆蓋 SQL 顯示，屬行為非視覺格式）
  if (/^demo[A-Z]/.test(key)) return true;
  if (/VarKey$/.test(key)) return true;
  if (/Fields$/.test(key)) return true;
  if (/Field$/.test(key)) return true;
  return false;
}

const SERIES_FORMAT_KEYS = [
  'label',
  'color',
  'strokeWidth',
  'eventLabelsEnabled',
  'eventLabelStyle',
] as const satisfies readonly (keyof LineChartSeriesConfig)[];

const AXIS_BAND_FORMAT_KEYS = [
  'colorRules',
  'defaultColor',
  'thickness',
  'opacity',
] as const satisfies readonly (keyof ChartAxisBandConfig)[];

const TRIGGER_FORMAT_KEYS = [
  'content',
  'textColor',
  'backgroundColor',
  'borderColor',
  'displayMode',
  'endEnabled',
] as const satisfies readonly (keyof AlertRule)[];

const BADGE_RULE_FORMAT_KEYS = [
  'label',
  'bgColor',
  'textColor',
] as const satisfies readonly (keyof StatusBadgeRule)[];

const ACTION_ICON_FORMAT_KEYS = [
  'label',
  'iconFile',
  'priority',
] as const satisfies readonly (keyof RouteActionIconRule)[];

const SLOT_STATUS_COLOR_FORMAT_KEYS = [
  'bgColor',
  'textColor',
] as const satisfies readonly (keyof SlotStatusColorRule)[];

function pickKeys<T extends object>(obj: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function stripSeriesBindings(series: LineChartSeriesConfig[]): Partial<LineChartSeriesConfig>[] {
  return series.map(s => pickKeys(s, SERIES_FORMAT_KEYS));
}

function mergeSeriesBindings(
  target: LineChartSeriesConfig[] | undefined,
  format: Partial<LineChartSeriesConfig>[],
): LineChartSeriesConfig[] {
  const base = target ?? [];
  if (format.length === 0) return base;
  return base.map((item, i) => {
    const patch = format.find(s => s.id === item.id) ?? format[i];
    return patch ? { ...item, ...pickKeys(patch, SERIES_FORMAT_KEYS) } : item;
  });
}

function stripAxisBandBindings(bands: ChartAxisBandConfig[]): Partial<ChartAxisBandConfig>[] {
  return bands.map(b => pickKeys(b, AXIS_BAND_FORMAT_KEYS));
}

function mergeAxisBandBindings(
  target: ChartAxisBandConfig[] | undefined,
  format: Partial<ChartAxisBandConfig>[],
): ChartAxisBandConfig[] {
  const base = target ?? [];
  if (format.length === 0) return base;
  return base.map((item, i) => {
    const patch = format[i];
    return patch ? { ...item, ...pickKeys(patch, AXIS_BAND_FORMAT_KEYS) } : item;
  });
}

function stripTriggerBindings(rules: AlertRule[]): Partial<AlertRule>[] {
  return rules.map(r => pickKeys(r, TRIGGER_FORMAT_KEYS));
}

function mergeTriggerBindings(
  target: AlertRule[] | undefined,
  format: Partial<AlertRule>[],
): AlertRule[] {
  const base = target ?? [];
  if (format.length === 0) return base;
  return base.map((item, i) => {
    const patch = format.find(r => r.id === item.id) ?? format[i];
    return patch ? { ...item, ...pickKeys(patch, TRIGGER_FORMAT_KEYS) } : item;
  });
}

function stripStatusBadgeRuleBindings(rules: StatusBadgeRule[]): Partial<StatusBadgeRule>[] {
  return rules.map(r => pickKeys(r, BADGE_RULE_FORMAT_KEYS));
}

function mergeStatusBadgeRules(
  target: StatusBadgeRule[] | undefined,
  format: Partial<StatusBadgeRule>[],
): StatusBadgeRule[] {
  const base = target ?? [];
  if (format.length === 0) return base;
  return base.map((item, i) => {
    const patch = format[i];
    return patch ? { ...item, ...pickKeys(patch, BADGE_RULE_FORMAT_KEYS) } : item;
  });
}

function stripActionIconRules(rules: RouteActionIconRule[]): Partial<RouteActionIconRule>[] {
  return rules.map(r => pickKeys(r, ACTION_ICON_FORMAT_KEYS));
}

function mergeActionIconRules(
  target: RouteActionIconRule[] | undefined,
  format: Partial<RouteActionIconRule>[],
): RouteActionIconRule[] {
  const base = target ?? [];
  if (format.length === 0) return base;
  return base.map((item, i) => {
    const patch = format.find(r => r.id === item.id) ?? format[i];
    return patch ? { ...item, ...pickKeys(patch, ACTION_ICON_FORMAT_KEYS) } : item;
  });
}

function stripSlotStatusColorRules(rules: SlotStatusColorRule[]): Partial<SlotStatusColorRule>[] {
  return rules.map(r => pickKeys(r, SLOT_STATUS_COLOR_FORMAT_KEYS));
}

function mergeSlotStatusColorRules(
  target: SlotStatusColorRule[] | undefined,
  format: Partial<SlotStatusColorRule>[],
): SlotStatusColorRule[] {
  const base = target ?? [];
  if (format.length === 0) return base;
  return base.map((item, i) => {
    const patch = format[i];
    return patch ? { ...item, ...pickKeys(patch, SLOT_STATUS_COLOR_FORMAT_KEYS) } : item;
  });
}

function restoreBindingsFromTarget(target: ChildWidget, merged: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(target)) {
    if (!isBindingKey(key)) continue;
    merged[key] = value;
  }
}

export function canApplyWidgetFormat(snapshot: WidgetFormatSnapshot, target: ChildWidget): boolean {
  return snapshot.sourceType === target.type;
}

/** 擷取大小、字級、內部對齊與樣式（不含平面座標、id、資料綁定與 DB 欄位） */
export function extractWidgetFormat(widget: ChildWidget): WidgetFormatSnapshot {
  const preserve = new Set([
    ...LAYOUT_PRESERVE,
    ...(CONTENT_PRESERVE[widget.type] ?? []),
  ]);
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(widget)) {
    if (preserve.has(key) || isBindingKey(key) || SKIP_FORMAT_KEYS.has(key)) continue;
    if (key === 'series' && Array.isArray(value)) {
      data.series = stripSeriesBindings(value as LineChartSeriesConfig[]);
      continue;
    }
    if (key === 'axisBands' && Array.isArray(value)) {
      data.axisBands = stripAxisBandBindings(value as ChartAxisBandConfig[]);
      continue;
    }
    if (key === 'triggerConditions' && Array.isArray(value)) {
      data.triggerConditions = stripTriggerBindings(value as AlertRule[]);
      continue;
    }
    if (key === 'rules' && Array.isArray(value)) {
      data.rules = stripStatusBadgeRuleBindings(value as StatusBadgeRule[]);
      continue;
    }
    if (key === 'actionIconRules' && Array.isArray(value)) {
      data.actionIconRules = stripActionIconRules(value as RouteActionIconRule[]);
      continue;
    }
    if (key === 'statusColorRules' && Array.isArray(value)) {
      data.statusColorRules = stripSlotStatusColorRules(value as SlotStatusColorRule[]);
      continue;
    }
    data[key] = value;
  }
  return { sourceType: widget.type, data };
}

export function applyWidgetFormat(
  target: ChildWidget,
  snapshot: WidgetFormatSnapshot,
): ChildWidget | null {
  if (!canApplyWidgetFormat(snapshot, target)) return null;

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot.data)) {
    if (isBindingKey(key)) continue;
    patch[key] = value;
  }

  if (Array.isArray(patch.series)) {
    patch.series = mergeSeriesBindings(
      (target as ChildWidget & { series?: LineChartSeriesConfig[] }).series,
      patch.series as Partial<LineChartSeriesConfig>[],
    );
  }
  if (Array.isArray(patch.axisBands)) {
    patch.axisBands = mergeAxisBandBindings(
      (target as ChildWidget & { axisBands?: ChartAxisBandConfig[] }).axisBands,
      patch.axisBands as Partial<ChartAxisBandConfig>[],
    );
  }
  if (Array.isArray(patch.triggerConditions)) {
    patch.triggerConditions = mergeTriggerBindings(
      (target as ChildWidget & { triggerConditions?: AlertRule[] }).triggerConditions,
      patch.triggerConditions as Partial<AlertRule>[],
    );
  }
  if (Array.isArray(patch.rules)) {
    patch.rules = mergeStatusBadgeRules(
      (target as ChildWidget & { rules?: StatusBadgeRule[] }).rules,
      patch.rules as Partial<StatusBadgeRule>[],
    );
  }
  if (Array.isArray(patch.actionIconRules)) {
    patch.actionIconRules = mergeActionIconRules(
      (target as ChildWidget & { actionIconRules?: RouteActionIconRule[] }).actionIconRules,
      patch.actionIconRules as Partial<RouteActionIconRule>[],
    );
  }
  if (Array.isArray(patch.statusColorRules)) {
    patch.statusColorRules = mergeSlotStatusColorRules(
      (target as ChildWidget & { statusColorRules?: SlotStatusColorRule[] }).statusColorRules,
      patch.statusColorRules as Partial<SlotStatusColorRule>[],
    );
  }

  const merged: Record<string, unknown> = { ...target, ...patch };
  restoreBindingsFromTarget(target, merged);
  return merged as unknown as ChildWidget;
}
