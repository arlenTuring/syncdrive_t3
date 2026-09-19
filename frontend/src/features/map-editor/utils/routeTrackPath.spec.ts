import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { meterToAreaLocalPx } from './areaCoords'
import {
  ensureRightAnglePathPx,
  resolveRoutePreviewGeometry,
  rightAngleConnectPx,
} from './routeTrackPath'

function isAxisAligned(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return Math.abs(a.x - b.x) < 0.75 || Math.abs(a.y - b.y) < 0.75
}

function facility(
  partial: Partial<FacilityObject> & Pick<FacilityObject, 'id' | 'type'>,
): FacilityObject {
  return {
    name: partial.type,
    customName: partial.customName ?? partial.id,
    position: { x: 0, y: 0 },
    areaPosition: { x: 0, y: 0 },
    areaLayoutAnchor: { wPx: 100, hPx: 100 },
    rotation: 0,
    parameters: {},
    ...partial,
  } as FacilityObject
}

describe('routeTrackPath right-angle connect', () => {
  it('folds diagonal into a right-angle elbow', () => {
    const path = rightAngleConnectPx({ x: 0, y: 0 }, { x: 40, y: 30 }, 'horizontal-first')
    assert.deepEqual(path, [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ])
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isAxisAligned(path[i]!, path[i + 1]!), true)
    }
  })

  it('prefer vertical-first when requested', () => {
    const path = rightAngleConnectPx({ x: 0, y: 0 }, { x: 40, y: 30 }, 'vertical-first')
    assert.deepEqual(path, [
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 40, y: 30 },
    ])
  })

  it('ensures any diagonal segment becomes right-angle', () => {
    const path = ensureRightAnglePathPx([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ])
    assert.ok(path.length >= 3)
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isAxisAligned(path[i]!, path[i + 1]!), true)
    }
  })

  it('connects consecutive stops in order with right angles', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 20, y: 0 }
    const c = { x: 20, y: 15 }
    const path = ensureRightAnglePathPx([
      ...rightAngleConnectPx(a, b),
      ...rightAngleConnectPx(b, c).slice(1),
    ])
    assert.deepEqual(path, [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 15 },
    ])
  })

  it('right-angle between badge 2 and 3 does not dive to unrelated tracks', () => {
    const stop2 = { x: 200, y: 40 }
    const stop3 = { x: 120, y: 40 }
    const path = rightAngleConnectPx(stop2, stop3)
    assert.deepEqual(path, [
      { x: 200, y: 40 },
      { x: 120, y: 40 },
    ])
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isAxisAligned(path[i]!, path[i + 1]!), true)
    }
  })
})

describe('resolveRoutePreviewGeometry corridor separation', () => {
  it('does not invent vertical yellow jumps between disconnected D tracks', () => {
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'A',
        layout: { xPx: 0, yPx: 0, wPx: 2000, hPx: 1200, borderPx: 1 },
        domain: { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 600 },
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'd-north',
            type: 'Track',
            customName: 'D03',
            position: { x: 100, y: 500 },
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 400,
              refFieldYMinM: 490,
              refFieldYMaxM: 510,
            },
          }),
          facility({
            id: 'd-south',
            type: 'Track',
            customName: 'D32',
            position: { x: 100, y: 100 },
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 400,
              refFieldYMinM: 90,
              refFieldYMaxM: 110,
            },
          }),
          facility({
            id: 's-north',
            type: 'DockingPoint',
            customName: 'T3下行',
            position: { x: 200, y: 500 },
            parameters: {
              stationId: 'station_n',
              refFieldXM: 200,
              refFieldYM: 500,
            },
          }),
          facility({
            id: 's-south',
            type: 'DockingPoint',
            customName: 'S2W下行',
            position: { x: 200, y: 100 },
            parameters: {
              stationId: 'station_s',
              refFieldXM: 200,
              refFieldYM: 100,
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_n', 'station_s'])
    assert.equal(geo.pathLegs.length, 0)
    assert.equal(geo.brokenLegs.length, 1)
    // 斷線為兩點直連，不可再折出跨走廊直角垂線網
    assert.equal(geo.brokenLegs[0]!.length, 2)
    assert.ok(geo.warnings.length >= 1)
  })

  it('follows connected D loop using nearest-track snap', () => {
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'A',
        layout: { xPx: 0, yPx: 0, wPx: 2000, hPx: 800, borderPx: 1 },
        domain: { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 400 },
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'd18',
            type: 'Track',
            customName: 'D18',
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 103.5,
              refFieldYMinM: 150,
              refFieldYMaxM: 250,
            },
          }),
          facility({
            id: 'd19',
            type: 'Track',
            customName: 'D19',
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 103.5,
              refFieldYMinM: 250,
              refFieldYMaxM: 303.5,
            },
          }),
          facility({
            id: 'd20',
            type: 'Track',
            customName: 'D20',
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 200,
              refFieldYMinM: 303.5,
              refFieldYMaxM: 307,
            },
          }),
          facility({
            id: 'u20',
            type: 'Track',
            customName: 'U20',
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 200,
              refFieldYMinM: 300,
              refFieldYMaxM: 303.5,
            },
          }),
          facility({
            id: 's1',
            type: 'DockingPoint',
            customName: 'T3下行',
            parameters: {
              stationId: 'station_n',
              refFieldXM: 101.75,
              refFieldYM: 170,
            },
          }),
          facility({
            id: 's2',
            type: 'DockingPoint',
            customName: 'S2W下行',
            parameters: {
              stationId: 'station_s',
              refFieldXM: 150,
              refFieldYM: 305.25,
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_n', 'station_s'])
    assert.equal(geo.followsTracks, true)
    assert.ok(geo.pathLegs.length >= 1)
    assert.equal(geo.brokenLegs.length, 0)
  })

  it('snaps parking stop beyond track tip onto corridor endpoint', () => {
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'A',
        layout: { xPx: 0, yPx: 0, wPx: 4000, hPx: 800, borderPx: 1 },
        domain: { xMinM: 0, xMaxM: 200, yMinM: 0, yMaxM: 40 },
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'u',
            type: 'Track',
            customName: 'U',
            parameters: {
              refFieldXMinM: 0,
              refFieldXMaxM: 50,
              refFieldYMinM: 10,
              refFieldYMaxM: 14,
            },
          }),
          facility({
            id: 't-tip',
            type: 'Track',
            customName: 'T',
            parameters: {
              refFieldXMinM: 50,
              refFieldXMaxM: 100,
              refFieldYMinM: 10,
              refFieldYMaxM: 14,
            },
          }),
          facility({
            id: 'park',
            type: 'DockingPoint',
            customName: '臨停',
            parameters: {
              stationId: 'station_park',
              refFieldXM: 120,
              refFieldYM: 12,
            },
          }),
          facility({
            id: 'main',
            type: 'DockingPoint',
            customName: '正線',
            parameters: {
              stationId: 'station_main',
              refFieldXM: 20,
              refFieldYM: 12,
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_park', 'station_main'])
    assert.equal(geo.brokenLegs.length, 0, geo.warnings.map((w) => w.message).join('; '))
    assert.equal(geo.followsTracks, true)
  })

  it('keeps U-corridor stops on U instead of jumping to parallel D', () => {
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'A',
        layout: { xPx: 0, yPx: 0, wPx: 4000, hPx: 1200, borderPx: 1 },
        domain: { xMinM: 0, xMaxM: 200, yMinM: 0, yMaxM: 60 },
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'd02',
            type: 'Track',
            customName: 'D02',
            parameters: {
              refFieldXMinM: 80,
              refFieldXMaxM: 120,
              refFieldYMinM: 20,
              refFieldYMaxM: 23.5,
            },
          }),
          facility({
            id: 'd03',
            type: 'Track',
            customName: 'D03',
            parameters: {
              refFieldXMinM: 40,
              refFieldXMaxM: 80,
              refFieldYMinM: 20,
              refFieldYMaxM: 23.5,
            },
          }),
          facility({
            id: 'u02',
            type: 'Track',
            customName: 'U02',
            parameters: {
              refFieldXMinM: 80,
              refFieldXMaxM: 120,
              refFieldYMinM: 23.5,
              refFieldYMaxM: 27,
            },
          }),
          facility({
            id: 'u03',
            type: 'Track',
            customName: 'U03',
            parameters: {
              refFieldXMinM: 40,
              refFieldXMaxM: 80,
              refFieldYMinM: 23.5,
              refFieldYMaxM: 27,
            },
          }),
          facility({
            id: 'u04',
            type: 'Track',
            customName: 'U04',
            parameters: {
              refFieldXMinM: 0,
              refFieldXMaxM: 40,
              refFieldYMinM: 23.5,
              refFieldYMaxM: 27,
            },
          }),
          facility({
            id: 's2',
            type: 'DockingPoint',
            customName: 'U02站',
            parameters: {
              stationId: 'station_2',
              refFieldXM: 100,
              refFieldYM: 25.25,
            },
          }),
          facility({
            id: 's3',
            type: 'DockingPoint',
            customName: 'U04站',
            parameters: {
              stationId: 'station_3',
              refFieldXM: 20,
              refFieldYM: 25.25,
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_2', 'station_3'])
    assert.equal(geo.brokenLegs.length, 0, geo.warnings.map((w) => w.message).join('; '))
    assert.equal(geo.followsTracks, true)
    assert.ok(geo.pathLegs[0] && geo.pathLegs[0].length >= 2)
    // 路徑不應出現明顯的跨走廊垂跳（U→D）
    const leg = geo.pathLegs[0]!
    let maxDy = 0
    for (let i = 0; i < leg.length - 1; i++) {
      maxDy = Math.max(maxDy, Math.abs(leg[i + 1]!.y - leg[i]!.y))
    }
    assert.ok(maxDy < 80, `unexpected vertical corridor jump (${maxDy.toFixed(1)} px)`)
  })

  it('keeps consecutive stops on same U02 corridor without D02 vertical jump', () => {
    // 模擬圖面：2、3 都在 U02；3 微偏靠近 D／U 界線，獨立吸附容易吃到 D02
    const layout = { xPx: 0, yPx: 0, wPx: 2000, hPx: 1200, borderPx: 1 }
    const domain = { xMinM: 0, xMaxM: 200, yMinM: 0, yMaxM: 80 }
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'N2W',
        layout,
        domain,
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'd02',
            type: 'Track',
            customName: 'D02',
            parameters: {
              refFieldXMinM: 40,
              refFieldXMaxM: 160,
              refFieldYMinM: 20,
              refFieldYMaxM: 23.5,
            },
          }),
          facility({
            id: 'u02',
            type: 'Track',
            customName: 'U02',
            parameters: {
              refFieldXMinM: 40,
              refFieldXMaxM: 160,
              refFieldYMinM: 23.5,
              refFieldYMaxM: 27,
            },
          }),
          facility({
            id: 's2',
            type: 'DockingPoint',
            customName: '停靠2',
            areaPosition: meterToAreaLocalPx(110, 25.2, domain, layout),
            position: { x: 110, y: 25.2 },
            areaLayoutAnchor: { wPx: 24, hPx: 24 },
            areaSizePx: { w: 24, h: 24 },
            parameters: {
              stationId: 'station_2',
              refFieldXM: 110,
              refFieldYM: 25.2,
            },
          }),
          facility({
            id: 's3',
            type: 'DockingPoint',
            customName: '停靠3',
            // 畫面站標仍在 U；refField 偏界線靠近 D
            areaPosition: meterToAreaLocalPx(70, 25.2, domain, layout),
            position: { x: 70, y: 25.2 },
            areaLayoutAnchor: { wPx: 24, hPx: 24 },
            areaSizePx: { w: 24, h: 24 },
            parameters: {
              stationId: 'station_3',
              refFieldXM: 70,
              refFieldYM: 23.2,
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_2', 'station_3'])
    assert.equal(geo.brokenLegs.length, 0, geo.warnings.map((w) => w.message).join('; '))
    assert.equal(geo.pathLegs.length, 1, 'must draw one connected leg between 2 and 3')
    assert.equal(geo.followsTracks, true)
    const leg = geo.pathLegs[0]!
    assert.ok(leg && leg.length >= 2)
    let maxDy = 0
    for (let i = 0; i < leg.length - 1; i++) {
      maxDy = Math.max(maxDy, Math.abs(leg[i + 1]!.y - leg[i]!.y))
    }
    assert.ok(
      maxDy < 40,
      `2→3 must stay on U02 without vertical D jump (${maxDy.toFixed(1)} px)`,
    )
  })

  it('overrides successful D→U vertical stitch when badges share U corridor', () => {
    // 站標畫面在 U02 共線；吸附一點在 D、一點在 U 時軌道會「成功」長段騎 D 再垂落到 3
    // → 必須改畫站標水平直連（不可依賴 verticalJump／totalDx 比例）
    const layout = { xPx: 0, yPx: 0, wPx: 2000, hPx: 800, borderPx: 1 }
    const domain = { xMinM: 0, xMaxM: 200, yMinM: 0, yMaxM: 100 }
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'N2W',
        layout,
        domain,
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'd02',
            type: 'Track',
            customName: 'D02',
            parameters: {
              refFieldXMinM: 40,
              refFieldXMaxM: 160,
              refFieldYMinM: 20,
              refFieldYMaxM: 23.5,
            },
          }),
          facility({
            id: 'u02',
            type: 'Track',
            customName: 'U02',
            parameters: {
              refFieldXMinM: 40,
              refFieldXMaxM: 160,
              refFieldYMinM: 23.5,
              refFieldYMaxM: 27,
            },
          }),
          facility({
            id: 's2',
            type: 'DockingPoint',
            customName: '停靠2',
            // 畫面站標在 U；refField 偏 D → 異股吸附仍會走出軌道跳線
            areaPosition: meterToAreaLocalPx(120, 25.2, domain, layout),
            position: { x: 120, y: 25.2 },
            areaLayoutAnchor: { wPx: 24, hPx: 24 },
            areaSizePx: { w: 24, h: 24 },
            parameters: {
              stationId: 'station_2',
              refFieldXM: 120,
              refFieldYM: 22,
            },
          }),
          facility({
            id: 's3',
            type: 'DockingPoint',
            customName: '停靠3',
            areaPosition: meterToAreaLocalPx(80, 25.2, domain, layout),
            position: { x: 80, y: 25.2 },
            areaLayoutAnchor: { wPx: 24, hPx: 24 },
            areaSizePx: { w: 24, h: 24 },
            parameters: {
              stationId: 'station_3',
              refFieldXM: 80,
              refFieldYM: 25.2,
            },
          }),
        ],
      },
    ]
    const geo = resolveRoutePreviewGeometry(areas, ['station_2', 'station_3'])
    assert.equal(geo.brokenLegs.length, 0, geo.warnings.map((w) => w.message).join('; '))
    assert.ok(geo.pathLegs[0] && geo.pathLegs[0]!.length >= 2)
    const leg = geo.pathLegs[0]!
    const start = leg[0]!
    const end = leg[leg.length - 1]!
    assert.ok(
      Math.abs(end.x - start.x) > 20,
      `2→3 must run horizontally, got dx=${Math.abs(end.x - start.x).toFixed(1)}`,
    )
    let maxDy = 0
    for (let i = 0; i < leg.length - 1; i++) {
      maxDy = Math.max(maxDy, Math.abs(leg[i + 1]!.y - leg[i]!.y))
    }
    assert.ok(
      maxDy < 40,
      `must not keep D→U vertical jump (${maxDy.toFixed(1)} px)`,
    )
  })
})
