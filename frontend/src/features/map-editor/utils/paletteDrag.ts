import {
  AREA_PALETTE_ITEM,
  BASEMAP_PALETTE_ITEM,
  FACILITY_PALETTE_ITEMS,
  TRACKGEN_PALETTE_ITEM,
  type AreaPaletteItem,
  type BasemapPaletteItem,
  type FacilityPaletteItem,
  type PaletteItem,
  type TrackGenPaletteItem,
} from '../constants/palette'

export const PALETTE_DRAG_MIME = 'application/x-syncdrive-palette-item'

export function isAreaPaletteItem(item: PaletteItem): item is AreaPaletteItem {
  return item.type === 'Area'
}

export function isBasemapPaletteItem(item: PaletteItem): item is BasemapPaletteItem {
  return item.type === 'Basemap'
}

export function isTrackGenPaletteItem(item: PaletteItem): item is TrackGenPaletteItem {
  return item.type === 'TrackGen'
}

/** 可直接拖放到地圖畫布（與 Area 同層） */
export function isMapCanvasPaletteItem(
  item: PaletteItem,
): item is AreaPaletteItem | BasemapPaletteItem | TrackGenPaletteItem {
  return isAreaPaletteItem(item) || isBasemapPaletteItem(item) || isTrackGenPaletteItem(item)
}

export function encodePaletteDragItem(item: PaletteItem): string {
  if (isAreaPaletteItem(item)) {
    return JSON.stringify({ type: 'Area' })
  }
  if (isBasemapPaletteItem(item)) {
    return JSON.stringify({ type: 'Basemap' })
  }
  if (isTrackGenPaletteItem(item)) {
    return JSON.stringify({ type: 'TrackGen' })
  }
  return JSON.stringify({ type: item.type, name: item.name })
}

export function decodePaletteDragItem(raw: string): PaletteItem | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { type?: unknown; name?: unknown }
    if (o.type === 'Area') return AREA_PALETTE_ITEM
    if (o.type === 'Basemap') return BASEMAP_PALETTE_ITEM
    if (o.type === 'TrackGen') return TRACKGEN_PALETTE_ITEM
    const found = FACILITY_PALETTE_ITEMS.find(
      (p) => p.type === o.type && p.name === o.name,
    )
    return found ?? null
  } catch {
    return null
  }
}

export type { FacilityPaletteItem, PaletteItem }
