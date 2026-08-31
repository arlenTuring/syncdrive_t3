import { describe, expect, it } from 'vitest'
import {
  collectBasemapLeafRects,
  createDefaultBasemapCellTree,
  parseBasemapCellTree,
  resetBasemapCellIdCounter,
  setBasemapSplitRatio,
  splitBasemapCell,
  BASEMAP_CELL_TREE_KEY,
} from './basemapCellTree'

describe('basemapCellTree', () => {
  it('starts as single root leaf', () => {
    const tree = createDefaultBasemapCellTree()
    const rects = collectBasemapLeafRects(tree, { x: 0, y: 0, w: 400, h: 300 })
    expect(rects).toHaveLength(1)
    expect(rects[0].id).toBe('root')
    expect(rects[0].w).toBe(400)
    expect(rects[0].h).toBe(300)
  })

  it('splits leaf into row and col halves', () => {
    resetBasemapCellIdCounter(1)
    const tree = createDefaultBasemapCellTree()
    const rowSplit = splitBasemapCell(tree, 'root', 'row')
    expect(rowSplit).not.toBeNull()
    const colSplit = splitBasemapCell(rowSplit!.tree, rowSplit!.newLeafIds[0], 'col')
    expect(colSplit).not.toBeNull()
    const rects = collectBasemapLeafRects(colSplit!.tree, {
      x: 0,
      y: 0,
      w: 400,
      h: 300,
    })
    expect(rects).toHaveLength(3)
    const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(totalArea).toBeCloseTo(400 * 300, 0)
  })

  it('adjusts split ratio', () => {
    resetBasemapCellIdCounter(1)
    const split = splitBasemapCell(createDefaultBasemapCellTree(), 'root', 'col')
    expect(split!.tree.kind).toBe('split')
    const splitId = split!.tree.kind === 'split' ? split.tree.id : ''
    const next = setBasemapSplitRatio(split!.tree, splitId, 0.7)
    expect(next).not.toBeNull()
    const rects = collectBasemapLeafRects(next!, { x: 0, y: 0, w: 100, h: 100 })
    expect(rects[0].w).toBeCloseTo(70, 0)
    expect(rects[1].w).toBeCloseTo(30, 0)
  })

  it('parses stored tree from parameters', () => {
    resetBasemapCellIdCounter(1)
    const split = splitBasemapCell(createDefaultBasemapCellTree(), 'root', 'row')
    const parsed = parseBasemapCellTree({
      [BASEMAP_CELL_TREE_KEY]: split!.tree,
    })
    expect(collectBasemapLeafRects(parsed, { x: 0, y: 0, w: 10, h: 10 })).toHaveLength(
      2,
    )
  })
})
