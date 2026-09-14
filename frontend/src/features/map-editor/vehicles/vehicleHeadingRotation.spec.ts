import { describe, expect, it } from 'vitest'

import {
  headingRadToClockwiseDeg,
  mapVehiclePivotRotateDeg,
  readVehicleHeadingRad,
} from './readVehicleHeading'

/**
 * 車頭朝向的兩個座標系。
 *
 * 協議的 `local_pose.heading` 是車端 ROS2 map frame：x 向東、y 向北、**逆時針**為正。
 * 畫面的方位角是**順時針**（東 0、南 90、西 180、北 270）。兩者旋轉方向相反。
 *
 * 這組測試把這件事釘住：少了反號時，橫向兩個方向剛好還是對的（0 與 180 反號後
 * 不變），所以看畫面看不出來——只有縱向與斜向會整個顛倒。
 */

/** 模板 rot=0 時車頭朝西，也就是畫面的 (−1, 0)；套上 CSS rotate(deg) 後車頭指向哪 */
function noseOnScreen(rotateDeg: number): { x: number; y: number } {
  const r = (rotateDeg * Math.PI) / 180
  return {
    x: Number((-Math.cos(r)).toFixed(3)),
    y: Number((-Math.sin(r)).toFixed(3)),
  }
}

describe('heading → 畫面方位', () => {
  it('東西向不受反號影響', () => {
    expect(headingRadToClockwiseDeg(0)).toBe(0)
    expect(headingRadToClockwiseDeg(Math.PI)).toBe(180)
  })

  it('南北向要反過來：場域的正北是畫面方位的 270', () => {
    expect(headingRadToClockwiseDeg(Math.PI / 2)).toBe(270)
    expect(headingRadToClockwiseDeg(-Math.PI / 2)).toBe(90)
  })
})

describe('車頭在畫面上指向哪', () => {
  const cases: Array<[string, number, { x: number; y: number }]> = [
    ['往東（場域 +x）→ 畫面往右', 0, { x: 1, y: 0 }],
    ['往西（場域 −x）→ 畫面往左', Math.PI, { x: -1, y: 0 }],
    ['往北（場域 +y）→ 畫面往上', Math.PI / 2, { x: 0, y: -1 }],
    ['往南（場域 −y）→ 畫面往下', -Math.PI / 2, { x: 0, y: 1 }],
  ]

  for (const [name, headingRad, expected] of cases) {
    it(name, () => {
      const rotateDeg = mapVehiclePivotRotateDeg(headingRad, true)
      expect(rotateDeg).not.toBeUndefined()
      const nose = noseOnScreen(rotateDeg!)
      expect(nose.x).toBeCloseTo(expected.x, 2)
      expect(nose.y).toBeCloseTo(expected.y, 2)
    })
  }
})

describe('四元數與 heading 要一致', () => {
  it('沒有 heading 欄位時由四元數還原', () => {
    const h = Math.PI / 2
    const payload = {
      local_pose: {
        orientation: { w: Math.cos(h / 2), x: 0, y: 0, z: Math.sin(h / 2) },
      },
    }
    expect(readVehicleHeadingRad(payload)).toBeCloseTo(h, 6)
  })
})
