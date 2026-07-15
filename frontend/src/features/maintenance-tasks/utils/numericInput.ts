/** 僅保留數字；可選上限（用於百分比等） */
export function sanitizeIntegerInput(raw: string, max?: number): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (max === undefined) return digits;
  return String(Math.min(max, Number(digits)));
}

export function isPositiveInteger(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^\d+$/.test(trimmed) && Number(trimmed) > 0;
}

export function isPositiveIntegerUpTo(value: string, max: number): boolean {
  return isPositiveInteger(value) && Number(value) <= max;
}

export function isPositiveIntegerBelow(value: string, max: number): boolean {
  return isPositiveInteger(value) && Number(value) < max;
}
