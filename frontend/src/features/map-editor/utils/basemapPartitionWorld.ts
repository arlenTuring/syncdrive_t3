import type { BasemapWorldBounds } from './basemapGrid'
import { isBasemapWorldBounds } from './basemapGrid'
import type { BasemapNormRect, BasemapPartition } from './basemapPartition'
import {
  getBasemapCellNormRect,
  isBasemapPartitionConfirmed,
} from './basemapPartition'

/** 底圖內 0–1 矩形 → 世界座標（公尺），Y 軸與 OpenDRIVE 繪製一致 */
export function normRectToWorldBounds(
  rect: BasemapNormRect,
  parent: BasemapWorldBounds,
): BasemapWorldBounds {
  const spanW = parent.xmax - parent.xmin
  const spanH = parent.ymax - parent.ymin
  return {
    xmin: parent.xmin + rect.x * spanW,
    xmax: parent.xmin + (rect.x + rect.w) * spanW,
    ymin: parent.ymax - (rect.y + rect.h) * spanH,
    ymax: parent.ymax - rect.y * spanH,
  }
}

export function attachPartitionCellWorldBounds(
  partition: BasemapPartition,
  parentWorldBounds: BasemapWorldBounds,
): BasemapPartition {
  if (!isBasemapPartitionConfirmed(partition)) {
    return { ...partition, cellWorldBounds: undefined }
  }
  const cellWorldBounds: Record<string, BasemapWorldBounds> = {}
  for (const cell of partition.cells) {
    const rect = getBasemapCellNormRect(partition, cell)
    cellWorldBounds[cell.id] = normRectToWorldBounds(rect, parentWorldBounds)
  }
  return { ...partition, cellWorldBounds }
}

export function getPartitionCellWorldBounds(
  partition: BasemapPartition,
  cellId: string,
  parentWorldBounds: BasemapWorldBounds,
): BasemapWorldBounds | null {
  const stored = partition.cellWorldBounds?.[cellId]
  if (stored && isBasemapWorldBounds(stored)) return stored
  const cell = partition.cells.find((c) => c.id === cellId)
  if (!cell) return null
  return normRectToWorldBounds(
    getBasemapCellNormRect(partition, cell),
    parentWorldBounds,
  )
}

export function isPartitionCellWorldBoundsMap(
  v: unknown,
): v is Record<string, BasemapWorldBounds> {
  if (!v || typeof v !== 'object') return false
  return Object.values(v as Record<string, unknown>).every(isBasemapWorldBounds)
}
