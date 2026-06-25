import type { VehicleElement, VehicleLightElement } from '../types';

/** 依車燈在載具上的左右位置推斷開關欄位 */
export function inferLightVisibilityField(
  light: VehicleLightElement,
  allLights: VehicleLightElement[],
): string {
  if (light.visibilityField?.trim()) return light.visibilityField.trim();
  if (allLights.length <= 1) return 'head_light_on';
  const sorted = [...allLights].sort((a, b) => a.x - b.x);
  const index = sorted.findIndex((el) => el.id === light.id);
  return index <= 0 ? 'head_light_on' : 'tail_light_on';
}

export function migrateLightVisibilityFields(elements: VehicleElement[]): VehicleElement[] {
  const lights = elements.filter((el): el is VehicleLightElement => el.type === 'light');
  if (lights.length === 0) return elements;

  return elements.map((el) => {
    if (el.type !== 'light') return el;
    return {
      ...el,
      visibilityField: inferLightVisibilityField(el, lights),
    };
  });
}
