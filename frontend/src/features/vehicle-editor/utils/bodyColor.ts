/** 車體 pill SVG 調色：由基底色衍生漸層各層 */

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** factor < 1 變暗，> 1 變亮 */
export function shadeHex(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  if (factor < 1) {
    return rgbToHex(rgb.r * factor, rgb.g * factor, rgb.b * factor);
  }
  const f = factor - 1;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * f,
    rgb.g + (255 - rgb.g) * f,
    rgb.b + (255 - rgb.b) * f,
  );
}

/** 從 MQTT/SQL 欄位解析色碼 */
export function parseColorFromData(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s.length === 4 ? expandShortHex(s) : s;
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  return null;
}

function expandShortHex(short: string): string {
  const h = short.replace('#', '');
  return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
}

export interface BodyPillShades {
  edgeDark: string;
  mid: string;
  midLight: string;
  glow: string;
  highlight: string;
}

export function deriveBodyPillShades(baseHex: string): BodyPillShades {
  const mid = parseHex(baseHex) ? baseHex : '#3B67AC';
  return {
    edgeDark: shadeHex(mid, 0.62),
    mid,
    midLight: shadeHex(mid, 1.06),
    glow: shadeHex(mid, 0.9),
    highlight: shadeHex(mid, 1.14),
  };
}
