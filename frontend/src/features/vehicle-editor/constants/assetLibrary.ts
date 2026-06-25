import { VEHICLE_BEHAVIOR_ACTION_CATALOG } from './behaviorActionCatalog';
import { DEFAULT_BODY_IMAGE, DEFAULT_LIGHT_IMAGE } from './palette';

export const VEHICLE_EDITOR_ASSETS_BASE = '/vehicle-editor';

export type VehicleAssetCategory = 'body' | 'light' | 'behavior';

export interface VehiclePresetAsset {
  id: string;
  category: VehicleAssetCategory;
  file: string;
  label: string;
}

export const VEHICLE_BODY_FILE = DEFAULT_BODY_IMAGE;

/** 車體固定 vehicle_body.svg；車燈僅 lights.png；行為圖示見 behaviors/ */
export const VEHICLE_PRESET_ASSETS: VehiclePresetAsset[] = [
  {
    id: 'light-beam',
    category: 'light',
    file: DEFAULT_LIGHT_IMAGE,
    label: '車燈光束',
  },
  ...VEHICLE_BEHAVIOR_ACTION_CATALOG.map((a) => ({
    id: `behavior-${a.code}`,
    category: 'behavior' as const,
    file: a.iconFile,
    label: a.label,
  })),
];

export function vehicleAssetsForCategory(category: VehicleAssetCategory): VehiclePresetAsset[] {
  if (category === 'body') return [];
  return VEHICLE_PRESET_ASSETS.filter((a) => a.category === category);
}

export function resolveVehicleAssetUrl(file: string): string {
  const v = file.trim();
  if (!v) return '';
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('/')) return v;
  if (v.startsWith('body/') || v.startsWith('lights/') || v.startsWith('behaviors/')) {
    return `${VEHICLE_EDITOR_ASSETS_BASE}/${v.replace(/^\/+/, '')}`;
  }
  if (v === 'vehicle_body.svg' || v.endsWith('/vehicle_body.svg')) {
    return `${VEHICLE_EDITOR_ASSETS_BASE}/body/vehicle_body.svg`;
  }
  return `${VEHICLE_EDITOR_ASSETS_BASE}/${v.replace(/^\/+/, '')}`;
}

export function isVehicleBodyAsset(file: string): boolean {
  const n = file.trim().toLowerCase();
  return (
    n === 'vehicle_body.svg' ||
    n.endsWith('/vehicle_body.svg') ||
    n.endsWith('body/vehicle_body.svg')
  );
}
