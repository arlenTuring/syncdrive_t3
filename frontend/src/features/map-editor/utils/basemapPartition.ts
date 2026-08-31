import {
  collectBasemapLeafRects,
  createDefaultBasemapCellTree,
  parseBasemapCellTree,
  BASEMAP_CELL_TREE_KEY,
} from './basemapCellTree'
import { type BasemapWorldBounds, isBasemapWorldBounds } from './basemapGrid'

export type BasemapPartitionCell = {
  id: string
  /** 相對底圖寬度 0–1 */
  x: number
  y: number
  w: number
  h: number
  /** @deprecated 舊版逐格固定；請用 cutsConfirmed */
  locked: boolean
}

export type BasemapNormRect = {
  x: number
  y: number
  w: number
  h: number
}

export type BasemapPartition = {
  /** 結構層：分割／共用分割線只改寫草稿中的格 */
  cells: BasemapPartitionCell[]
  /** 獨立層：確定切割後各格實際版面（結構層不會覆寫） */
  pinnedRects?: Record<string, BasemapNormRect>
  /** 已確定切割：各格完全獨立，可個別縮放 */
  cutsConfirmed?: boolean
  /** 各格對應的世界座標範圍（公尺），確定切割後寫入 */
  cellWorldBounds?: Record<string, BasemapWorldBounds>
}

export type BasemapCellPxRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  locked: boolean
}

export type BasemapSharedDivider = {
  id: string
  axis: 'row' | 'col'
  x: number
  y: number
  length: number
  cellAId: string
  cellBId: string
}

export type BasemapLockedResizeHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

export const BASEMAP_PARTITION_KEY = 'basemapPartition'

const ROOT_CELL_ID = 'root'
const MIN_FRAC = 0.06
const DEFAULT_SPLIT_RATIO = 0.5
const EDGE_EPS = 1e-4

let cellIdCounter = 1

export function resetBasemapPartitionIdCounter(n = 1): void {
  cellIdCounter = n
}

function nextCellId(): string {
  const id = `bc${cellIdCounter}`
  cellIdCounter += 1
  return id
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function clampFrac(n: number): number {
  return Math.min(1 - MIN_FRAC, Math.max(MIN_FRAC, n))
}

function isPartitionCell(v: unknown): v is BasemapPartitionCell {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number' &&
    typeof o.locked === 'boolean'
  )
}

function isNormRect(v: unknown): v is BasemapNormRect {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number'
  )
}

function isPartition(v: unknown): v is BasemapPartition {
  if (!v || typeof v !== 'object') return false
  const p = v as BasemapPartition
  if (!Array.isArray(p.cells) || !p.cells.every(isPartitionCell)) return false
  if (p.cutsConfirmed !== undefined && typeof p.cutsConfirmed !== 'boolean') {
    return false
  }
  if (p.cellWorldBounds !== undefined) {
    if (!p.cellWorldBounds || typeof p.cellWorldBounds !== 'object') return false
    if (
      !Object.values(p.cellWorldBounds).every((b) => isBasemapWorldBounds(b))
    ) {
      return false
    }
  }
  if (p.pinnedRects === undefined) return true
  if (!p.pinnedRects || typeof p.pinnedRects !== 'object') return false
  return Object.values(p.pinnedRects).every(isNormRect)
}

export function isBasemapPartitionConfirmed(partition: BasemapPartition): boolean {
  if (partition.cutsConfirmed) return true
  return partition.cells.some((c) => c.locked)
}

export function getBasemapCellNormRect(
  partition: BasemapPartition,
  cell: BasemapPartitionCell,
): BasemapNormRect {
  const useIndependent =
    isBasemapPartitionConfirmed(partition) || cell.locked
  if (useIndependent && partition.pinnedRects?.[cell.id]) {
    return partition.pinnedRects[cell.id]
  }
  return { x: cell.x, y: cell.y, w: cell.w, h: cell.h }
}

function withPinnedRect(
  partition: BasemapPartition,
  cellId: string,
  rect: BasemapNormRect,
): BasemapPartition {
  return {
    ...partition,
    pinnedRects: { ...(partition.pinnedRects ?? {}), [cellId]: rect },
  }
}

export function createDefaultBasemapPartition(): BasemapPartition {
  return {
    cells: [
      {
        id: ROOT_CELL_ID,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        locked: false,
      },
    ],
  }
}

export function partitionFromCellTree(
  parameters: Record<string, unknown> | undefined,
  widthPx: number,
  heightPx: number,
): BasemapPartition {
  const tree = parseBasemapCellTree(parameters)
  const w = Math.max(1, widthPx)
  const h = Math.max(1, heightPx)
  const rects = collectBasemapLeafRects(tree, { x: 0, y: 0, w, h })
  return {
    cells: rects.map((r) => ({
      id: r.id,
      x: r.x / w,
      y: r.y / h,
      w: r.w / w,
      h: r.h / h,
      locked: false,
    })),
  }
}

export function parseBasemapPartition(
  parameters: Record<string, unknown> | undefined,
  widthPx: number,
  heightPx: number,
): BasemapPartition {
  const raw = parameters?.[BASEMAP_PARTITION_KEY]
  if (isPartition(raw)) return raw
  if (parameters?.[BASEMAP_CELL_TREE_KEY]) {
    return partitionFromCellTree(parameters, widthPx, heightPx)
  }
  return createDefaultBasemapPartition()
}

export function partitionCellsToPx(
  partition: BasemapPartition,
  widthPx: number,
  heightPx: number,
): BasemapCellPxRect[] {
  const w = Math.max(1, widthPx)
  const h = Math.max(1, heightPx)
  return partition.cells.map((c) => {
    const rect = getBasemapCellNormRect(partition, c)
    return {
      id: c.id,
      locked: c.locked,
      x: rect.x * w,
      y: rect.y * h,
      w: rect.w * w,
      h: rect.h * h,
    }
  })
}

export function clientToBasemapLocalPx(
  rootEl: HTMLElement,
  clientX: number,
  clientY: number,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const rect = rootEl.getBoundingClientRect()
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const nx = (clientX - rect.left) / w
  const ny = (clientY - rect.top) / h
  return {
    x: Math.max(0, Math.min(widthPx, nx * Math.max(1, widthPx))),
    y: Math.max(0, Math.min(heightPx, ny * Math.max(1, heightPx))),
  }
}

export function hitBasemapPartitionCellAt(
  partition: BasemapPartition,
  widthPx: number,
  heightPx: number,
  localX: number,
  localY: number,
): string | null {
  const rects = partitionCellsToPx(partition, widthPx, heightPx)
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]
    if (
      localX >= r.x &&
      localX <= r.x + r.w &&
      localY >= r.y &&
      localY <= r.y + r.h
    ) {
      return r.id
    }
  }
  return null
}

export function splitBasemapPartitionCell(
  partition: BasemapPartition,
  cellId: string,
  axis: 'row' | 'col',
): { partition: BasemapPartition; newCellIds: [string, string] } | null {
  if (isBasemapPartitionConfirmed(partition)) return null
  const idx = partition.cells.findIndex((c) => c.id === cellId)
  if (idx < 0) return null
  const cell = partition.cells[idx]
  if (cell.locked) return null

  const idA = nextCellId()
  const idB = nextCellId()
  let a: BasemapPartitionCell
  let b: BasemapPartitionCell

  if (axis === 'col') {
    const wA = cell.w * DEFAULT_SPLIT_RATIO
    const wB = cell.w - wA
    a = { id: idA, x: cell.x, y: cell.y, w: wA, h: cell.h, locked: false }
    b = { id: idB, x: cell.x + wA, y: cell.y, w: wB, h: cell.h, locked: false }
  } else {
    const hA = cell.h * DEFAULT_SPLIT_RATIO
    const hB = cell.h - hA
    a = { id: idA, x: cell.x, y: cell.y, w: cell.w, h: hA, locked: false }
    b = {
      id: idB,
      x: cell.x,
      y: cell.y + hA,
      w: cell.w,
      h: hB,
      locked: false,
    }
  }

  const cells = [...partition.cells]
  cells.splice(idx, 1, a, b)
  return {
    partition: {
      cells,
      pinnedRects: partition.pinnedRects,
      cutsConfirmed: partition.cutsConfirmed,
    },
    newCellIds: [idA, idB],
  }
}

/** 確定切割：所有格子進入獨立層，可個別縮放 */
export function confirmBasemapPartitionCuts(
  partition: BasemapPartition,
): BasemapPartition | null {
  if (isBasemapPartitionConfirmed(partition)) return null
  if (partition.cells.length < 1) return null
  const pinnedRects: Record<string, BasemapNormRect> = {}
  for (const cell of partition.cells) {
    pinnedRects[cell.id] = getBasemapCellNormRect(partition, cell)
  }
  return {
    cells: partition.cells.map((c) => ({ ...c, locked: true })),
    pinnedRects,
    cutsConfirmed: true,
  }
}

/** 重新編輯切割：回到草稿，可再分割與拖曳共用分割線 */
export function reopenBasemapPartitionCuts(
  partition: BasemapPartition,
): BasemapPartition | null {
  if (!isBasemapPartitionConfirmed(partition)) return null
  const cells = partition.cells.map((c) => {
    const rect = getBasemapCellNormRect(partition, c)
    return {
      ...c,
      locked: false,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
    }
  })
  return { cells, cutsConfirmed: false, pinnedRects: undefined, cellWorldBounds: undefined }
}

/** @deprecated 請用 confirmBasemapPartitionCuts */
export function lockBasemapPartitionCell(
  partition: BasemapPartition,
  cellId: string,
): BasemapPartition | null {
  const cell = partition.cells.find((c) => c.id === cellId)
  if (!cell || cell.locked) return null
  const snapshot = getBasemapCellNormRect(partition, cell)
  const cells = partition.cells.map((c) =>
    c.id === cellId ? { ...c, locked: true } : c,
  )
  return withPinnedRect({ ...partition, cells }, cellId, snapshot)
}

/** @deprecated 請用 reopenBasemapPartitionCuts */
export function unlockBasemapPartitionCell(
  partition: BasemapPartition,
  cellId: string,
): BasemapPartition | null {
  const cell = partition.cells.find((c) => c.id === cellId)
  if (!cell || !cell.locked) return null
  const rect = getBasemapCellNormRect(partition, cell)
  const cells = partition.cells.map((c) =>
    c.id === cellId
      ? { ...c, locked: false, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
      : c,
  )
  const nextPinned = { ...(partition.pinnedRects ?? {}) }
  delete nextPinned[cellId]
  return {
    cells,
    pinnedRects:
      Object.keys(nextPinned).length > 0 ? nextPinned : undefined,
  }
}

function nearlyEqual(a: number, b: number, eps = EDGE_EPS): boolean {
  return Math.abs(a - b) <= eps
}

function overlapSpan(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): { start: number; end: number } | null {
  const start = Math.max(a0, b0)
  const end = Math.min(a1, b1)
  if (end - start <= EDGE_EPS) return null
  return { start, end }
}

export function collectSharedPartitionDividers(
  partition: BasemapPartition,
  widthPx: number,
  heightPx: number,
): BasemapSharedDivider[] {
  if (isBasemapPartitionConfirmed(partition)) return []
  const rects = partitionCellsToPx(partition, widthPx, heightPx)
  const out: BasemapSharedDivider[] = []

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      if (a.locked || b.locked) continue

      const aR = a.x + a.w
      const aB = a.y + a.h
      const bR = b.x + b.w
      const bB = b.y + b.h

      if (nearlyEqual(aR, b.x)) {
        const span = overlapSpan(a.y, aB, b.y, bB)
        if (!span) continue
        out.push({
          id: `${a.id}|${b.id}|col`,
          axis: 'col',
          x: aR,
          y: span.start,
          length: span.end - span.start,
          cellAId: a.id,
          cellBId: b.id,
        })
      } else if (nearlyEqual(bR, a.x)) {
        const span = overlapSpan(a.y, aB, b.y, bB)
        if (!span) continue
        out.push({
          id: `${b.id}|${a.id}|col`,
          axis: 'col',
          x: bR,
          y: span.start,
          length: span.end - span.start,
          cellAId: b.id,
          cellBId: a.id,
        })
      } else if (nearlyEqual(aB, b.y)) {
        const span = overlapSpan(a.x, aR, b.x, bR)
        if (!span) continue
        out.push({
          id: `${a.id}|${b.id}|row`,
          axis: 'row',
          x: span.start,
          y: aB,
          length: span.end - span.start,
          cellAId: a.id,
          cellBId: b.id,
        })
      } else if (nearlyEqual(bB, a.y)) {
        const span = overlapSpan(a.x, aR, b.x, bR)
        if (!span) continue
        out.push({
          id: `${b.id}|${a.id}|row`,
          axis: 'row',
          x: span.start,
          y: bB,
          length: span.end - span.start,
          cellAId: b.id,
          cellBId: a.id,
        })
      }
    }
  }
  return out
}

export function adjustSharedPartitionDivider(
  partition: BasemapPartition,
  divider: BasemapSharedDivider,
  localX: number,
  localY: number,
  widthPx: number,
  heightPx: number,
): BasemapPartition | null {
  if (isBasemapPartitionConfirmed(partition)) return null
  const w = Math.max(1, widthPx)
  const h = Math.max(1, heightPx)
  const cells = partition.cells.map((c) => ({ ...c }))
  const a = cells.find((c) => c.id === divider.cellAId)
  const b = cells.find((c) => c.id === divider.cellBId)
  if (!a || !b || a.locked || b.locked) return null

  if (divider.axis === 'col') {
    const edgePx = localX
    const edgeNorm = clamp01(edgePx / w)
    const aRight = a.x + a.w
    const bRight = b.x + b.w
    const minEdge = a.x + MIN_FRAC
    const maxEdge = bRight - MIN_FRAC
    const nextEdge = Math.min(maxEdge, Math.max(minEdge, edgeNorm))
    a.w = nextEdge - a.x
    b.w = bRight - nextEdge
    b.x = nextEdge
    if (a.w < MIN_FRAC || b.w < MIN_FRAC) return null
  } else {
    const edgePx = localY
    const edgeNorm = clamp01(edgePx / h)
    const aBottom = a.y + a.h
    const bBottom = b.y + b.h
    const minEdge = a.y + MIN_FRAC
    const maxEdge = bBottom - MIN_FRAC
    const nextEdge = Math.min(maxEdge, Math.max(minEdge, edgeNorm))
    a.h = nextEdge - a.y
    b.h = bBottom - nextEdge
    b.y = nextEdge
    if (a.h < MIN_FRAC || b.h < MIN_FRAC) return null
  }

  return {
    cells,
    pinnedRects: partition.pinnedRects,
    cutsConfirmed: partition.cutsConfirmed,
  }
}

function applyLockedResizeDelta(
  origin: BasemapNormRect,
  handle: BasemapLockedResizeHandle,
  dxNorm: number,
  dyNorm: number,
): BasemapNormRect | null {
  let { x, y, w, h } = origin

  if (handle.includes('e')) w += dxNorm
  if (handle.includes('w')) {
    x += dxNorm
    w -= dxNorm
  }
  if (handle.includes('s')) h += dyNorm
  if (handle.includes('n')) {
    y += dyNorm
    h -= dyNorm
  }

  if (w < MIN_FRAC || h < MIN_FRAC) return null

  return {
    x,
    y,
    w: Math.max(MIN_FRAC, w),
    h: Math.max(MIN_FRAC, h),
  }
}

/** 從拖曳起點累積位移調整獨立格（只改寫 pinnedRects） */
export function resizeBasemapLockedCellFromOrigin(
  partition: BasemapPartition,
  cellId: string,
  handle: BasemapLockedResizeHandle,
  originRect: BasemapNormRect,
  totalDxNorm: number,
  totalDyNorm: number,
): BasemapPartition | null {
  const cell = partition.cells.find((c) => c.id === cellId)
  if (!cell) return null
  if (!isBasemapPartitionConfirmed(partition) && !cell.locked) return null
  const nextRect = applyLockedResizeDelta(
    originRect,
    handle,
    totalDxNorm,
    totalDyNorm,
  )
  if (!nextRect) return null
  return {
    ...withPinnedRect(partition, cellId, nextRect),
    cutsConfirmed: partition.cutsConfirmed ?? true,
    cellWorldBounds: partition.cellWorldBounds,
  }
}

export function resizeBasemapLockedCell(
  partition: BasemapPartition,
  cellId: string,
  handle: BasemapLockedResizeHandle,
  dxNorm: number,
  dyNorm: number,
): BasemapPartition | null {
  const cell = partition.cells.find((c) => c.id === cellId)
  if (!cell) return null
  if (!isBasemapPartitionConfirmed(partition) && !cell.locked) return null
  const origin = getBasemapCellNormRect(partition, cell)
  return resizeBasemapLockedCellFromOrigin(
    partition,
    cellId,
    handle,
    origin,
    dxNorm,
    dyNorm,
  )
}

export function getBasemapPartitionCell(
  partition: BasemapPartition,
  cellId: string,
): BasemapPartitionCell | null {
  return partition.cells.find((c) => c.id === cellId) ?? null
}
