import type { CanvasElementProps } from '../types';
import type { VariableMap } from '../VariableContext';
import { FIELD_PREVIEW_SAMPLES } from './widgetEditPreview';

/** 車輛監控編輯預覽（皆正常；執行時異常僅來自即時 MQTT） */
const VEHICLE_MONITOR_PREVIEW_PROFILES: Record<string, unknown>[] = [
  {
    vehicle_code: 'PMS-01',
    overall_health: 'OK',
    alert_message: '',
    status_computing: 'OK',
    status_sensing: 'OK',
    status_communication: 'OK',
    status_chassis: 'OK',
    card_border_color: '#00c897',
    priority_level: 50,
    line_kind: 'MAINLINE',
    order_status: 'PROCESSING',
    badge_label: 'D1030',
    badge_kind: 'mainline',
    segment_label: 'P1',
    demo_speed: 12.0,
    demo_load: 75,
  },
  {
    vehicle_code: 'PMS-02',
    overall_health: 'OK',
    alert_message: '',
    status_computing: 'OK',
    status_sensing: 'OK',
    status_communication: 'OK',
    status_chassis: 'OK',
    card_border_color: '#00c897',
    priority_level: 40,
    line_kind: 'MAINTENANCE',
    order_status: 'PROCESSING',
    maint_type_label: '充電',
    maint_type_bg: '#422006',
    maint_type_color: '#fdba74',
    badge_label: '充電',
    badge_kind: 'maintenance',
    trip_badge_bg: '#422006',
    trip_badge_color: '#fdba74',
    segment_label: 'E1',
    demo_speed: 0,
    demo_load: 82,
  },
  {
    vehicle_code: 'PMS-03',
    overall_health: 'OK',
    alert_message: '',
    status_computing: 'OK',
    status_sensing: 'OK',
    status_communication: 'OK',
    status_chassis: 'OK',
    card_border_color: '#00c897',
    priority_level: 40,
    line_kind: 'MAINTENANCE',
    order_status: 'PENDING',
    maint_type_label: '臨停',
    maint_type_bg: '#27272a',
    maint_type_color: '#a1a1aa',
    badge_label: '臨停',
    badge_kind: 'maintenance',
    trip_badge_bg: '#27272a',
    trip_badge_color: '#a1a1aa',
    segment_label: '臨停 P1',
    demo_speed: 0,
    demo_load: 89,
  },
  {
    vehicle_code: 'PMS-04',
    overall_health: 'OK',
    alert_message: '',
    status_computing: 'OK',
    status_sensing: 'OK',
    status_communication: 'OK',
    status_chassis: 'OK',
    card_border_color: '#00c897',
    badge_label: '',
    segment_label: 'D33',
    demo_speed: 18.9,
    demo_load: 63,
  },
];

/** 群組範本預覽：無 SQL 列時注入示範資料（對齊設計稿） */
export function buildTemplatePreviewRow(tileIndex = 0): Record<string, unknown> {
  const vehicleProfile = VEHICLE_MONITOR_PREVIEW_PROFILES[tileIndex % VEHICLE_MONITOR_PREVIEW_PROFILES.length];
  return {
    ...FIELD_PREVIEW_SAMPLES,
    shift_key: 'SHIFT-PREVIEW',
    event_id: 'EVT-PREVIEW',
    direction_pill_bg: '#1e3a8a',
    direction_pill_color: '#bfdbfe',
    maint_type_bg: '#422006',
    maint_type_color: '#fdba74',
    status_bg: '#064e3b',
    status_color: '#34d399',
    route_stations: JSON.stringify([
      { name: 'S2W', remain_pct: 0 },
      { name: 'E2', remain_pct: 100 },
    ]),
    segment_index: 0,
    segment_remain_pct: 0,
    route_progress: 100,
    next_station: 'E2',
    maint_type_label: '充電',
    is_alert: false,
    delay_minutes: 0,
    operation_action: 'charging',
    icon_bg_color: '#0284c7',
    is_acknowledged: false,
    trip_badge_bg: '#7e57c2',
    trip_badge_color: '#f3e8ff',
    badge_outline: '0',
    ...vehicleProfile,
  };
}

/** 子畫布編輯預覽：索引變數 + 示範列欄位（供 {trip_code} 等插值） */
export function buildGroupIndexPreviewVariables(group: CanvasElementProps): VariableMap {
  const varName = group.variableName || 'item';
  const indexMode = (group.groupVariableMode ?? 'row') === 'index';
  const preview = buildTemplatePreviewRow();
  return {
    ...preview,
    [varName]: indexMode ? 0 : preview[group.iteratorField || 'shift_key'],
  } as VariableMap;
}

/** 子畫布編輯平面最小尺寸（邏輯像素，可在此範圍內放置元件） */
export const SUBCANVAS_MIN_EDIT_W = 960;
export const SUBCANVAS_MIN_EDIT_H = 540;

/**
 * 子畫布編輯：大平面供排版，designW×H 為執行時範本裁切區（虛線標示）
 */
export function computeSubcanvasEditPlane(group: CanvasElementProps) {
  const designW = group.templateWidth || 300;
  const designH = group.templateHeight || 200;
  return {
    designW,
    designH,
    editW: Math.max(designW, SUBCANVAS_MIN_EDIT_W),
    editH: Math.max(designH, SUBCANVAS_MIN_EDIT_H),
  };
}
