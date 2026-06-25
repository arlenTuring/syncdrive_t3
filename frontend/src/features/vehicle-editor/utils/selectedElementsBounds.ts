import type { VehicleElement } from '../types';

export function selectedElementsBounds(
  elements: VehicleElement[],
  selectedIds: string[],
): { x: number; y: number; width: number; height: number } | null {
  if (selectedIds.length === 0) return null;
  const idSet = new Set(selectedIds);
  const selected = elements.filter((el) => idSet.has(el.id));
  if (selected.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of selected) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
