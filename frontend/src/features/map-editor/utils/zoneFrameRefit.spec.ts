import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { getRefFieldBounds } from './facilityRefFieldBounds'
import {
  applyZoneFrameRect,
  expandZoneFrameToContainChildren,
  rematerializeZoneChildrenOntoZoneCanvas,
  refitZoneFrameKeepingChildren,
  syncZoneChildFieldFromPlacement,
  zoneChildrenFrameBounds,
  zoneFrameRect,
  PARENT_ZONE_ID_KEY,
} from './zonePartition'

function fixture() {
  const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
  area.layout = { ...area.layout, wPx: 1000, hPx: 600 }
  area.domain = { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 60 }
  const zone: FacilityObject = {
    id: 'zone', type: 'Facility', name: 'ZonePartition', customName: '充電區',
    areaPosition: { x: 100, y: 100 }, areaSizePx: { w: 300, h: 160 },
    position: { x: 0, y: 0 }, rotation: 0, currentState: 'Normal',
    parameters: { refFieldXMinM: -290, refFieldXMaxM: -230, refFieldYMinM: 10, refFieldYMaxM: 42 },
  }
  const slot = (id: string, x: number, y: number): FacilityObject => ({
    id, type: 'Facility', name: 'FacilityArea', customName: id,
    areaPosition: { x, y }, areaSizePx: { w: 90, h: 47 },
    position: { x: 0, y: 0 }, rotation: 0, currentState: 'Normal',
    parameters: { [PARENT_ZONE_ID_KEY]: 'zone' },
  })
  let facilities: FacilityObject[] = [zone, slot('W1', 110, 180), slot('E2', 210, 180), slot('E1', 300, 180)]
  // 先照現況把子設施的場域座標與相對位置記好（和編輯器拖曳後的狀態一樣）
  facilities = facilities.map((f) => syncZoneChildFieldFromPlacement(f, { ...area, facilities }))
  return { area, facilities }
}

/** 模擬拖外框：把分區換成 rect，再 refit */
function resizeZone(area: ReturnType<typeof fixture>['area'], facilities: FacilityObject[], rect: { x: number; y: number; w: number; h: number }) {
  const ctx = { ...area, facilities }
  const zone = facilities.find((f) => f.id === 'zone')!
  const prev = zoneFrameRect(zone, ctx)
  const target = expandZoneFrameToContainChildren(rect, zoneChildrenFrameBounds(facilities, 'zone', ctx))
  const next = facilities.map((f) => (f.id === 'zone' ? applyZoneFrameRect(f, target, area) : f))
  return refitZoneFrameKeepingChildren(next, 'zone', prev, { ...area, facilities: next })
}

const pick = (fs: FacilityObject[], id: string) => fs.find((f) => f.id === id)!
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

describe('分區只調外框：子設施不跟著縮放、不重排', () => {
  it('外框往右加寬、往下加高：子設施圖台位置、尺寸、場域座標都不變；分區場域範圍同比例延伸', () => {
    const { area, facilities } = fixture()
    const out = resizeZone(area, facilities, { x: 100, y: 100, w: 450, h: 240 })
    for (const id of ['W1', 'E2', 'E1']) {
      const before = pick(facilities, id)
      const after = pick(out, id)
      assert.deepEqual(after.areaPosition, before.areaPosition)
      assert.deepEqual(after.areaSizePx, before.areaSizePx)
      assert.deepEqual(getRefFieldBounds(after.parameters), getRefFieldBounds(before.parameters))
    }
    const zb = getRefFieldBounds(pick(out, 'zone').parameters)
    // 原本 300px 對 60m（0.2 m/px）；加寬到 450px → 90m，起點不變
    near(zb.xMinM!, -290)
    near(zb.xMaxM!, -200)
    near(zb.yMinM!, 10)
    near(zb.yMaxM!, 10 + 32 * (240 / 160))
  })

  it('外框縮到比子設施還小：只縮到剛好包住子設施，不壓縮子設施', () => {
    const { area, facilities } = fixture()
    const out = resizeZone(area, facilities, { x: 100, y: 100, w: 120, h: 60 })
    const rect = zoneFrameRect(pick(out, 'zone'), { ...area, facilities: out })
    assert.equal(rect.x, 100)
    near(rect.x + rect.w, 390)
    near(rect.y + rect.h, 227)
    for (const id of ['W1', 'E2', 'E1']) {
      assert.deepEqual(pick(out, id).areaSizePx, pick(facilities, id).areaSizePx)
      assert.deepEqual(pick(out, id).areaPosition, pick(facilities, id).areaPosition)
    }
  })

  it('從左邊拖（位置與尺寸一起變）子設施也不動；之後整個分區搬家只平移、不擠壓', () => {
    const { area, facilities } = fixture()
    const resized = resizeZone(area, facilities, { x: 40, y: 100, w: 360, h: 160 })
    assert.deepEqual(pick(resized, 'E2').areaPosition, pick(facilities, 'E2').areaPosition)
    // 搬家：外框平移 (+50, +20)
    const moved = resized.map((f) => (f.id === 'zone' ? applyZoneFrameRect(f, { x: 90, y: 120, w: 360, h: 160 }, area) : f))
    const out = rematerializeZoneChildrenOntoZoneCanvas(moved, 'zone', { ...area, facilities: moved })
    for (const id of ['W1', 'E2', 'E1']) {
      const before = pick(facilities, id)
      const after = pick(out, id)
      near(after.areaPosition.x, before.areaPosition.x + 50)
      near(after.areaPosition.y, before.areaPosition.y + 20)
      assert.deepEqual(after.areaSizePx, before.areaSizePx)
    }
  })

  it('拖子設施時換算的場域座標和縮放外框前一致（分區比例尺沒變）', () => {
    const { area, facilities } = fixture()
    const resized = resizeZone(area, facilities, { x: 60, y: 80, w: 500, h: 260 })
    const again = syncZoneChildFieldFromPlacement(pick(resized, 'E2'), { ...area, facilities: resized })
    const a = getRefFieldBounds(again.parameters)
    const b = getRefFieldBounds(pick(facilities, 'E2').parameters)
    near(a.xMinM!, b.xMinM!, 0.02)
    near(a.xMaxM!, b.xMaxM!, 0.02)
    near(a.yMinM!, b.yMinM!, 0.02)
    near(a.yMaxM!, b.yMaxM!, 0.02)
  })
})
