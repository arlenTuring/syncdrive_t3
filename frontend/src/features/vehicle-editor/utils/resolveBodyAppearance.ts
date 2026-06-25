import type { VehicleBodyElement, VehicleImageRule } from '../types';
import { DEFAULT_BODY_IMAGE, DEFAULT_BODY_TINT } from '../constants/palette';
import { parseColorFromData } from './bodyColor';
import { matchVehicleRule } from './matchRules';
import { readFieldFromRecord } from './resolveFieldValue';

function findMatchingRule(
  rules: VehicleImageRule[] | undefined,
  data: Record<string, unknown> | null,
): VehicleImageRule | null {
  if (!rules?.length || !data) return null;
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of sorted) {
    const raw = readFieldFromRecord(data, rule.sourceField);
    if (matchVehicleRule(rule.matchOp, raw, rule.threshold)) return rule;
  }
  return null;
}

export function resolveBodyAppearance(
  element: VehicleBodyElement,
  data: Record<string, unknown> | null,
): { imageFile: string; tintColor: string } {
  const imageFile = DEFAULT_BODY_IMAGE;
  const fallback = {
    imageFile,
    tintColor: element.defaultTintColor ?? DEFAULT_BODY_TINT,
  };

  const matched = findMatchingRule(element.imageRules, data);
  if (matched?.tintColor) {
    return { imageFile, tintColor: matched.tintColor };
  }

  const colorField = element.colorField?.trim();
  if (colorField && data) {
    const hex = parseColorFromData(readFieldFromRecord(data, colorField));
    if (hex) return { imageFile, tintColor: hex };
  }

  return fallback;
}
