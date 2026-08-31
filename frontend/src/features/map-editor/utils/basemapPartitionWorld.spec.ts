import { describe, expect, it } from 'vitest'
import {
  confirmBasemapPartitionCuts,
  createDefaultBasemapPartition,
  resetBasemapPartitionIdCounter,
  resizeBasemapLockedCell,
  splitBasemapPartitionCell,
} from './basemapPartition'
import {
  attachPartitionCellWorldBounds,
  getPartitionCellWorldBounds,
  normRectToWorldBounds,
} from './basemapPartitionWorld'

const PARENT = { xmin: 0, ymin: 0, xmax: 100, ymax: 50 }

describe('basemapPartitionWorld', () => {
  it('maps norm rect to world bounds with flipped Y', () => {
    const world = normRectToWorldBounds({ x: 0, y: 0, w: 0.5, h: 0.5 }, PARENT)
    expect(world.xmin).toBe(0)
    expect(world.xmax).toBe(50)
    expect(world.ymax).toBe(50)
    expect(world.ymin).toBe(25)
  })

  it('attaches cell world bounds on confirm', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    partition = splitBasemapPartitionCell(partition, 'root', 'col')!.partition
    const confirmed = confirmBasemapPartitionCuts(partition)!
    const withWorld = attachPartitionCellWorldBounds(confirmed, PARENT)

    expect(withWorld.cellWorldBounds?.bc1).toEqual({
      xmin: 0,
      xmax: 50,
      ymax: 50,
      ymin: 0,
    })
    expect(withWorld.cellWorldBounds?.bc2).toEqual({
      xmin: 50,
      xmax: 100,
      ymax: 50,
      ymin: 0,
    })

    const cell2 = getPartitionCellWorldBounds(withWorld, 'bc2', PARENT)
    expect(cell2?.xmin).toBe(50)
  })

  it('keeps cell world bounds when only pixel layout changes', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    partition = splitBasemapPartitionCell(partition, 'root', 'col')!.partition
    const leftId = 'bc1'
    let confirmed = attachPartitionCellWorldBounds(
      confirmBasemapPartitionCuts(partition)!,
      PARENT,
    )
    const before = confirmed.cellWorldBounds![leftId]

    confirmed = resizeBasemapLockedCell(
      confirmed,
      leftId,
      'e',
      0.1,
      0,
    )!

    expect(confirmed.cellWorldBounds![leftId]).toEqual(before)
  })
})
