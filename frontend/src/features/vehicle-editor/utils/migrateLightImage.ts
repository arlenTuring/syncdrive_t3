import { DEFAULT_LIGHT_IMAGE } from '../constants/palette';

const LEGACY_GLOW = new Set(['__glow__', 'lights/glow-warm.svg', 'lights/glow-cool.svg', 'lights/lights.svg']);

/** 車燈圖統一為 lights/lights.png */
export function normalizeLightImageFile(file: string | undefined): string {
  const v = (file ?? '').trim();
  if (!v || LEGACY_GLOW.has(v) || v === DEFAULT_LIGHT_IMAGE) {
    return DEFAULT_LIGHT_IMAGE;
  }
  if (v.endsWith('lights.png')) return DEFAULT_LIGHT_IMAGE;
  return v;
}

export function isLegacyLightImage(file: string | undefined): boolean {
  const v = (file ?? '').trim();
  return !v || LEGACY_GLOW.has(v) || v === '__glow__';
}
