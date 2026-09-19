import { describe, expect, it } from 'vitest'

import { createUserRestoredVtmsVehicle } from '../constants/userRestoredVtmsVehicle'
import {
  computeVehicleRearAxleAnchorContentPx,
  rearAxleAnchorSource,
} from './vehicleRearAxleAnchor'

describe('後軸錨點', () => {
  it('沒有明確後軸資料時由尾燈估算，並標示是估的', () => {
    const def = createUserRestoredVtmsVehicle()
    expect(rearAxleAnchorSource(def)).toBe('estimated-from-tail-light')
  })

  it('車型明確填了後軸比例就用它，不再看尾燈', () => {
    const base = createUserRestoredVtmsVehicle()
    const body = base.elements.find((el) => el.type === 'body')!
    const estimated = computeVehicleRearAxleAnchorContentPx(base)
    // 後軸距車尾 30% 車長：比估算值（約 18%＋尾燈超出車尾的部分）更靠車頭
    const explicit = { ...base, rearAxleFromTailRatio: 0.3 }
    expect(rearAxleAnchorSource(explicit)).toBe('explicit')
    const anchor = computeVehicleRearAxleAnchorContentPx(explicit)
    expect(anchor.x).toBeLessThan(estimated.x)
    expect(anchor.y).toBeCloseTo(estimated.y, 6)
    // 明確值 0.3 ＝ 沿車體 0.7 處（車頭在 0）：錨點 x 差是車長乘上比例差
    expect(anchor.x - (estimated.x - body.width * (estimatedAlong(base) - 0.7))).toBeCloseTo(0, 6)
  })

  it('不合理的明確值（負數、超過 1、非數字）當作沒填', () => {
    const base = createUserRestoredVtmsVehicle()
    for (const bad of [-0.1, 1.5, Number.NaN]) {
      expect(rearAxleAnchorSource({ ...base, rearAxleFromTailRatio: bad })).toBe(
        'estimated-from-tail-light',
      )
    }
  })
})

/** 與實作同一條式子：尾燈中心的車體比例減去 0.18 */
function estimatedAlong(def: ReturnType<typeof createUserRestoredVtmsVehicle>): number {
  const body = def.elements.find((el) => el.type === 'body')!
  const tail = def.elements.find((el) => el.type === 'light' && el.visibilityField === 'tail_light_on')!
  return (tail.x + tail.width / 2 - body.x) / body.width - 0.18
}
