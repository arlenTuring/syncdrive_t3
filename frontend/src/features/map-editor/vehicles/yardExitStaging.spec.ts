import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { FacilityObject } from '../types/facility'
import { decideYardExitStage, zoneEntranceForSlot, type OrderTaskMeta } from './yardExitStaging'

/** 2026-10-05 的本機圖資（地圖_20261005 v0.4）：D1 屬調度區 → 整備調度區出入口；E1 屬充電區 → 充電洗車區出入口 */
const raw = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../../backend/data/published-maps/map-1789194688160-bu1e5q6.json'), 'utf-8'),
) as { mapDocument?: { areas: Array<{ facilities: FacilityObject[] }> }; areas?: Array<{ facilities: FacilityObject[] }> }
const facilities = (raw.mapDocument ?? raw).areas!.flatMap((a) => a.facilities)

const exitMeta: OrderTaskMeta = { transitionPurpose: 'yard_exit', transitionFacility: 'D1', yardSlotId: 'D1' }
const started = { order_status: 'PROCESSING', vehicle_phase: 'TRANSITING', kinematics: { velocity: 3 } }

describe('出廠車的呈現', () => {
  it('出入口照圖資明寫的鏈找：調度區、整備區 → 整備調度區；充電區 → 充電洗車區', () => {
    assert.equal(zoneEntranceForSlot(facilities, 'D1')?.entrance.customName, '整備調度區')
    assert.equal(zoneEntranceForSlot(facilities, 'M2')?.entrance.customName, '整備調度區')
    assert.equal(zoneEntranceForSlot(facilities, 'E1')?.entrance.customName, '充電洗車區')
    const wp = zoneEntranceForSlot(facilities, 'D1')!.waypoint!
    assert.ok(Math.abs(wp.xM + 874.7) < 0.1 && Math.abs(wp.yM + 324.6) < 0.1)
  })

  it('任務還沒開始：不處理，車留在格位', () => {
    const r = decideYardExitStage({ orderId: 'O1', meta: exitMeta, payload: { order_status: 'PENDING', vehicle_phase: 'IDLE' }, xM: -894.5, yM: -339.3, onRoadTrack: false, facilities, previous: undefined })
    assert.equal(r.stage, null)
  })

  it('已開始、還在出入口（PMS02 實錄的第一筆）：畫在出入口，標示出廠中；停著是準備出廠', () => {
    const moving = decideYardExitStage({ orderId: 'O1', meta: exitMeta, payload: started, xM: -874.7, yM: -324.6, onRoadTrack: true, facilities, previous: undefined })
    assert.equal(moving.stage?.label, '出廠中')
    assert.equal(moving.stage?.entrance.customName, '整備調度區')
    const still = decideYardExitStage({ orderId: 'O1', meta: exitMeta, payload: { ...started, kinematics: { velocity: 0 } }, xM: -894.5, yM: -339.3, onRoadTrack: false, facilities, previous: undefined })
    assert.equal(still.stage?.label, '準備出廠')
  })

  it('接上道路（離途經點 10 公尺以上、有效軌道定位）就照道路顯示，之後不再回到出入口', () => {
    const joined = decideYardExitStage({ orderId: 'O1', meta: exitMeta, payload: started, xM: -875.2, yM: -310, onRoadTrack: true, facilities, previous: undefined })
    assert.equal(joined.stage, null)
    assert.equal(joined.latch?.joinedRoad, true)
    const back = decideYardExitStage({ orderId: 'O1', meta: exitMeta, payload: started, xM: -874.7, yM: -324.6, onRoadTrack: true, facilities, previous: joined.latch })
    assert.equal(back.stage, null)
  })

  it('不是出廠任務（進廠、正線、沒有結構化欄位）一律不處理', () => {
    for (const meta of [{ ...exitMeta, transitionPurpose: 'yard_entry' }, { ...exitMeta, transitionPurpose: null }, undefined]) {
      assert.equal(decideYardExitStage({ orderId: 'O1', meta, payload: started, xM: -874.7, yM: -324.6, onRoadTrack: false, facilities, previous: undefined }).stage, null)
    }
  })
})
