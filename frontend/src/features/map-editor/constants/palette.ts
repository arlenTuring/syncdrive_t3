import type { FacilityName, FacilityType } from '../types/facility'

export interface FacilityPaletteItem {
  label: string
  type: FacilityType
  name: FacilityName
  hint: string
}

export interface AreaPaletteItem {
  label: string
  type: 'Area'
  hint: string
}

export type PaletteItem = FacilityPaletteItem | AreaPaletteItem

export const AREA_PALETTE_ITEM: AreaPaletteItem = {
  label: 'Area 容器',
  type: 'Area',
  hint: '畫布上的區塊容器，用於群組放置元件',
}

/** 資產列：設施僅可拖入 Area 內 */
export const FACILITY_PALETTE_ITEMS: readonly FacilityPaletteItem[] = [
  {
    label: '設施',
    type: 'Facility',
    name: 'FacilityArea',
    hint: '設施 — 區域填色與 MQTT 規則；可設定用途、備註與圖示',
  },
  {
    label: '電子圍籬',
    type: 'Geofence',
    name: 'Geofence',
    hint: '電子圍籬 — 多邊形範圍（僅在所屬 Area 顯示）',
  },
  {
    label: '月台門',
    type: 'PSD',
    name: 'Gate',
    hint: '月台門 PSD / Gate',
  },
  {
    label: '紅綠燈',
    type: 'Signal',
    name: 'Light',
    hint: '號誌 Signal / Light',
  },
  {
    label: '軌道',
    type: 'Track',
    name: 'Rail',
    hint: '軌道 Track / Rail',
  },
  {
    label: '智慧桿',
    type: 'Pole',
    name: 'SmartPole',
    hint: '智慧桿 Pole / SmartPole',
  },
  {
    label: '停靠點',
    type: 'DockingPoint',
    name: 'DockingPoint',
    hint: '停靠點 — 站點標記；參照場域座標與站點名稱',
  },
  {
    label: '途經點',
    type: 'Waypoint',
    name: 'Waypoint',
    hint: '途經點 — 自駕車必經點位；預設綠色標記，代號全圖唯一',
  },
  {
    label: '道路線',
    type: 'RoadLine',
    name: 'RoadLine',
    hint: '道路線 — 純視覺標記；可調線型、線寬與長度',
  },
] as const

/** @deprecated 使用 FACILITY_PALETTE_ITEMS + AREA_PALETTE_ITEM */
export const PALETTE_ITEMS = FACILITY_PALETTE_ITEMS
