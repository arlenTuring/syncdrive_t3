import type { VehicleElementType } from '../types';

export const VEHICLE_PALETTE: {
  type: VehicleElementType;
  label: string;
  color: string;
  description: string;
}[] = [
  { type: 'body', label: '車體', color: '#3B67AC', description: 'vehicle_body.svg' },
  { type: 'text', label: '文字', color: '#f59e0b', description: '顯示資料欄位文字' },
  { type: 'light', label: '車燈', color: '#fbbf24', description: 'lights.png · MQTT/SQL 欄位開關' },
  { type: 'door', label: '車門', color: '#38bdf8', description: 'door.svg 雙門片開合' },
];

export const DEFAULT_BODY_IMAGE = 'body/vehicle_body.svg';
export const DEFAULT_BODY_TINT = '#3B67AC';
/** vehicle_body.svg 在載具上直立顯示（-90°）的視覺寬高 */
export const BODY_DISPLAY_WIDTH = 32;
export const BODY_DISPLAY_HEIGHT = 85;
export const DEFAULT_BODY_ELEMENT_WIDTH = 48;
export const DEFAULT_BODY_ELEMENT_HEIGHT = 128;
/** 圖台橫向載具畫布（編輯用 500×100；圖台顯示尺寸由 vehicleDisplayWidthPx / HeightPx 設定） */
export const MAP_TRACK_VEHICLE_WIDTH = 500;
export const MAP_TRACK_VEHICLE_HEIGHT = 100;
export const MAP_BODY_ELEMENT_WIDTH = 420;
export const MAP_BODY_ELEMENT_HEIGHT = 100;
export const DEFAULT_LIGHT_IMAGE = 'lights/lights.png';

export function isVehicleLightImage(imageFile: string | undefined): boolean {
  const v = (imageFile ?? '').trim();
  return v === DEFAULT_LIGHT_IMAGE || v.endsWith('lights/lights.png') || v.endsWith('/lights.png');
}
export const DEFAULT_DOOR_IMAGE = 'door/door.svg';
export const DEFAULT_DOOR_COLOR = '#F3F4F6';
