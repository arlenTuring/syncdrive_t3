import {
  VEHICLE_OPERATION_ACTION_CATALOG,
  VEHICLE_OPERATION_ACTION_ICONS_BASE,
} from '../vehicle-operation-actions/actionCatalog';

export const DASHBOARD_ICONS_BASE = '/dashboard-icons';

/** 泛用分類（平台預設圖示，不綁特定儀表板情境） */
export interface IconCategory {
  id: string;
  label: string;
  description?: string;
}

export interface PresetIconEntry {
  /** 相對於 dashboard-icons/ 的路徑，如 navigation/nav.png */
  path: string;
  label: string;
  categoryId: string;
}

export interface IconLibraryEntry {
  file: string;
  label: string;
  code?: string;
}

export interface IconLibrarySet {
  id: string;
  label: string;
  description?: string;
  baseUrl: string;
  icons: IconLibraryEntry[];
  /** 預設圖示庫：依泛用分類瀏覽 */
  categories?: IconCategory[];
  presetIcons?: PresetIconEntry[];
}

export const PRESET_ICON_CATEGORIES: IconCategory[] = [
  { id: 'navigation', label: '導航／位置', description: '方向、定位、站點' },
  { id: 'time', label: '時間', description: '時鐘、時段、下一段' },
  { id: 'transport', label: '交通／載具', description: '車輛、調度、臨停' },
  { id: 'metrics', label: '數據／指標', description: '列表、KPI、趨勢摘要' },
  { id: 'charts', label: '圖表', description: '折線、趨勢圖示' },
  { id: 'alerts', label: '警示／通知', description: '告警、事件' },
  { id: 'vehicles', label: '車輛', description: '車隊、狀態、分布' },
  { id: 'facility', label: '場站／設施', description: '充電、洗車、維修等' },
  { id: 'schedule', label: '班表／排程', description: '班次、排程' },
];

export const PRESET_DASHBOARD_ICONS: PresetIconEntry[] = [
  { path: 'navigation/nav.png', label: '導航', categoryId: 'navigation' },
  { path: 'navigation/position.png', label: '位置', categoryId: 'navigation' },
  { path: 'time/clock.png', label: '時鐘', categoryId: 'time' },
  { path: 'time/next_scpoe.png', label: '下一段', categoryId: 'time' },
  { path: 'transport/reset_dispatch_vehicle.png', label: '可調度載具', categoryId: 'transport' },
  { path: 'transport/car_ro_stop.png', label: '臨停', categoryId: 'transport' },
  { path: 'metrics/reset_shift.png', label: '列表／指標', categoryId: 'metrics' },
  { path: 'charts/capacity-trend.png', label: '趨勢圖', categoryId: 'charts' },
  { path: 'alerts/event_center.png', label: '事件／告警', categoryId: 'alerts' },
  { path: 'vehicles/vehicle_state.png', label: '車輛狀態', categoryId: 'vehicles' },
  { path: 'vehicles/vehicle_distribution.png', label: '車輛分布', categoryId: 'vehicles' },
  { path: 'schedule/shift_center.png', label: '班表', categoryId: 'schedule' },
  { path: 'facility/maintenance_distribution.png', label: '設施分布', categoryId: 'facility' },
  { path: 'facility/chart.png', label: '圖表', categoryId: 'facility' },
  { path: 'facility/dispatch.png', label: '調度', categoryId: 'facility' },
  { path: 'facility/maintainance.png', label: '保養', categoryId: 'facility' },
  { path: 'facility/park.png', label: '臨停', categoryId: 'facility' },
  { path: 'facility/repair.png', label: '維修', categoryId: 'facility' },
  { path: 'facility/charging.png', label: '充電', categoryId: 'facility' },
  { path: 'facility/wash.png', label: '洗車', categoryId: 'facility' },
];

export function presetIconUrl(relativePath: string): string {
  const p = relativePath.trim().replace(/^\/+/, '');
  return `${DASHBOARD_ICONS_BASE}/${p}`;
}

export function isPresetDashboardIcon(url?: string): boolean {
  if (!url?.trim()) return false;
  return url.includes(`${DASHBOARD_ICONS_BASE}/`) && !url.includes('vehicle-operation-actions');
}

/** 從 URL 或檔名解析預設圖示 path（供選擇器比對） */
export function resolvePresetIconPath(value?: string): string {
  if (!value?.trim()) return '';
  const v = value.trim();
  const m = v.match(/\/dashboard-icons\/(.+)$/);
  if (m) return m[1];
  const found = PRESET_DASHBOARD_ICONS.find(
    (e) => e.path === v || e.path.endsWith(`/${v}`) || e.path.split('/').pop() === v,
  );
  return found?.path ?? '';
}

/** @deprecated 舊版路徑相容 */
const LEGACY_ICON_PATHS: Record<string, string> = {
  'general/nav.png': 'navigation/nav.png',
  'general/position.png': 'navigation/position.png',
  'general/clock.png': 'time/clock.png',
  'general/next_scpoe.png': 'time/next_scpoe.png',
  'general/reset_dispatch_vehicle.png': 'transport/reset_dispatch_vehicle.png',
  'general/car_ro_stop.png': 'transport/car_ro_stop.png',
  'general/reset_shift.png': 'metrics/reset_shift.png',
  'compoment/event_center.png': 'alerts/event_center.png',
  'compoment/shift_center.png': 'schedule/shift_center.png',
  'compoment/capacity-trend.png': 'charts/capacity-trend.png',
  'compoment/maintenance_distribution.png': 'facility/maintenance_distribution.png',
  'compoment/vehicle_distribution.png': 'vehicles/vehicle_distribution.png',
  'compoment/vehicle_state.png': 'vehicles/vehicle_state.png',
};

export function normalizePresetIconPath(value: string): string {
  const resolved = resolvePresetIconPath(value);
  if (resolved) return resolved;
  for (const [legacy, next] of Object.entries(LEGACY_ICON_PATHS)) {
    if (value.includes(legacy)) return next;
  }
  return value.replace(/^\/dashboard-icons\//, '');
}

/** 儀表板圖示庫：編輯器圖示選擇器資料來源 */
export const DASHBOARD_ICON_LIBRARY: IconLibrarySet[] = [
  {
    id: 'presets',
    label: '平台預設',
    description: '依泛用分類瀏覽；可搭配自訂 URL 上傳外部圖示',
    baseUrl: DASHBOARD_ICONS_BASE,
    icons: [],
    categories: PRESET_ICON_CATEGORIES,
    presetIcons: PRESET_DASHBOARD_ICONS,
  },
  {
    id: 'vehicle-operations',
    label: '作動行為',
    description: '行駛途中車輛動作（MQTT operation_action）',
    baseUrl: VEHICLE_OPERATION_ACTION_ICONS_BASE,
    icons: [
      ...VEHICLE_OPERATION_ACTION_CATALOG.map((a) => ({
        file: a.iconFile,
        label: a.label,
        code: a.code,
      })),
      { file: 'vehicle.svg', label: '車體' },
    ],
  },
];

export function iconUrlFromSet(set: IconLibrarySet, file: string): string {
  const name = file.trim().replace(/^\/+/, '');
  if (!name) return '';
  if (name.startsWith('http://') || name.startsWith('https://')) return name;
  if (name.includes('/')) return name.startsWith('/') ? name : `/${name}`;
  return `${set.baseUrl.replace(/\/$/, '')}/${name}`;
}

export function presetIconsForCategory(categoryId: string): PresetIconEntry[] {
  return PRESET_DASHBOARD_ICONS.filter((i) => i.categoryId === categoryId);
}

/** 解析圖示 URL（支援絕對路徑、dashboard-icons/…、作動行為檔名） */
export function resolveDashboardIconUrl(
  iconFile: string,
  preferredSetId = 'vehicle-operations',
): string {
  const v = iconFile.trim();
  if (!v) return '';
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('/')) return v;
  if (v.startsWith('behaviors/')) return `/vehicle-editor/${v}`;
  if (v.includes('dashboard-icons/')) return `/${v.replace(/^\/+/, '')}`;

  const preset = PRESET_DASHBOARD_ICONS.find(
    (e) => e.path === v || e.path.endsWith(`/${v}`),
  );
  if (preset) return presetIconUrl(preset.path);

  const set =
    DASHBOARD_ICON_LIBRARY.find((s) => s.id === preferredSetId) ??
    DASHBOARD_ICON_LIBRARY[0];
  return iconUrlFromSet(set, v);
}

export function findIconLibrarySet(id: string): IconLibrarySet | undefined {
  return DASHBOARD_ICON_LIBRARY.find((s) => s.id === id);
}

/** @deprecated 改用 presetIconUrl */
export function dashboardIconUrl(_folder: string, file: string): string {
  const normalized = normalizePresetIconPath(file);
  if (normalized.includes('/')) return presetIconUrl(normalized);
  return presetIconUrl(`navigation/${file}`);
}
