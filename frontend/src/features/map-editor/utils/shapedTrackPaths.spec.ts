import { describe, expect, it } from 'vitest'

import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { deriveShapedTrackPathsInAreas } from './shapedTrackPaths'
import { getTrackGenPaths } from './trackGenPaths'

/**
 * 分岔軌道：主線道一條、分支一條。
 *
 * 主線道就是外框囊括的那一條（進口 → 直行出口），分支是斜的（進口 → 岔出出口），
 * 與斜接軌道同一回事。現場座標一律回隔壁那一塊拿——自己身上那組參照場域範圍正是
 * 壞掉的東西。
 */

function makeArea() {
  const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
  area.layout = { ...area.layout, xPx: 0, yPx: 0, wPx: 1000, hPx: 1000 }
  area.domain = { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 1000 }
  return area
}

/** 一塊有中心線的直軌道，用來當錨點 */
function rail(
  id: string,
  areaPosition: { x: number; y: number },
  areaSizePx: { w: number; h: number },
  real: Array<[number, number]>,
): FacilityObject {
  return {
    id,
    type: 'Track',
    name: 'Rail',
    customName: id,
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Idle',
    areaPosition,
    areaSizePx,
    parameters: {
      trackGenRealPath: real,
      trackGenLocalPath: [[0, 0.5], [1, 0.5]],
    },
  } as FacilityObject
}

/** 分岔：進口在左、直行出口在右、岔出出口在右下 */
function railSwitch(parts: Record<string, string>): FacilityObject {
  return {
    id: 'sw',
    type: 'Track',
    name: 'RailSwitch',
    customName: '',
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Idle',
    areaPosition: { x: 200, y: 400 },
    areaSizePx: { w: 100, h: 100 },
    parameters: {
      switchTrack: {
        aFrom: 0, aTo: 0.4, mFrom: 0, mTo: 0.4, bFrom: 0.6, bTo: 1,
        mAt: 1, bAt: 1, entryDeg: 0,
      },
      trackGenPartNames: parts,
    },
  } as FacilityObject
}

describe('分岔軌道推中心線', () => {
  it('標直行的推主線道那條：進口 → 直行出口', () => {
    const area = makeArea()
    area.facilities = [
      railSwitch({ straight: 'U20' }),
      // 貼著進口面（左中）
      rail('in', { x: 100, y: 460 }, { w: 100, h: 20 }, [[-100, 10], [-50, 10]]),
      // 貼著直行出口面（右中）
      rail('out', { x: 300, y: 460 }, { w: 100, h: 20 }, [[0, 10], [50, 10]]),
    ]
    const { areas, derived } = deriveShapedTrackPathsInAreas([area])
    expect(derived).toEqual(['U20'])
    const paths = getTrackGenPaths(areas[0].facilities[0].parameters)!
    expect(paths.real[0]).toEqual([-50, 10])
    expect(paths.real[paths.real.length - 1]).toEqual([0, 10])
  })

  it('只標岔出的推分支那條：進口 → 岔出出口，斜的', () => {
    const area = makeArea()
    area.facilities = [
      railSwitch({ branch: 'D20' }),
      rail('in', { x: 100, y: 460 }, { w: 100, h: 20 }, [[-100, 10], [-50, 10]]),
      // 貼著岔出出口面（右下）
      rail('br', { x: 300, y: 400 }, { w: 100, h: 20 }, [[0, -20], [50, -20]]),
    ]
    const { areas, derived } = deriveShapedTrackPathsInAreas([area])
    expect(derived).toEqual(['D20'])
    const paths = getTrackGenPaths(areas[0].facilities[0].parameters)!
    expect(paths.real[0]).toEqual([-50, 10])
    expect(paths.real[paths.real.length - 1]).toEqual([0, -20])
    // 兩端 y 不同＝斜的
    expect(paths.real[0][1]).not.toBe(paths.real[1][1])
  })

  it('外框跟著推出來的中心線走', () => {
    const area = makeArea()
    area.facilities = [
      railSwitch({ branch: 'D20' }),
      rail('in', { x: 100, y: 460 }, { w: 100, h: 20 }, [[-100, 10], [-50, 10]]),
      rail('br', { x: 300, y: 400 }, { w: 100, h: 20 }, [[0, -20], [50, -20]]),
    ]
    const q = deriveShapedTrackPathsInAreas([area]).areas[0].facilities[0]
      .parameters as Record<string, number>
    expect(q.refFieldXMinM).toBe(-50)
    expect(q.refFieldXMaxM).toBe(0)
    expect(q.refFieldYMinM).toBe(-20)
    expect(q.refFieldYMaxM).toBe(10)
  })

  it('有一端找不到隔壁就不推——寧可沒有，也不要編一個座標', () => {
    const area = makeArea()
    area.facilities = [
      railSwitch({ straight: 'U20' }),
      rail('in', { x: 100, y: 460 }, { w: 100, h: 20 }, [[-100, 10], [-50, 10]]),
    ]
    const { areas, derived, skipped } = deriveShapedTrackPathsInAreas([area])
    expect(derived).toEqual([])
    expect(skipped).toEqual(['U20'])
    expect(getTrackGenPaths(areas[0].facilities[0].parameters)).toBeNull()
  })

  it('已經有中心線的不碰', () => {
    const area = makeArea()
    const sw = railSwitch({ straight: 'U20' })
    sw.parameters = {
      ...sw.parameters,
      trackGenRealPath: [[1, 2], [3, 4]],
      trackGenLocalPath: [[0, 0.5], [1, 0.5]],
    }
    area.facilities = [
      sw,
      rail('in', { x: 100, y: 460 }, { w: 100, h: 20 }, [[-100, 10], [-50, 10]]),
      rail('out', { x: 300, y: 460 }, { w: 100, h: 20 }, [[0, 10], [50, 10]]),
    ]
    const { derived, areas } = deriveShapedTrackPathsInAreas([area])
    expect(derived).toEqual([])
    expect(getTrackGenPaths(areas[0].facilities[0].parameters)!.real[0]).toEqual([1, 2])
  })
})
