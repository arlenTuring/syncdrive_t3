import type { FacilityName, FacilityType } from '../types/facility'

/**
 * 標準圖層命名：Facility / [Type] / [Name] / [ID] / [CustomName]
 */
export function buildStandardLayerName(
  type: FacilityType,
  name: FacilityName,
  id: string,
  customName: string,
): string {
  return `Facility / ${type} / ${name} / ${id} / ${customName}`
}
