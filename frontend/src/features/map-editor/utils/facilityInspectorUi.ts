import type { FacilityObject } from '../types/facility'

/** 地圖上可拖曳／旋轉名稱的元件（軌道、設施區塊、號誌、智慧桿等） */
export function facilityUsesDraggableMapLabel(facility: FacilityObject): boolean {
  return (
    facility.type === 'Track' ||
    facility.type === 'Facility' ||
    facility.type === 'Signal' ||
    facility.type === 'Pole' ||
    facility.type === 'DockingPoint'
  )
}
