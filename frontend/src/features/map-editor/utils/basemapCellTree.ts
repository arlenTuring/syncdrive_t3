export type BasemapCellLeaf = { kind: 'leaf'; id: string }

export type BasemapCellSplit = {
  kind: 'split'
  id: string
  /** row：橫向分割線（上／下）；col：縱向分割線（左／右） */
  axis: 'row' | 'col'
  /** 第一子格（a）佔父格比例 0–1 */
  ratio: number
  a: BasemapCellNode
  b: BasemapCellNode
}

export type BasemapCellNode = BasemapCellLeaf | BasemapCellSplit

export type BasemapCellRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type BasemapSplitDivider = {
  splitId: string
  axis: 'row' | 'col'
  x: number
  y: number
  length: number
}

export const BASEMAP_CELL_TREE_KEY = 'basemapCellTree'

const ROOT_CELL_ID = 'root'
const MIN_RATIO = 0.08
const DEFAULT_RATIO = 0.5

let cellIdCounter = 1

export function resetBasemapCellIdCounter(n = 1): void {
  cellIdCounter = n
}

function nextCellId(): string {
  const id = `bc${cellIdCounter}`
  cellIdCounter += 1
  return id
}

export function createDefaultBasemapCellTree(): BasemapCellLeaf {
  return { kind: 'leaf', id: ROOT_CELL_ID }
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio))
}

function isCellNode(v: unknown): v is BasemapCellNode {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.kind === 'leaf') return typeof o.id === 'string'
  if (o.kind === 'split') {
    return (
      typeof o.id === 'string' &&
      (o.axis === 'row' || o.axis === 'col') &&
      typeof o.ratio === 'number' &&
      isCellNode(o.a) &&
      isCellNode(o.b)
    )
  }
  return false
}

export function parseBasemapCellTree(
  parameters: Record<string, unknown> | undefined,
): BasemapCellNode {
  const raw = parameters?.[BASEMAP_CELL_TREE_KEY]
  if (!isCellNode(raw)) return createDefaultBasemapCellTree()
  return raw
}

export function findBasemapCellNode(
  node: BasemapCellNode,
  cellId: string,
): BasemapCellNode | null {
  if (node.kind === 'leaf') {
    return node.id === cellId ? node : null
  }
  return findBasemapCellNode(node.a, cellId) ?? findBasemapCellNode(node.b, cellId)
}

export function findParentSplitOfLeaf(
  node: BasemapCellNode,
  leafId: string,
  parent: BasemapCellSplit | null = null,
): BasemapCellSplit | null {
  if (node.kind === 'leaf') {
    return node.id === leafId ? parent : null
  }
  return (
    findParentSplitOfLeaf(node.a, leafId, node) ??
    findParentSplitOfLeaf(node.b, leafId, node)
  )
}

export function collectBasemapLeafRects(
  node: BasemapCellNode,
  bounds: { x: number; y: number; w: number; h: number },
): BasemapCellRect[] {
  if (node.kind === 'leaf') {
    return [{ id: node.id, ...bounds }]
  }
  const ratio = clampRatio(node.ratio)
  if (node.axis === 'col') {
    const wA = bounds.w * ratio
    const wB = bounds.w - wA
    return [
      ...collectBasemapLeafRects(node.a, {
        x: bounds.x,
        y: bounds.y,
        w: wA,
        h: bounds.h,
      }),
      ...collectBasemapLeafRects(node.b, {
        x: bounds.x + wA,
        y: bounds.y,
        w: wB,
        h: bounds.h,
      }),
    ]
  }
  const hA = bounds.h * ratio
  const hB = bounds.h - hA
  return [
    ...collectBasemapLeafRects(node.a, {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: hA,
    }),
    ...collectBasemapLeafRects(node.b, {
      x: bounds.x,
      y: bounds.y + hA,
      w: bounds.w,
      h: hB,
    }),
  ]
}

export function collectBasemapSplitDividers(
  node: BasemapCellNode,
  bounds: { x: number; y: number; w: number; h: number },
): BasemapSplitDivider[] {
  if (node.kind === 'leaf') return []
  const ratio = clampRatio(node.ratio)
  const out: BasemapSplitDivider[] = []
  if (node.axis === 'col') {
    const wA = bounds.w * ratio
    out.push({
      splitId: node.id,
      axis: 'col',
      x: bounds.x + wA,
      y: bounds.y,
      length: bounds.h,
    })
    out.push(
      ...collectBasemapSplitDividers(node.a, {
        x: bounds.x,
        y: bounds.y,
        w: wA,
        h: bounds.h,
      }),
      ...collectBasemapSplitDividers(node.b, {
        x: bounds.x + wA,
        y: bounds.y,
        w: bounds.w - wA,
        h: bounds.h,
      }),
    )
  } else {
    const hA = bounds.h * ratio
    out.push({
      splitId: node.id,
      axis: 'row',
      x: bounds.x,
      y: bounds.y + hA,
      length: bounds.w,
    })
    out.push(
      ...collectBasemapSplitDividers(node.a, {
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: hA,
      }),
      ...collectBasemapSplitDividers(node.b, {
        x: bounds.x,
        y: bounds.y + hA,
        w: bounds.w,
        h: bounds.h - hA,
      }),
    )
  }
  return out
}

function mapBasemapCellTree(
  node: BasemapCellNode,
  fn: (n: BasemapCellNode) => BasemapCellNode | null,
): BasemapCellNode | null {
  const next = fn(node)
  if (!next) return null
  if (next.kind === 'leaf') return next
  const a = mapBasemapCellTree(next.a, fn)
  const b = mapBasemapCellTree(next.b, fn)
  if (!a || !b) return null
  return { ...next, a, b }
}

export function splitBasemapCell(
  tree: BasemapCellNode,
  leafId: string,
  axis: 'row' | 'col',
): { tree: BasemapCellNode; newLeafIds: [string, string] } | null {
  const leafA = nextCellId()
  const leafB = nextCellId()
  let replaced = false
  const next = mapBasemapCellTree(tree, (node) => {
    if (node.kind !== 'leaf' || node.id !== leafId) return node
    replaced = true
    return {
      kind: 'split',
      id: nextCellId(),
      axis,
      ratio: DEFAULT_RATIO,
      a: { kind: 'leaf', id: leafA },
      b: { kind: 'leaf', id: leafB },
    }
  })
  if (!replaced || !next) return null
  return { tree: next, newLeafIds: [leafA, leafB] }
}

export function setBasemapSplitRatio(
  tree: BasemapCellNode,
  splitId: string,
  ratio: number,
): BasemapCellNode | null {
  let updated = false
  const next = mapBasemapCellTree(tree, (node) => {
    if (node.kind !== 'split' || node.id !== splitId) return node
    updated = true
    return { ...node, ratio: clampRatio(ratio) }
  })
  return updated && next ? next : null
}

export function ratioFromDividerDrag(
  divider: BasemapSplitDivider,
  bounds: { x: number; y: number; w: number; h: number },
  clientLocalX: number,
  clientLocalY: number,
): number {
  if (divider.axis === 'col') {
    const rel = (clientLocalX - bounds.x) / Math.max(1, bounds.w)
    return clampRatio(rel)
  }
  const rel = (clientLocalY - bounds.y) / Math.max(1, bounds.h)
  return clampRatio(rel)
}

export function hitBasemapLeafAt(
  tree: BasemapCellNode,
  widthPx: number,
  heightPx: number,
  localX: number,
  localY: number,
): string | null {
  const rects = collectBasemapLeafRects(tree, {
    x: 0,
    y: 0,
    w: widthPx,
    h: heightPx,
  })
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

export function getSplitBounds(
  tree: BasemapCellNode,
  splitId: string,
  widthPx: number,
  heightPx: number,
): { x: number; y: number; w: number; h: number } | null {
  let found: { x: number; y: number; w: number; h: number } | null = null
  const walk = (
    node: BasemapCellNode,
    bounds: { x: number; y: number; w: number; h: number },
  ): void => {
    if (found) return
    if (node.kind === 'leaf') return
    if (node.id === splitId) {
      found = bounds
      return
    }
    const ratio = clampRatio(node.ratio)
    if (node.axis === 'col') {
      const wA = bounds.w * ratio
      walk(node.a, { x: bounds.x, y: bounds.y, w: wA, h: bounds.h })
      walk(node.b, {
        x: bounds.x + wA,
        y: bounds.y,
        w: bounds.w - wA,
        h: bounds.h,
      })
    } else {
      const hA = bounds.h * ratio
      walk(node.a, { x: bounds.x, y: bounds.y, w: bounds.w, h: hA })
      walk(node.b, {
        x: bounds.x,
        y: bounds.y + hA,
        w: bounds.w,
        h: bounds.h - hA,
      })
    }
  }
  walk(tree, { x: 0, y: 0, w: widthPx, h: heightPx })
  return found
}
