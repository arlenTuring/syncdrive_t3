import { describe, expect, it } from 'vitest'
import { previousTrackIdOf, type VehiclePlacementAcrossAreas } from './resolveVehicleTrackPlacement'

/**
 * 下一筆定位帶的「上一筆軌道」：軌道的結果要帶，場區車位（格位）不是軌道，不帶。
 */
const placement = (trackId: string): VehiclePlacementAcrossAreas =>
  ({
    area: { id: 'a' },
    placement: { areaLocalX: 0, areaLocalY: 0, trackId, score: 1 },
  }) as unknown as VehiclePlacementAcrossAreas

describe('previousTrackIdOf', () => {
  it('上一筆在軌道上：回那條軌道', () => {
    expect(previousTrackIdOf(placement('D19'), false)).toBe('D19')
  })

  it('上一筆是場區車位：不帶', () => {
    expect(previousTrackIdOf(placement('slot-E1'), true)).toBeUndefined()
  })

  it('沒有上一筆、或沒有 trackId：不帶', () => {
    expect(previousTrackIdOf(null, false)).toBeUndefined()
    expect(previousTrackIdOf(undefined, false)).toBeUndefined()
    expect(previousTrackIdOf(placement(''), false)).toBeUndefined()
  })
})
