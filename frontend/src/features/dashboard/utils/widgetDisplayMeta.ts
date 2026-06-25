import type { ChildWidget, WidgetType } from '../types';

const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  text: '純文字',
  image: '圖片',
  'color-block': '色塊',
  clock: '時鐘',
  'empty-state': '空狀態',
  'alert-banner': '資料警示',
  'vehicle-alert-banner': '車輛警示',
  'line-chart': '折線圖',
  'segment-bar': '分段比例條',
  'bar-chart': '長條圖',
  database: '資料庫',
  gauge: '儀表板',
  'stat-card': 'KPI 卡',
  'progress-bar': '進度條',
  'status-badge': '狀態徽章',
  'route-progress': '路線進度',
  'slot-grid': '格位陣列',
  'unit-telemetry-card': '遙測卡',
  'map-canvas': '圖台',
  'vehicle-container': '載具樣板',
};

export function getWidgetTypeLabel(type: WidgetType): string {
  return WIDGET_TYPE_LABELS[type] ?? type;
}

export function getWidgetDisplayName(child: ChildWidget): string {
  switch (child.type) {
    case 'text':
      return child.content?.trim().slice(0, 40) || '文字';
    case 'image':
      return child.src?.trim()
        ? child.src.replace(/^.*\//, '').slice(0, 32)
        : '圖片';
    case 'line-chart':
    case 'bar-chart':
      return child.title?.trim() || getWidgetTypeLabel(child.type);
    case 'gauge':
      return child.title?.trim() || '儀表板';
    case 'database':
      return child.title?.trim() || '資料表';
    case 'stat-card':
      return child.label?.trim() || child.valueField?.trim() || 'KPI';
    case 'status-badge':
      return child.defaultLabel?.trim() || child.valueField?.trim() || '狀態徽章';
    case 'route-progress':
      return child.stations?.[0]?.name?.trim() || child.valueField?.trim() || '路線進度';
    case 'slot-grid':
      return child.title?.trim() || '格位陣列';
    case 'progress-bar':
      return child.label?.trim() || '進度條';
    case 'segment-bar':
      return child.title?.trim() || '分段比例條';
    case 'clock':
      return '時鐘';
    case 'empty-state':
      return child.label?.trim() || child.subLabel?.trim() || '空狀態';
    case 'alert-banner':
      return (
        child.content?.trim().slice(0, 40) ||
        getWidgetTypeLabel(child.type)
      );
    case 'vehicle-alert-banner':
      return getWidgetTypeLabel(child.type);
    case 'unit-telemetry-card':
      return child.unitLabel?.trim() || '遙測卡';
    case 'map-canvas':
      return '圖台';
    case 'vehicle-container':
      return child.label?.trim() || '載具樣板';
    case 'color-block':
      return '色塊';
    default:
      return getWidgetTypeLabel((child as ChildWidget).type);
  }
}
