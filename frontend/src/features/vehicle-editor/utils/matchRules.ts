import type { VehicleImageRule, VehicleMatchOp } from '../types';

export function matchVehicleRule(
  op: VehicleMatchOp,
  raw: unknown,
  threshold: string,
): boolean {
  const a = String(raw ?? '');
  const b = threshold;
  if (op === 'eq') return a === b;
  if (op === 'neq') return a !== b;
  if (op === 'contains') return a.includes(b);
  const na = Number(raw);
  const nb = Number(threshold);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  if (op === 'gt') return na > nb;
  if (op === 'gte') return na >= nb;
  if (op === 'lt') return na < nb;
  if (op === 'lte') return na <= nb;
  return false;
}

export function resolveVehicleImageFromRules(
  rules: VehicleImageRule[] | undefined,
  data: Record<string, unknown> | null,
  fallback: { imageFile: string; tintColor?: string },
): { imageFile: string; tintColor?: string } {
  if (!rules?.length || !data) return fallback;
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of sorted) {
    if (!rule.imageFile?.trim()) continue;
    const raw = data[rule.sourceField];
    if (matchVehicleRule(rule.matchOp, raw, rule.threshold)) {
      return {
        imageFile: rule.imageFile,
        tintColor: rule.tintColor ?? fallback.tintColor,
      };
    }
  }
  return fallback;
}
