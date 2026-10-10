import { describe, expect, it } from 'vitest'
import { createUserRestoredVtmsVehicle } from '../constants/userRestoredVtmsVehicle'
import { fitVehicleMarkerSize } from './vehicleContentBounds'
import {
  computeVehicleBodyCenterOffsetFromRearAxleInDisplayPx,
  computeVehicleRearAxleAnchorPx,
} from './vehicleRearAxleAnchor'

/*
 * 車身一律等比：顯示框只是上限，車身照模型自己的比例放進去。
 * 這個範例模型的車身是 260×78（3.333:1），編輯畫布本身更大（含燈的留白）。
 */
describe('fitVehicleMarkerSize', () => {
  const def = createUserRestoredVtmsVehicle()
  const body = def.elements.find((el) => el.type === 'body')!
  const ratio = body.width / body.height

  it('keeps the body aspect ratio whatever box it is given', () => {
    for (const [w, h] of [
      [60, 10], // 降級頁以前固定的框：以前直向被壓到 55%
      [88, 30], // 總控大屏的框：以前直向被拉長 14%
      [500, 100],
      [20, 200],
    ]) {
      const fitted = fitVehicleMarkerSize(def, w, h)
      expect(fitted.width / fitted.height).toBeCloseTo(ratio, 9)
      expect(fitted.width).toBeLessThanOrEqual(w + 1e-9)
      expect(fitted.height).toBeLessThanOrEqual(h + 1e-9)
    }
  })

  it('uses the body bounds, not the editor canvas with its margins', () => {
    const fitted = fitVehicleMarkerSize(def, 88, 30)
    expect(fitted.width).toBeCloseTo(88, 6)
    expect(fitted.height).toBeCloseTo(26.4, 6)
  })

  it('places the rear axle and body centre with the same single scale', () => {
    const fitted = fitVehicleMarkerSize(def, 88, 30)
    const pivot = computeVehicleRearAxleAnchorPx(def, fitted.width, fitted.height)
    expect(pivot.x).toBeCloseTo(pivot.contentX * fitted.scale, 9)
    expect(pivot.y).toBeCloseTo(pivot.contentY * fitted.scale, 9)
    // 車身中心在後軸與車頭之間、與車身同一條中線（旋轉 0°）
    const offset = computeVehicleBodyCenterOffsetFromRearAxleInDisplayPx(def, fitted.width, fitted.height, 0)
    expect(Math.abs(offset.dy)).toBeLessThan(1e-9)
  })
})
