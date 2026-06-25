export type TextHorizontalAlign = 'left' | 'center' | 'right';
export type TextVerticalAlign = 'top' | 'center' | 'bottom';

export const DEFAULT_TEXT_HORIZONTAL_ALIGN: TextHorizontalAlign = 'center';
export const DEFAULT_TEXT_VERTICAL_ALIGN: TextVerticalAlign = 'center';

export function resolveTextHorizontalAlign(
  value: unknown,
  fallback: TextHorizontalAlign = DEFAULT_TEXT_HORIZONTAL_ALIGN,
): TextHorizontalAlign {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  return fallback;
}

export function resolveTextVerticalAlign(
  value: unknown,
  fallback: TextVerticalAlign = DEFAULT_TEXT_VERTICAL_ALIGN,
): TextVerticalAlign {
  if (value === 'top' || value === 'center' || value === 'bottom') return value;
  return fallback;
}

export function textHorizontalToJustify(
  align: TextHorizontalAlign,
): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'center') return 'center';
  if (align === 'right') return 'flex-end';
  return 'flex-start';
}

export function textVerticalToAlignItems(
  align: TextVerticalAlign,
): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'top') return 'flex-start';
  if (align === 'bottom') return 'flex-end';
  return 'center';
}

export function textAlignmentFlexStyle(
  horizontal: TextHorizontalAlign,
  vertical: TextVerticalAlign,
): {
  display: 'flex';
  textAlign: TextHorizontalAlign;
  alignItems: 'flex-start' | 'center' | 'flex-end';
  justifyContent: 'flex-start' | 'center' | 'flex-end';
} {
  return {
    display: 'flex',
    textAlign: horizontal,
    alignItems: textVerticalToAlignItems(vertical),
    justifyContent: textHorizontalToJustify(horizontal),
  };
}
