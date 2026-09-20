import { describe, expect, it } from 'vitest'

import type { FacilityObject } from '../types/facility'
import { crossBranchToFacility } from './crossBranches'
import { crossTrackPartCentresPx, readCrossTrack } from './trackShapes'
import {
  facilityParts,
  getTrackGenPartLabelHidden,
  getTrackGenPartNames,
  partLabelCanHide,
  patchTrackGenPartLabelHidden,
  patchTrackGenPartName,
} from './trackGenParts'

function cross(parameters: Record<string, unknown> = {}): FacilityObject {
  return {
    id: 'x1',
    type: 'Track',
    name: 'RailCross',
    customName: 'D03/U03',
    parameters,
  } as unknown as FacilityObject
}

describe('交叉軌道四段命名', () => {
  it('交叉有四段：上、下兩條直行加兩條斜行；分岔仍是兩段', () => {
    expect(facilityParts(cross())).toEqual(['up', 'down', 'diagUp', 'diagDown'])
    expect(
      facilityParts({ ...cross(), name: 'RailSwitch' } as FacilityObject),
    ).toEqual(['straight', 'branch'])
  })

  it('斜行的名字可以關閉，直行不行；預設全部顯示', () => {
    expect(partLabelCanHide('diagUp')).toBe(true)
    expect(partLabelCanHide('diagDown')).toBe(true)
    expect(partLabelCanHide('up')).toBe(false)
    const f = cross()
    expect(getTrackGenPartLabelHidden(f)).toEqual({})
    const hidden = cross(patchTrackGenPartLabelHidden(f, 'diagUp', true))
    expect(getTrackGenPartLabelHidden(hidden)).toEqual({ diagUp: true })
    // 再打開就把鍵拿掉，不留 false
    const shown = cross(patchTrackGenPartLabelHidden(hidden, 'diagUp', false))
    expect(getTrackGenPartLabelHidden(shown)).toEqual({})
  })

  it('斜行命名不影響直行的名字', () => {
    const a = cross(patchTrackGenPartName(cross(), 'up', 'D03'))
    const b = cross({ ...a.parameters, ...patchTrackGenPartName(a, 'diagUp', 'X1') })
    expect(getTrackGenPartNames(b)).toEqual({ up: 'D03', diagUp: 'X1' })
  })

  it('兩條斜線的名字錨點各偏一邊，不疊在交叉的正中間', () => {
    const c = crossTrackPartCentresPx(readCrossTrack(undefined), 200, 100)
    expect(c.diagUp.x).toBeLessThan(100)
    expect(c.diagDown.x).toBeGreaterThan(100)
    expect(Math.hypot(c.diagUp.x - c.diagDown.x, c.diagUp.y - c.diagDown.y)).toBeGreaterThan(40)
  })

  it('分支沿用使用者取的名字：車輛標籤與代號對得回屬性框裡的名字', () => {
    const f = cross({ trackGenPartNames: { up: 'D03', diagUp: '轉線甲' } })
    const branch = (route: 'straightTop' | 'diagUp' | 'diagDown', name: string | null) =>
      crossBranchToFacility(f, {
        code: `D03U03_${route}`,
        name,
        facilityId: `x1~${route}`,
        parentId: 'x1',
        route,
        from: 'lb',
        to: 'rt',
        bidirectional: false,
        real: [
          [0, 0],
          [10, 0],
        ],
        local: [
          [0, 0.5],
          [1, 0.5],
        ],
        lengthM: 10,
      })
    expect(branch('diagUp', '轉線甲').customName).toBe('轉線甲')
    // 沒取名的段沿用母體名字
    expect(branch('diagDown', null).customName).toBe('D03/U03')
  })
})
