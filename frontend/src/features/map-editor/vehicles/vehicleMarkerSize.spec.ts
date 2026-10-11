import { describe, expect, it } from 'vitest'
import { createUserRestoredVtmsVehicle } from '../../vehicle-editor/constants/userRestoredVtmsVehicle'
import { computeRearAxleAreaLocalForBodyCenterAt } from '../../vehicle-editor/utils/vehicleRearAxleAnchor'
import { resolveMapVehicleMarkerSize } from './resolveMapVehicleTrackSizing'

/*
 * 設施改大小不能改車：使用者放大調度區的格位（實測 D1 由 38×62.63 改成 48×65.99），
 * 車的 marker 仍是圖資管理存的 88×30 框等比塞進去的 88×26.4；只有停車的位置跟著格位中心走。
 */
describe('map vehicle marker size', () => {
  const definition = createUserRestoredVtmsVehicle()
  const setting = { displayWidthPx: 88, displayHeightPx: 30 }
  const fallback = { width: 60, height: 10 }
  const slotBefore = { center: { x: 848.94, y: 377.52 }, size: { w: 38, h: 62.63 } }
  const slotAfter = { center: { x: 824.35, y: 385.84 }, size: { w: 48, h: 65.99 } }

  const park = (slot: typeof slotBefore) => {
    // 車的大小只看模型與設定；格位只決定車身中心停在哪
    const marker = resolveMapVehicleMarkerSize(definition, setting.displayWidthPx, setting.displayHeightPx, fallback)
    const anchor = computeRearAxleAreaLocalForBodyCenterAt(definition, marker.width, marker.height, 90, slot.center)
    return { marker, anchor }
  }

  it('keeps the marker size when only one slot is resized', () => {
    const before = park(slotBefore)
    const after = park(slotAfter)
    expect(after.marker).toEqual(before.marker)
    expect(before.marker.width).toBeCloseTo(88, 6)
    expect(before.marker.height).toBeCloseTo(26.4, 6)
  })

  it('moves the car with the slot centre without changing its body offset', () => {
    const before = park(slotBefore)
    const after = park(slotAfter)
    const offsetBefore = { x: before.anchor.x - slotBefore.center.x, y: before.anchor.y - slotBefore.center.y }
    const offsetAfter = { x: after.anchor.x - slotAfter.center.x, y: after.anchor.y - slotAfter.center.y }
    expect(offsetAfter.x).toBeCloseTo(offsetBefore.x, 9)
    expect(offsetAfter.y).toBeCloseTo(offsetBefore.y, 9)
  })

  it('does not shrink the car to fit a slot that is too small', () => {
    const marker = resolveMapVehicleMarkerSize(definition, 88, 30, fallback)
    // 車長 88 比格位高 65.99 長：照實畫，不縮
    expect(marker.width).toBeGreaterThan(slotAfter.size.h)
  })

  it('keeps the body aspect ratio whatever display box is saved', () => {
    const body = definition.elements.find((el) => el.type === 'body')!
    for (const [w, h] of [[88, 30], [60, 10], [200, 200]]) {
      const marker = resolveMapVehicleMarkerSize(definition, w, h, fallback)
      expect(marker.width / marker.height).toBeCloseTo(body.width / body.height, 9)
    }
  })

  it('uses the icon size only when the map has no vehicle model', () => {
    expect(resolveMapVehicleMarkerSize(null, 88, 30, fallback)).toEqual(fallback)
  })
})
