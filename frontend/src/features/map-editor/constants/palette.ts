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

export interface BasemapPaletteItem {
  label: string
  type: 'Basemap'
  hint: string
}

export interface TrackGenPaletteItem {
  label: string
  type: 'TrackGen'
  hint: string
}

export type PaletteItem =
  | FacilityPaletteItem
  | AreaPaletteItem
  | BasemapPaletteItem
  | TrackGenPaletteItem

export const AREA_PALETTE_ITEM: AreaPaletteItem = {
  label: 'Area 容器',
  type: 'Area',
  hint: '畫布上的區塊容器，用於群組放置元件',
}

export const BASEMAP_PALETTE_ITEM: BasemapPaletteItem = {
  label: '底圖',
  type: 'Basemap',
  hint: '底圖 — 與 Area 同層；拖曳至地圖任意位置，可載入圖片或 .xodr',
}

export const TRACKGEN_PALETTE_ITEM: TrackGenPaletteItem = {
  label: '軌道生成',
  type: 'TrackGen',
  hint: '軌道生成 — 與 Area 同層；載入 .xodr 後可由路網自動生成軌道',
}

/** 資產列：設施／設備僅可拖入 Area 內；底圖與 Area 同層。 */
export const FACILITY_PALETTE_ITEMS: readonly FacilityPaletteItem[] = [
  {
    label: '設施',
    type: 'Facility',
    name: 'FacilityArea',
    hint: '設施（大型區塊）— 充電格／停車格／維修格等；用途請在屬性填寫',
  },
  {
    label: '紅綠燈',
    type: 'Signal',
    name: 'Light',
    hint: '設備 — 紅綠燈（Signal / Light）',
  },
  {
    label: '智慧桿',
    type: 'Pole',
    name: 'SmartPole',
    hint: '設備 — 智慧桿（Pole / SmartPole）',
  },
  {
    label: '月台門',
    type: 'PSD',
    name: 'Gate',
    hint: '設備 — 月台門（PSD / Gate）',
  },
  {
    label: '電子圍籬',
    type: 'Geofence',
    name: 'Geofence',
    hint: '電子圍籬 — 多邊形範圍（僅在所屬 Area 顯示）',
  },
  {
    label: '軌道',
    type: 'Track',
    name: 'Rail',
    hint: '軌道 Track / Rail',
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
  {
    label: '圓角軌道',
    type: 'Track',
    name: 'RailCorner',
    hint: '圓角軌道 — 90 度圓角；可拉長兩端直線段，並調整圓弧半徑',
  },
  {
    label: '斜接軌道',
    type: 'Track',
    name: 'RailTaper',
    hint: '斜接軌道 — 矩形切掉右上與左下兩個對角；上下各一個控制點調整切角',
  },
  {
    label: '分岔軌道',
    type: 'Track',
    name: 'RailSwitch',
    hint: '分岔軌道 — 一進兩出；三個控制點分別調整進口、直行出口與岔出出口',
  },
  {
    label: '虛擬渡線',
    type: 'TrackCrossover',
    name: 'TrackCrossover',
    hint: '虛擬渡線 — PPT 式自由線徑（兩端任意拖）；X 形請放兩條',
  },
] as const

/** @deprecated 使用 FACILITY_PALETTE_ITEMS + AREA_PALETTE_ITEM */
export const PALETTE_ITEMS = FACILITY_PALETTE_ITEMS
