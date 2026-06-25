import { useEditMode } from '../context/EditModeContext';
import type { ChildWidget, RouteStation } from '../types';

/** 依 valueField 推斷的編輯預覽示範 */
export const FIELD_PREVIEW_SAMPLES: Record<string, string> = {
  category: '線控',
  vehicle_code: 'PMS-01',
  status_label: '進行中',
  event_time: '2026.06.08 09:01:27',
  message: '防鎖死煞車系統故障',
  sub_label: 'PMS-02',
  severity: 'warning',
  trip_code: 'S0000',
  next_station: 'E2',
  eta_remain: '00:30:00',
  eta_delay: '+2分',
  eta_label: '完成預估',
  direction_label: '上行',
  maint_type_label: '充電',
  depart_time: '00:00',
  end_time: '00:00',
  badge_label: 'D0852',
  segment_label: 'D12',
  shift_key: 'SHIFT-01',
  total_events: '12',
  unprocessed_events: '3',
  processed_events: '9',
  total_shifts: '24',
  completed_shifts: '18',
  live_val: '856',
  target_val: '1200',
  avail_val: '200',
  next_val: '920',
  avail_hint: '可調度2輛',
  next_hint: '08:53',
  battery_level: '78',
  speed: '32',
  demo_speed: '17.1',
  demo_load: '82',
  alert_message: 'Warn msg',
  status: 'RUNNING',
  achievement_pct: '75',
  achievement_line: '達成了 75%',
  remaining_line: '剩餘9班次',
  progress_pct: '68',
};

const TYPE_PREVIEW_LABELS: Partial<Record<ChildWidget['type'], string>> = {
  'stat-card': 'KPI 預覽',
  gauge: '儀表預覽',
  'progress-bar': '進度預覽',
  'status-badge': '狀態預覽',
  'line-chart': '折線圖預覽',
  'bar-chart': '長條圖預覽',
  database: '資料表預覽',
  'segment-bar': '分布預覽',
  'slot-grid': '格位預覽',
  'empty-state': '空狀態預覽',
  'route-progress': '路線進度預覽',
  'unit-telemetry-card': '遙測卡預覽',
  'map-canvas': '圖台預覽',
  image: '圖片占位',
  'color-block': '色塊',
  clock: '時鐘',
};

export const MOCK_SEGMENT_PREVIEW = [
  { status: 'IN_SERVICE', pct: 36.4, count: 4 },
  { status: 'MAINTENANCE', pct: 45.5, count: 5 },
  { status: 'STANDBY', pct: 18.1, count: 2 },
];

export const MOCK_SLOT_PREVIEW = [
  { label: '01', status: 'OCCUPIED' },
  { label: '02', status: 'AVAILABLE' },
  { label: '03', status: 'CHARGING' },
  { label: '04', status: 'OCCUPIED' },
  { label: '05', status: 'AVAILABLE' },
  { label: '06', status: 'OCCUPIED' },
];

export const MOCK_ROUTE_STATIONS: RouteStation[] = [
  { id: 'pv-0', name: '起點', value: 0 },
  { id: 'pv-1', name: '中站', value: 50, remainPct: 42 },
  { id: 'pv-2', name: '終點', value: 100 },
];

export const MOCK_DATABASE_PREVIEW = [
  { col_a: '示範 A', col_b: '123' },
  { col_a: '示範 B', col_b: '456' },
  { col_a: '示範 C', col_b: '789' },
];

export function widgetHasDataBinding(w: {
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  mqttDataSourceId?: string;
  mqttTopic?: string;
}): boolean {
  return !!(
    (w.dataSourceId && w.sqlQuery?.trim())
    || w.dataUrl?.trim()
    || (w.mqttDataSourceId && w.mqttTopic?.trim())
  );
}

export function shouldShowEditPreview(
  isEditMode: boolean,
  hasBinding: boolean,
  hasLiveData: boolean,
  /** 無綁定但需在編輯器顯示占位（圖片、空狀態等） */
  forceInEditMode?: boolean,
): boolean {
  if (!isEditMode) return false;
  if (forceInEditMode) return true;
  return hasBinding && !hasLiveData;
}

/** 是否為純變數模板（如 {message}），此類內容不作編輯占位顯示 */
export function isVariableTemplate(text: string | undefined): boolean {
  const t = text?.trim() ?? '';
  return t.length > 0 && /\{[^{}]+\}/.test(t);
}

/** 從 valueField 或 `{field}` 取出欄位名 */
export function normalizeValueFieldKey(valueField: string | undefined): string | undefined {
  const t = valueField?.trim();
  if (!t) return undefined;
  const m = t.match(/^\{([^{}]+)\}$/);
  return m ? m[1].trim() : t;
}

/** 編輯模式占位：優先顯示屬性面板「預設內容」等字面文字，否則依欄位名自動示範 */
export function resolveWidgetEditPreview(opts: {
  valueField?: string;
  content?: string;
  label?: string;
  title?: string;
  type?: ChildWidget['type'];
}): string {
  const content = opts.content?.trim();
  if (content && !isVariableTemplate(content)) return content;

  const label = opts.label?.trim();
  if (label && !isVariableTemplate(label)) return label;

  const title = opts.title?.trim();
  if (title && !isVariableTemplate(title)) return title;

  const field = normalizeValueFieldKey(opts.valueField);
  if (field && FIELD_PREVIEW_SAMPLES[field]) {
    return FIELD_PREVIEW_SAMPLES[field];
  }

  if (field) return `[${field}]`;

  if (opts.type && TYPE_PREVIEW_LABELS[opts.type]) {
    return TYPE_PREVIEW_LABELS[opts.type]!;
  }

  return '預覽';
}

export function resolveNumericEditPreview(opts: {
  valueField?: string;
  content?: string;
  min?: number;
  max?: number;
  fallback?: number;
}): number {
  const content = opts.content?.trim();
  if (content && !isVariableTemplate(content)) {
    const n = Number(String(content).replace(/%$/, ''));
    if (!Number.isNaN(n)) return n;
  }
  const field = opts.valueField?.trim();
  if (field && FIELD_PREVIEW_SAMPLES[field]) {
    const n = Number(String(FIELD_PREVIEW_SAMPLES[field]).replace(/%$/, ''));
    if (!Number.isNaN(n)) return n;
  }
  if (opts.fallback !== undefined) return opts.fallback;
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  return Math.round(min + (max - min) * 0.62);
}

/** 依元件標題／類型取得編輯預覽標籤（圖表、色塊外框等） */
export function resolveWidgetPreviewLabel(widget: {
  content?: string;
  title?: string;
  label?: string;
  type?: ChildWidget['type'];
}): string {
  return resolveWidgetEditPreview({
    content: widget.content,
    title: widget.title,
    label: widget.label,
    type: widget.type,
  });
}

export function useIsEditMode(): boolean {
  return useEditMode();
}
