import { describe, expect, it } from 'vitest'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  drawnDirectionAtField,
  drawnRotateWithSwingDeg,
  rotateDegForDrawnDirection,
} from './resolveVehicleTrackPlacement'

/**
 * 車頭讀值屬於「最新定位那一點」。補間中的車還在往那一點走，擺動量要拿定位點的切線算，
 * 不能拿補間中位置的切線算——否則彎道入口的車會吃到出口的角度，車身提前轉向。
 */

const R = 30
// 四分之一圓：從 (0,0) 朝東出發，走到 (30,30) 朝北
const real: [number, number][] = []
for (let deg = 0; deg <= 90; deg += 5) {
  const a = (deg * Math.PI) / 180
  real.push([R * Math.sin(a), R - R * Math.cos(a)])
}
// 圖面路徑：同形狀縮進單位框（y 朝下）
const local = real.map(([x, y]) => [x / R, 1 - y / R])

const track = {
  id: 'arc',
  type: 'Track',
  name: 'arc',
  customName: 'arc',
  position: { x: 0, y: 0 },
  size: { w: 300, h: 300 },
  areaPosition: { x: 0, y: 0 },
  areaSizePx: { w: 300, h: 300 },
  parameters: {
    trackGenRealPath: real,
    trackGenLocalPath: local,
    trackGenSpans: [{ road: 'arc', lane: -1, s0: 0, s1: 47, h: 0, f0: 0, f1: 1 }],
  },
} as unknown as FacilityObject

const area = {
  id: 'a',
  name: 'a',
  domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
  layout: { xPx: 0, yPx: 0, wPx: 300, hPx: 300 },
  facilities: [track],
} as unknown as MapAreaObject

const NORTH = Math.PI / 2

describe('擺動量用定位那一點的切線算', () => {
  it('車頭讀值＝定位點（出口）的切線，車畫在彎道中段：不該有擺動', () => {
    // 定位點在出口（along=1），車頭朝北，剛好順著切線；畫的位置在中段（along=0.5）
    const drawn = drawnDirectionAtField(track, area, 30, 30, NORTH, 0.5, { track, along: 1 })!
    const base = rotateDegForDrawnDirection(drawn)
    const withRef = drawnRotateWithSwingDeg(track, area, 30, 30, NORTH, 0.5, { track, along: 1 })!
    // 折線每 5 度一段，端點的切線是最後一段（87.5 度），所以容許 3 度的離散誤差
    expect(Math.abs(withRef - base)).toBeLessThan(3)
  })

  it('不帶參考點：拿中段的切線算，就會吃到 45 度的假擺動（舊行為）', () => {
    const drawn = drawnDirectionAtField(track, area, 30, 30, NORTH, 0.5)!
    const base = rotateDegForDrawnDirection(drawn)
    const legacy = drawnRotateWithSwingDeg(track, area, 30, 30, NORTH, 0.5)!
    expect(Math.abs(Math.abs(legacy - base) - 45)).toBeLessThan(4)
  })

  it('真的有擺動（車頭比定位點的切線偏 10 度）：照樣看得到', () => {
    const swung = NORTH + (10 * Math.PI) / 180
    const drawn = drawnDirectionAtField(track, area, 30, 30, swung, 0.5, { track, along: 1 })!
    const base = rotateDegForDrawnDirection(drawn)
    const withRef = drawnRotateWithSwingDeg(track, area, 30, 30, swung, 0.5, { track, along: 1 })!
    expect(Math.abs(Math.abs(withRef - base) - 10)).toBeLessThan(3)
  })
})
