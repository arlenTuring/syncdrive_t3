import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { MapAreaObject } from '../types/area'
import { withCrossBranchTracks } from '../utils/crossBranches'
import { getTrackGenPaths } from '../utils/trackGenPaths'
import { locateByField } from '../utils/trackGenLocate'
import { collectYardSlotFieldBoxes } from '../utils/yardFacilitySlots'
import { resolveFacilityAreaPosition, resolveFacilityAreaSize } from '../utils/facilityAreaCoords'
import { buildTrackNetwork, resolveVehiclePlacementAcrossAreas } from './resolveVehicleTrackPlacement'
import { findRefFieldSegmentsAtPoint, locateOnTrackNetwork, LOCATE_TOLERANCE_M, trackAcceptDistanceM } from './trackNetwork/locate'
import { TRACK_HALF_WIDTH_M } from './quantisedTrackCell'
import { classifyYardVehicle } from './yardClassification'
import { passageProgress } from './vehicleRoofIndicator'
import { trackerNext, trackerPrior, type BranchTrackState } from './vehicleBranchTracker'

/**
 * 「找到最近軌道」不等於「車在那條軌道上」：用 2026-09-25 實錄時的地圖快照驗。
 *
 * 這張圖的場區：整備區（x −900～−873、y −330～−262）、調度區（y −380～−330），軌道 167 是穿過
 * 整備區、經過格位 M1 的支線。舊規則只要 |offsetM| ≤ 25 m 就接受，場區裡離 167 十幾公尺的車也被
 * 判成「在 167 上、偏十幾公尺」再往旁邊外插。
 */
const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/locate-anomalies-20260925.json'), 'utf-8'),
) as { map: { areas: MapAreaObject[] } }
const areas = withCrossBranchTracks(fixture.map.areas)
const network = buildTrackNetwork(areas)
const index = network.genIndex!
const facility = (id: string) => areas[0]!.facilities.find((f) => f.id === id)!

function insideFacility(id: string, x: number, y: number): boolean {
  const f = facility(id)
  const pos = resolveFacilityAreaPosition(f, areas[0]!.domain, areas[0]!.layout)
  const size = resolveFacilityAreaSize(f, areas[0]!.domain, areas[0]!.layout)
  return x >= pos.x - 1e-6 && x <= pos.x + size.w + 1e-6 && y >= pos.y - 1e-6 && y <= pos.y + size.h + 1e-6
}

const moving = { local_pose: { heading: 0 }, kinematics: { velocity: 6 } }

describe('接受範圍', () => {
  it('沒有圖資寬度時用既有保守半寬＋有依據的容差，不是任意大距離', () => {
    expect(trackAcceptDistanceM(facility('167'))).toBeCloseTo(TRACK_HALF_WIDTH_M + LOCATE_TOLERANCE_M, 6)
    expect(trackAcceptDistanceM({ parameters: { trackWidthM: 4 } })).toBeCloseTo(2 + LOCATE_TOLERANCE_M, 6)
  })
})

describe('場區內、離主軌道十幾公尺', () => {
  it('不當成主軌道定位；用場區分區映射，不帶軌道的路網資訊', () => {
    const raw = locateByField(index, -889, -320)!
    // 舊規則會接受：最近的是 167，偏 13.8 m（< 25 m）
    expect(raw.facilityId).toBe('167')
    expect(raw.distanceM).toBeGreaterThan(10)

    const hit = resolveVehiclePlacementAcrossAreas(areas, -889, -320, network, { payload: moving, speedMps: 6 })!
    expect(hit.placement.source).toBe('zone')
    expect(hit.placement.trackId).toBe('125')
    expect(hit.placement.network).toBeUndefined()
    expect(insideFacility('125', hit.placement.areaLocalX, hit.placement.areaLocalY)).toBe(true)
  })
})

describe('軌道端點外：橫向偏移小、完整距離大', () => {
  it('不因 |offsetM| 小就接受', () => {
    const raw = locateByField(index, -876, -340)!
    expect(raw.facilityId).toBe('167')
    expect(Math.abs(raw.offsetM)).toBeLessThan(3)
    expect(raw.distanceM).toBeGreaterThan(10)
    expect(locateOnTrackNetwork(network, -876, -340)).toBeNull()
    const hit = resolveVehiclePlacementAcrossAreas(areas, -876, -340, network, { payload: moving, speedMps: 6 })!
    expect(hit.placement.source).toBe('zone')
    expect(hit.placement.trackId).toBe('129')
  })
})

describe('距離檢查拒絕後', () => {
  it('後備路徑不會把同一條生成軌道選回來', () => {
    // 找一個落在 167 的場域範圍（refField 外框）內、卻超出接受距離的點
    const seg = network.byTrackId.get('167')!
    const b = seg.bounds
    let probe: [number, number] | null = null
    for (let x = b.xMinM; x <= b.xMaxM && !probe; x += 0.5) {
      for (let y = b.yMinM; y <= b.yMaxM && !probe; y += 0.5) {
        const r = locateByField(index, x, y)
        if (r && r.facilityId === '167' && r.distanceM > trackAcceptDistanceM(seg.track) + 0.5) probe = [x, y]
      }
    }
    expect(probe).not.toBeNull()
    const [x, y] = probe!
    expect(findRefFieldSegmentsAtPoint(network, x, y).some((s) => s.trackId === '167')).toBe(true)
    const hit = locateOnTrackNetwork(network, x, y)
    expect(hit?.placement.trackId).not.toBe('167')
  })
})

describe('支線穿過格位範圍', () => {
  it('開過 M1 的車沿著 167，不跳到格位中心', () => {
    const boxes = collectYardSlotFieldBoxes(areas)
    const m1 = boxes.find((bx) => bx.slotId === 'M1')!
    const real = getTrackGenPaths(facility('167').parameters)!.real
    const samples: Array<[number, number]> = []
    for (let i = 1; i < real.length; i += 1) {
      const [ax, ay] = real[i - 1]!
      const [bx, by] = real[i]!
      for (let t = 0; t <= 1; t += 0.01) {
        const x = ax + (bx - ax) * t
        const y = ay + (by - ay) * t
        if (x >= m1.xMinM && x <= m1.xMaxM && y >= m1.yMinM && y <= m1.yMaxM) samples.push([x, y])
      }
    }
    expect(samples.length).toBeGreaterThan(3)
    let prev: ReturnType<typeof classifyYardVehicle>['state'] | undefined
    samples.forEach(([x, y], i) => {
      const decision = classifyYardVehicle({ payload: moving, xM: x, yM: y, boxes, nowMs: 1_000 + i * 1_000, previous: prev })
      prev = decision.state
      expect(decision.yard).toBe(false)
      const hit = resolveVehiclePlacementAcrossAreas(areas, x, y, network, {
        preferYardPlacement: decision.yard,
        payload: moving,
        speedMps: 6,
      })!
      expect(hit.placement.source).toBe('generated')
      expect(hit.placement.trackId).toBe('167')
      expect(hit.placement.network!.distanceM!).toBeLessThan(0.1)
    })
  })
})

describe('軌道 → 場區 → 軌道', () => {
  it('場區那段不帶軌道資訊；回到軌道時不沿用過時的分支與進度', () => {
    const real = getTrackGenPaths(facility('167').parameters)!.real
    const onTrack = real[Math.floor(real.length / 2)]!
    const path: Array<[number, number]> = [
      [onTrack[0], onTrack[1]],
      [-889, -320],
      [-889, -318],
      [onTrack[0], onTrack[1]],
    ]
    let tracker: BranchTrackState | undefined
    let passage: ReturnType<typeof passageProgress>['state'] | undefined
    const seen: Array<{ source: string | undefined; prior: string | undefined; hasNetwork: boolean; passageReset: boolean }> = []
    path.forEach(([x, y], i) => {
      const frame = { t: 1_000 + i * 1_000, xM: x, yM: y, orderKey: null, routeKey: null, mapKey: 'm', speedMps: 6 }
      const prior = trackerPrior(tracker, frame)
      const hit = resolveVehiclePlacementAcrossAreas(areas, x, y, network, {
        payload: moving,
        speedMps: 6,
        previousTrackId: prior.previousBranchId,
      })!
      const fix = hit.placement.network
      // 與圖台相同的規則：不在生成軌道上就清掉分支狀態與通行進度
      const passageReset = hit.placement.source !== 'generated'
      if (hit.placement.source !== 'generated') {
        tracker = undefined
        passage = undefined
      } else {
        tracker = trackerNext(tracker, frame, prior, { branchId: hit.placement.trackId, alongFrac: fix!.alongFrac, confirmed: fix!.identity?.status === 'confirmed' }, null)
        passage = passageProgress(passage, hit.placement.trackId, fix!.alongFrac, false).state
      }
      seen.push({ source: hit.placement.source, prior: prior.previousBranchId, hasNetwork: fix !== undefined, passageReset })
    })
    expect(seen.map((s) => s.source)).toEqual(['generated', 'zone', 'zone', 'generated'])
    expect(seen[1]!.hasNetwork).toBe(false)
    expect(seen[2]!.hasNetwork).toBe(false)
    // 回到軌道那一筆：沒有沿用進場區前的分支
    expect(seen[3]!.prior).toBeUndefined()
  })
})
