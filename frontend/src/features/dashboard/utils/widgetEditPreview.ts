import { useEditMode } from '../context/EditModeContext';
import type { ChildWidget, RouteStation } from '../types';

/*
 * 編輯模式的「沒有資料」顯示。
 *
 * 這裡原本有一張 FIELD_PREVIEW_SAMPLES：欄位名稱對到一個示範值（trip_code → S0000、
 * eta_remain → 00:30:00、vehicle_code → PMS01…），還有 MOCK_SEGMENT_PREVIEW 等示範陣列。
 * 元件綁了資料但沒拿到值時，編輯畫面就顯示那些示範值——看起來像真的，使用者沒辦法分辨
 * 「資料正常」跟「資料根本沒接上」。
 *
 * 現在沒有資料就顯示欄位名稱（{trip_code}）或空狀態，外框角標寫「無資料」。
 */
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
  'maintenance-distribution': '整備分佈預覽',
  'empty-state': '空狀態預覽',
  'route-progress': '路線進度預覽',
  'unit-telemetry-card': '遙測卡預覽',
  'map-canvas': '圖台預覽',
  image: '圖片占位',
  'color-block': '色塊',
  clock: '時鐘',
};

/** 編輯模式沒有資料時的空陣列（原本是示範資料，已移除；保留名稱讓呼叫端不用改形狀） */
export const MOCK_SEGMENT_PREVIEW: { status: string; pct: number; count: number }[] = [];
export const MOCK_SLOT_PREVIEW: { label: string; status: string }[] = [];
export const MOCK_ROUTE_STATIONS: RouteStation[] = [];
export const MOCK_DATABASE_PREVIEW: Record<string, unknown>[] = [];

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
  if (field) return `{${field}}`;

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
  // 沒有資料：停在最小值（空的量表／進度條），不放一個看起來像真的示範數字
  if (opts.fallback !== undefined) return opts.fallback;
  return opts.min ?? 0;
}

/** 編輯模式沒有資料時外框角標：寫明「無資料」與綁定的欄位 */
export function resolveWidgetPreviewLabel(widget: {
  content?: string;
  title?: string;
  label?: string;
  type?: ChildWidget['type'];
  valueField?: string;
}): string {
  const field = normalizeValueFieldKey(widget.valueField);
  return field ? `無資料 · ${field}` : '無資料';
}

export function useIsEditMode(): boolean {
  return useEditMode();
}
