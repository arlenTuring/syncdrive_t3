/**
 * T3 v0.1.0 場域軌道巢狀判定（開區間 (min, max)，邊界值不落入任一軌道）
 * 與 backend/scripts/t3-v0-0-5-track-motion.js 一致
 */

const LEN = 50;

const D_UPPER_Y_MIN = 100;
const D_UPPER_Y_MAX = 103.5;
const D_LOWER_Y_MIN = 303.5;
const D_LOWER_Y_MAX = 307;
const U_UPPER_Y_MIN = 103.5;
const U_UPPER_Y_MAX = 107;
const U_LOWER_Y_MIN = 300;
const U_LOWER_Y_MAX = 303.5;

const T3_D_X_MIN = 100;
const T3_D_X_MAX = 103.5;
const T3_U_X_MIN = 103.5;
const T3_U_X_MAX = 107;
const T3_D_Y_START = 103.5;
const T3_D_Y_END = 303.5;

const U_ROW_X_START = 103.5;
const U_ROW_X_FIRST_END = 150;

const BOUNDARY_EPS = 1e-6;
/** D16 轉角下沉時 y 剛超過 103.5 的過渡帶（公尺），此區間仍屬 D 上橫列 */
const D_U_JUNCTION_MARGIN = 1.0;

/** 軌道區間：大於 min、小於 max（等於邊界不歸屬該軌道） */
export function inTrackOpen(value: number, min: number, max: number): boolean {
  return value > min && value < max;
}

/** @deprecated 請改用 inTrackOpen */
export function inHalfOpen(value: number, min: number, max: number): boolean {
  return inTrackOpen(value, min, max);
}

function nearBoundary(value: number, boundary: number): boolean {
  return Math.abs(value - boundary) <= BOUNDARY_EPS;
}

function dTrack(n: number): string {
  return `D${String(n).padStart(2, '0')}`;
}

function uTrack(n: number): string {
  return `U${String(n).padStart(2, '0')}`;
}

function uUpperXBounds(n: number): { xMin: number; xMax: number } {
  if (n === 16) return { xMin: U_ROW_X_START, xMax: U_ROW_X_FIRST_END };
  const xMin = U_ROW_X_FIRST_END + (15 - n) * LEN;
  return { xMin, xMax: xMin + LEN };
}

function uLowerXBounds(n: number): { xMin: number; xMax: number } {
  if (n === 20) return { xMin: U_ROW_X_START, xMax: U_ROW_X_FIRST_END };
  const xMin = U_ROW_X_FIRST_END + (n - 21) * LEN;
  return { xMin, xMax: xMin + LEN };
}

function classifyDUpperRow(xM: number): string | null {
  for (let n = 1; n <= 16; n++) {
    const xMax = 900 - (n - 1) * LEN;
    const xMin = xMax - LEN;
    if (inTrackOpen(xM, xMin, xMax)) return dTrack(n);
  }
  return null;
}

function classifyDLowerRow(xM: number): string | null {
  for (let n = 20; n <= 35; n++) {
    const xMin = 100 + (n - 20) * LEN;
    if (inTrackOpen(xM, xMin, xMin + LEN)) return dTrack(n);
  }
  return null;
}

function classifyUUpperRow(xM: number): string | null {
  for (let n = 1; n <= 16; n++) {
    const { xMin, xMax } = uUpperXBounds(n);
    if (inTrackOpen(xM, xMin, xMax)) return uTrack(n);
  }
  return null;
}

function classifyULowerRow(xM: number): string | null {
  for (let n = 20; n <= 35; n++) {
    const { xMin, xMax } = uLowerXBounds(n);
    if (inTrackOpen(xM, xMin, xMax)) return uTrack(n);
  }
  return null;
}

function classifyT3DColumn(yM: number): string | null {
  if (inTrackOpen(yM, 103.5, 150)) return 'D17';
  if (inTrackOpen(yM, 150, 250)) return 'D18';
  if (inTrackOpen(yM, 250, T3_D_Y_END)) return 'D19';
  if (nearBoundary(yM, 150)) return 'D18';
  if (nearBoundary(yM, 250)) return 'D19';
  return null;
}

function classifyT3UColumn(yM: number): string | null {
  if (inTrackOpen(yM, 107, 150)) return 'U17';
  if (inTrackOpen(yM, 150, 250)) return 'U18';
  if (inTrackOpen(yM, 250, 300)) return 'U19';
  if (nearBoundary(yM, 150)) return 'U18';
  if (nearBoundary(yM, 250)) return 'U19';
  return null;
}

function classifyDUpperCornerTransition(xM: number, yM: number): string | null {
  if (yM <= D_UPPER_Y_MAX || yM > D_UPPER_Y_MAX + D_U_JUNCTION_MARGIN) return null;
  if (xM <= T3_D_X_MAX) return null;
  return classifyDUpperRow(xM);
}

/** 由場域 (x, y) 公尺巢狀判定軌道代碼；不在任何區間則 null */
export function classifyT3FieldTrack(xM: number, yM: number): string | null {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) return null;

  if (inTrackOpen(xM, T3_D_X_MIN, T3_D_X_MAX)) {
    if (inTrackOpen(yM, T3_D_Y_START, T3_D_Y_END)) {
      return classifyT3DColumn(yM);
    }
    if (nearBoundary(yM, T3_D_Y_START)) {
      return 'D17';
    }
    if (nearBoundary(yM, T3_D_Y_END)) {
      return 'D19';
    }
  }

  if (inTrackOpen(xM, T3_U_X_MIN, T3_U_X_MAX)) {
    if (inTrackOpen(yM, 107, 300)) {
      return classifyT3UColumn(yM);
    }
    if (nearBoundary(yM, 107)) {
      return 'U17';
    }
    if (nearBoundary(yM, 300)) {
      return 'U19';
    }
  }

  if (inTrackOpen(yM, D_UPPER_Y_MIN, D_UPPER_Y_MAX)) {
    return classifyDUpperRow(xM);
  }

  // y=103.5 且在 D 直行柱外：仍屬 D 上橫列（例如 D16 轉角），不可落到 U 列
  if (nearBoundary(yM, D_UPPER_Y_MAX) && xM > T3_D_X_MAX) {
    const row = classifyDUpperRow(xM);
    if (row) return row;
  }

  // y 剛超過 103.5（>103.5 但仍在轉角過渡帶）：仍算 D 上橫列，不能進 U 上橫列
  const cornerD = classifyDUpperCornerTransition(xM, yM);
  if (cornerD) return cornerD;

  // U 上橫列：y 必須嚴格大於 103.5
  if (inTrackOpen(yM, U_UPPER_Y_MIN, U_UPPER_Y_MAX)) {
    return classifyUUpperRow(xM);
  }

  if (inTrackOpen(yM, U_LOWER_Y_MIN, U_LOWER_Y_MAX)) {
    return classifyULowerRow(xM);
  }

  if (inTrackOpen(yM, D_LOWER_Y_MIN, D_LOWER_Y_MAX)) {
    return classifyDLowerRow(xM);
  }

  return null;
}

export function normalizeTrackCode(name?: string | null): string | null {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  const u = /^U0?(\d+)$/i.exec(trimmed);
  if (u) return `U${String(Number(u[1])).padStart(2, '0')}`;
  const d = /^D0?(\d+)$/i.exec(trimmed);
  if (d) return `D${String(Number(d[1])).padStart(2, '0')}`;
  return trimmed;
}

/** segment_label 箭頭段（如 D16→T3）取可對應的軌道代碼 */
export function trackCodeFromSegmentLabel(segmentLabel: string | undefined): string | null {
  if (!segmentLabel?.trim()) return null;
  const label = segmentLabel.trim();

  if (label.includes('→')) {
    const [fromPart, toPart] = label.split('→').map((s) => s.trim());
    const toCode = normalizeTrackCode(toPart);
    if (toCode && /^(D|U)\d{2}$/.test(toCode)) return toCode;
    const fromCode = normalizeTrackCode(fromPart);
    if (fromCode && /^(D|U)\d{2}$/.test(fromCode)) return fromCode;
    return null;
  }

  const code = normalizeTrackCode(label);
  if (code && /^(D|U)\d{2}$/.test(code)) return code;
  return null;
}

/**
 * 判定軌道代碼：僅依場域座標巢狀區間（不用 segment_label，避免標籤與座標不一致）。
 */
export function resolveT3TrackCode(
  xM: number,
  yM: number,
  _segmentLabel?: string,
): string | null {
  return classifyT3FieldTrack(xM, yM);
}
