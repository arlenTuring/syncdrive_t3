import { describe, expect, it } from 'vitest'
import { classifyYardVehicle } from './yardClassification'

const position = { xM: -882.4, yM: -280, boxes: [], nowMs: 1000 }

describe('位置歸屬', () => {
  it('使用後端設施判定', () => {
    const result = classifyYardVehicle({ ...position, payload: { location_kind: 'FACILITY', segment_label: 'M1' } })
    expect(result.yard).toBe(true)
    expect(result.slotId).toBe('M1')
  })
  it('後端判為軌道時不吸附設施', () => {
    const result = classifyYardVehicle({ ...position, payload: { location_kind: 'TRACK', segment_label: 'D03' } })
    expect(result.yard).toBe(false)
  })
  it('只有車端座標不推定設施歸屬', () => {
    const result = classifyYardVehicle({ ...position, payload: { local_pose: { position: { x: -882.4, y: -280 } }, kinematics: { velocity: 0 } } })
    expect(result.yard).toBe(false)
  })
})
