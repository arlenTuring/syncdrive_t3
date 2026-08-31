import { describe, expect, it } from 'vitest'
import {
  adjustSharedPartitionDivider,
  collectSharedPartitionDividers,
  confirmBasemapPartitionCuts,
  createDefaultBasemapPartition,
  getBasemapCellNormRect,
  isBasemapPartitionConfirmed,
  reopenBasemapPartitionCuts,
  resizeBasemapLockedCell,
  resizeBasemapLockedCellFromOrigin,
  resetBasemapPartitionIdCounter,
  splitBasemapPartitionCell,
} from './basemapPartition'

describe('basemapPartition', () => {
  it('splits cells in draft mode', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    const split = splitBasemapPartitionCell(partition, 'root', 'col')
    expect(split).not.toBeNull()
    partition = split!.partition
    expect(partition.cells).toHaveLength(2)
    expect(isBasemapPartitionConfirmed(partition)).toBe(false)
  })

  it('confirms cuts and makes all cells independently resizable', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    const split = splitBasemapPartitionCell(partition, 'root', 'col')
    partition = split!.partition
    const leftId = split!.newCellIds[0]
    const rightId = split!.newCellIds[1]

    const confirmed = confirmBasemapPartitionCuts(partition)
    expect(confirmed).not.toBeNull()
    expect(isBasemapPartitionConfirmed(confirmed!)).toBe(true)
    expect(confirmed!.pinnedRects?.[leftId]).toBeDefined()
    expect(confirmed!.pinnedRects?.[rightId]).toBeDefined()

    const rightBefore = getBasemapCellNormRect(
      confirmed!,
      confirmed!.cells.find((c) => c.id === rightId)!,
    )
    const leftBefore = getBasemapCellNormRect(
      confirmed!,
      confirmed!.cells.find((c) => c.id === leftId)!,
    )

    const resized = resizeBasemapLockedCell(confirmed!, leftId, 'e', 0.05, 0)
    expect(resized).not.toBeNull()
    const left = getBasemapCellNormRect(
      resized!,
      resized!.cells.find((c) => c.id === leftId)!,
    )
    const right = getBasemapCellNormRect(
      resized!,
      resized!.cells.find((c) => c.id === rightId)!,
    )
    expect(left.w).toBeGreaterThan(leftBefore.w)
    expect(right).toEqual(rightBefore)
  })

  it('resizes confirmed cell from drag origin without stale state', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    partition = splitBasemapPartitionCell(partition, 'root', 'col')!.partition
    const leftId = 'bc1'
    partition = confirmBasemapPartitionCuts(partition)!
    const origin = getBasemapCellNormRect(
      partition,
      partition.cells.find((c) => c.id === leftId)!,
    )

    const step2 = resizeBasemapLockedCellFromOrigin(
      partition,
      leftId,
      'e',
      origin,
      0.08,
      0,
    )!

    const left = getBasemapCellNormRect(
      step2,
      step2.cells.find((c) => c.id === leftId)!,
    )
    expect(left.w).toBeCloseTo(origin.w + 0.08, 4)
  })

  it('reopens confirmed cuts back to draft', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    partition = splitBasemapPartitionCell(partition, 'root', 'col')!.partition
    partition = confirmBasemapPartitionCuts(partition)!
    const reopened = reopenBasemapPartitionCuts(partition)
    expect(reopened).not.toBeNull()
    expect(isBasemapPartitionConfirmed(reopened!)).toBe(false)
    expect(reopened!.pinnedRects).toBeUndefined()
  })

  it('adjusts shared divider only in draft mode', () => {
    resetBasemapPartitionIdCounter(1)
    let partition = createDefaultBasemapPartition()
    partition = splitBasemapPartitionCell(partition, 'root', 'col')!.partition
    const dividers = collectSharedPartitionDividers(partition, 400, 300)
    expect(dividers).toHaveLength(1)
    const next = adjustSharedPartitionDivider(
      partition,
      dividers[0],
      260,
      150,
      400,
      300,
    )
    expect(next).not.toBeNull()
    const totalW = next!.cells.reduce((s, c) => s + c.w, 0)
    expect(totalW).toBeCloseTo(1, 3)

    const confirmed = confirmBasemapPartitionCuts(partition)!
    expect(collectSharedPartitionDividers(confirmed, 400, 300)).toHaveLength(0)
  })
})
