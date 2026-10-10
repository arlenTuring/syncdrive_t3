/**
 * 水平色帶儀表（gaugeVariant: 'band'）的純計算：顯示文字、指示點位置、色段。
 *
 * 顯示值不改：超出量程的值照實顯示，只有指示點夾在色帶兩端。沒有值顯示「—」，不顯示 0。
 */
export type BandSegment = { end: number; color: string };

/** 速度：低綠 → 黃 → 紅（與 semi-arc 速度弧同一組分界） */
export const SPEED_BAND_SEGMENTS: BandSegment[] = [
  { end: 0.72, color: '#00D492' },
  { end: 0.86, color: '#FDC700' },
  { end: 1, color: '#FB2C36' },
];

/** 電量：低紅 → 黃 → 綠（與 semi-arc 電量弧同一組分界） */
export const LOAD_BAND_SEGMENTS: BandSegment[] = [
  { end: 0.14, color: '#FB2C36' },
  { end: 0.24, color: '#FDC700' },
  { end: 1, color: '#00D492' },
];

export function formatGaugeValue(value: number | null, decimals?: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (typeof decimals === 'number' && decimals >= 0) return value.toFixed(Math.min(6, Math.floor(decimals)));
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 指示點在色帶上的位置（0～1），超出量程夾在兩端；沒有值回 null */
export function bandPosition(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const span = max - min;
  if (!(span > 0)) return null;
  return Math.min(1, Math.max(0, (value - min) / span));
}

export function bandColorAt(segments: BandSegment[], position: number): string {
  return (segments.find((segment) => position <= segment.end) ?? segments[segments.length - 1]).color;
}
