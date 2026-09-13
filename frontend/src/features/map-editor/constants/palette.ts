import type { FacilityName, FacilityType } from '../types/facility'

export interface FacilityPaletteItem {
  /** i18n key under mapEditor.palette.items.* */
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
  label: 'mapEditor.palette.items.area.label',
  type: 'Area',
  hint: 'mapEditor.palette.items.area.hint',
}

export const BASEMAP_PALETTE_ITEM: BasemapPaletteItem = {
  label: 'mapEditor.palette.items.basemap.label',
  type: 'Basemap',
  hint: 'mapEditor.palette.items.basemap.hint',
}

export const TRACKGEN_PALETTE_ITEM: TrackGenPaletteItem = {
  label: 'mapEditor.palette.items.trackGen.label',
  type: 'TrackGen',
  hint: 'mapEditor.palette.items.trackGen.hint',
}

/** 資產列：設施／設備僅可拖入 Area 內；底圖與 Area 同層。 */
export const FACILITY_PALETTE_ITEMS: readonly FacilityPaletteItem[] = [
  {
    label: 'mapEditor.palette.items.facility.label',
    type: 'Facility',
    name: 'FacilityArea',
    hint: 'mapEditor.palette.items.facility.hint',
  },
  {
    label: 'mapEditor.palette.items.zoneEntrance.label',
    type: 'Facility',
    name: 'ZoneEntrance',
    hint: 'mapEditor.palette.items.zoneEntrance.hint',
  },
  {
    label: 'mapEditor.palette.items.zonePartition.label',
    type: 'Facility',
    name: 'ZonePartition',
    hint: 'mapEditor.palette.items.zonePartition.hint',
  },
  {
    label: 'mapEditor.palette.items.light.label',
    type: 'Signal',
    name: 'Light',
    hint: 'mapEditor.palette.items.light.hint',
  },
  {
    label: 'mapEditor.palette.items.smartPole.label',
    type: 'Pole',
    name: 'SmartPole',
    hint: 'mapEditor.palette.items.smartPole.hint',
  },
  {
    label: 'mapEditor.palette.items.gate.label',
    type: 'PSD',
    name: 'Gate',
    hint: 'mapEditor.palette.items.gate.hint',
  },
  {
    label: 'mapEditor.palette.items.rail.label',
    type: 'Track',
    name: 'Rail',
    hint: 'mapEditor.palette.items.rail.hint',
  },
  {
    label: 'mapEditor.palette.items.dockingPoint.label',
    type: 'DockingPoint',
    name: 'DockingPoint',
    hint: 'mapEditor.palette.items.dockingPoint.hint',
  },
  {
    label: 'mapEditor.palette.items.waypoint.label',
    type: 'Waypoint',
    name: 'Waypoint',
    hint: 'mapEditor.palette.items.waypoint.hint',
  },
  {
    label: 'mapEditor.palette.items.roadLine.label',
    type: 'RoadLine',
    name: 'RoadLine',
    hint: 'mapEditor.palette.items.roadLine.hint',
  },
  {
    label: 'mapEditor.palette.items.railCorner.label',
    type: 'Track',
    name: 'RailCorner',
    hint: 'mapEditor.palette.items.railCorner.hint',
  },
  {
    label: 'mapEditor.palette.items.railTaper.label',
    type: 'Track',
    name: 'RailTaper',
    hint: 'mapEditor.palette.items.railTaper.hint',
  },
  {
    label: 'mapEditor.palette.items.railSwitch.label',
    type: 'Track',
    name: 'RailSwitch',
    hint: 'mapEditor.palette.items.railSwitch.hint',
  },
  {
    label: 'mapEditor.palette.items.railCross.label',
    type: 'Track',
    name: 'RailCross',
    hint: 'mapEditor.palette.items.railCross.hint',
  },
] as const

/** @deprecated 使用 FACILITY_PALETTE_ITEMS + AREA_PALETTE_ITEM */
export const PALETTE_ITEMS = FACILITY_PALETTE_ITEMS
