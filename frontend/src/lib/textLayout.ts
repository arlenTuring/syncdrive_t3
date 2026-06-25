export type TextWrapMode = 'single' | 'wrap';

export const DEFAULT_TEXT_WRAP_MODE: TextWrapMode = 'single';

export function resolveTextWrapMode(
  value: unknown,
  fallback: TextWrapMode = DEFAULT_TEXT_WRAP_MODE,
): TextWrapMode {
  if (value === 'wrap') return 'wrap';
  if (value === 'single') return 'single';
  return fallback;
}

export function textWrapToWhiteSpace(mode: TextWrapMode): 'nowrap' | 'normal' {
  return mode === 'single' ? 'nowrap' : 'normal';
}

export function clampLabelBoxDimension(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function resolveLabelBoxDimensions(opts: {
  fontSize: number;
  facilityBoxW: number;
  customWidth?: number;
  customHeight?: number;
  textWrap: TextWrapMode;
  minWidth?: number;
  maxWidth?: number;
}): {
  width: number | 'max-content';
  height: number;
  maxWidth: number;
  minWidth: number;
} {
  const minW = opts.minWidth ?? Math.max(opts.fontSize * 2, 32);
  const maxW =
    opts.maxWidth ?? Math.max(minW, Math.min(Math.max(opts.facilityBoxW * 0.92, 240), 480));
  const defaultW = Math.max(opts.fontSize * 4, Math.min(maxW, opts.facilityBoxW * 0.92));
  const defaultH = Math.max(opts.fontSize * 1.35, 20);

  const width =
    opts.customWidth !== undefined
      ? clampLabelBoxDimension(opts.customWidth, minW, maxW * 2)
      : opts.textWrap === 'single'
        ? 'max-content'
        : defaultW;

  const height =
    opts.customHeight !== undefined
      ? clampLabelBoxDimension(opts.customHeight, opts.fontSize, 240)
      : defaultH;

  return { width, height, maxWidth: maxW, minWidth: minW };
}
