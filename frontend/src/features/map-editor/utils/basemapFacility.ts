import { LABEL_STYLE_PARAM_KEY } from './facilityLabelStyle'
import type { OpenDriveBounds, OpenDrivePlan } from '../opendrive'
import { parseOpenDriveXodr } from '../opendrive'
import {
  type BasemapWorldBounds,
  isBasemapWorldBounds,
} from './basemapGrid'
import {
  type BasemapCellNode,
  BASEMAP_CELL_TREE_KEY,
  createDefaultBasemapCellTree,
  parseBasemapCellTree,
} from './basemapCellTree'
import {
  BASEMAP_PARTITION_KEY,
  createDefaultBasemapPartition,
  parseBasemapPartition,
} from './basemapPartition'

export const BASEMAP_PREVIEW_URL_KEY = 'basemapPreviewUrl'
export const BASEMAP_FILE_NAME_KEY = 'basemapFileName'
export const BASEMAP_SOURCE_TYPE_KEY = 'basemapSourceType'
export const BASEMAP_XODR_CONTENT_KEY = 'basemapXodrContent'
export const BASEMAP_WORLD_BOUNDS_KEY = 'basemapWorldBounds'
/** 0–1，底圖內容（圖片／OpenDRIVE）透明度；格線維持不透明 */
export const BASEMAP_OPACITY_KEY = 'basemapOpacity'
/** true：繪製於 Area 之上；false（預設）：繪製於 Area 之下 */
export const BASEMAP_ABOVE_AREAS_KEY = 'basemapAboveAreas'

export const MAP_BASEMAP_Z_BELOW_BASE = 1
export const MAP_BASEMAP_Z_ABOVE_BASE = 5000
export const MAP_BASEMAP_SELECTED_Z_BOOST = 10_000

export type BasemapSourceType = 'image' | 'xodr'

export type BasemapFileSelection =
  | { kind: 'image'; file: File; previewUrl: string }
  | { kind: 'xodr'; file: File; content: string }

export function getBasemapSourceType(
  parameters: Record<string, unknown> | undefined,
): BasemapSourceType | null {
  const raw = parameters?.[BASEMAP_SOURCE_TYPE_KEY]
  return raw === 'image' || raw === 'xodr' ? raw : null
}

export function getBasemapPreviewUrl(
  parameters: Record<string, unknown> | undefined,
): string | null {
  const raw = parameters?.[BASEMAP_PREVIEW_URL_KEY]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function getBasemapFileName(
  parameters: Record<string, unknown> | undefined,
): string | null {
  const raw = parameters?.[BASEMAP_FILE_NAME_KEY]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function getBasemapXodrContent(
  parameters: Record<string, unknown> | undefined,
): string | null {
  const raw = parameters?.[BASEMAP_XODR_CONTENT_KEY]
  return typeof raw === 'string' && raw.trim() ? raw : null
}

export function getBasemapOpacity(
  parameters: Record<string, unknown> | undefined,
): number {
  const raw = parameters?.[BASEMAP_OPACITY_KEY]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  return Math.max(0, Math.min(1, raw))
}

export function isBasemapAboveAreas(
  parameters: Record<string, unknown> | undefined,
): boolean {
  return parameters?.[BASEMAP_ABOVE_AREAS_KEY] === true
}

export function partitionMapBasemaps<T extends { parameters?: Record<string, unknown> }>(
  basemaps: T[],
): { below: T[]; above: T[] } {
  const below: T[] = []
  const above: T[] = []
  for (const basemap of basemaps) {
    if (isBasemapAboveAreas(basemap.parameters)) above.push(basemap)
    else below.push(basemap)
  }
  return { below, above }
}

export function parseBasemapOpenDrivePlan(
  parameters: Record<string, unknown> | undefined,
): OpenDrivePlan | null {
  const content = getBasemapXodrContent(parameters)
  if (!content) return null
  try {
    return parseOpenDriveXodr(content)
  } catch {
    return null
  }
}

export function getBasemapWorldBounds(
  parameters: Record<string, unknown> | undefined,
  layout: { wPx: number; hPx: number },
  xodrPlan: OpenDrivePlan | null,
): BasemapWorldBounds {
  const stored = parameters?.[BASEMAP_WORLD_BOUNDS_KEY]
  if (isBasemapWorldBounds(stored)) return stored
  if (xodrPlan) return { ...xodrPlan.bounds }
  const w = Math.max(1, layout.wPx)
  const h = Math.max(1, layout.hPx)
  return { xmin: 0, ymin: 0, xmax: w, ymax: h }
}

export function setBasemapWorldBoundsPatch(
  bounds: BasemapWorldBounds,
): Record<string, unknown> {
  return { [BASEMAP_WORLD_BOUNDS_KEY]: bounds }
}

export function openDriveSpanM(bounds: OpenDriveBounds): { w: number; h: number } {
  return {
    w: Math.max(0.1, bounds.xmax - bounds.xmin),
    h: Math.max(0.1, bounds.ymax - bounds.ymin),
  }
}

export function defaultBasemapParameters(): Record<string, unknown> {
  return {
    [LABEL_STYLE_PARAM_KEY]: { visible: false },
    [BASEMAP_OPACITY_KEY]: 1,
    [BASEMAP_PARTITION_KEY]: createDefaultBasemapPartition(),
    [BASEMAP_CELL_TREE_KEY]: createDefaultBasemapCellTree(),
  }
}

export { BASEMAP_CELL_TREE_KEY, parseBasemapCellTree, BASEMAP_PARTITION_KEY, parseBasemapPartition }
export type { BasemapCellNode }
