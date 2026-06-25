import type { VehicleDefinition } from '../types';
import { newVehicleId } from './id';

export function cloneVehicleDefinition(
  source: VehicleDefinition,
  opts?: { name?: string },
): VehicleDefinition {
  const now = Date.now();
  const elements = source.elements.map((el) => ({
    ...structuredClone(el),
    id: newVehicleId('el'),
  }));
  return {
    ...structuredClone(source),
    id: newVehicleId(),
    name: opts?.name ?? `${source.name}（複本）`,
    elements,
    createdAt: now,
    updatedAt: now,
  };
}

export function parseVehicleDefinitionsJson(raw: unknown): VehicleDefinition[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(
    (item): item is VehicleDefinition =>
      item != null &&
      typeof item === 'object' &&
      typeof (item as VehicleDefinition).id === 'string' &&
      typeof (item as VehicleDefinition).name === 'string' &&
      Array.isArray((item as VehicleDefinition).elements),
  );
}

export function downloadVehicleDefinitionsJson(
  vehicles: VehicleDefinition[],
  filename: string,
): void {
  const blob = new Blob([JSON.stringify(vehicles, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
