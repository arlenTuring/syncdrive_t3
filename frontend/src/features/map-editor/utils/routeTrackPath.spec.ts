import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  TRACK_CROSSOVER_PORTALS_KEY,
  crossoverPortalTopologyNodeId,
} from './trackCrossoverFacility'
import {
  ensureRightAnglePathPx,
  resolveExplicitCrossoverPortalLegPathPx,
  resolveRoutePreviewGeometry,
  rightAngleConnectPx,
} from './routeTrackPath'
import { resolveCrossoverPortalRouteStopMapPx } from './routePlanning'

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

function makeCrossoverArea(): MapAreaObject {
  return {
    id: '1',
    customName: 'A',
    layout: { xPx: 0, yPx: 0, wPx: 800, hPx: 600, borderPx: 1 },
    domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
    view: { panXM: 0, panYM: 0, zoom: 1 },
    facilities: [
      facility({
        id: 'xo1',
        type: 'TrackCrossover',
        parameters: {
          [TRACK_CROSSOVER_PORTALS_KEY]: {
            a: {
              xM: 40,
              yM: 20,
              attachedTrackId: 'u34',
              waypointCode: 'xo_1_a',
              alias: 'A',
            },
            b: {
              xM: 40,
              yM: 40,
              attachedTrackId: 'd34',
              waypointCode: 'xo_1_b',
              alias: 'B',
            },
          },
        },
      }),
    ],
  }
}

describe('resolveExplicitCrossoverPortalLegPathPx', () => {
  it('returns path only when consecutive stops are same crossover A/B', () => {
    const areas = [makeCrossoverArea()]
    const ab = resolveExplicitCrossoverPortalLegPathPx(areas, 'xo_1_a', 'xo_1_b')
    assert.ok(ab && ab.length >= 2)
    const ba = resolveExplicitCrossoverPortalLegPathPx(areas, 'xo_1_b', 'xo_1_a')
    assert.ok(ba && ba.length >= 2)
    // 方向依站序：A→B 與 B→A 起點不同
    assert.notDeepEqual(ab![0], ba![0])
    assert.deepEqual(ab![0], ba![ba!.length - 1])
  })

  it('returns null when route does not name both portals', () => {
    const areas = [makeCrossoverArea()]
    assert.equal(
      resolveExplicitCrossoverPortalLegPathPx(areas, 'xo_1_a', 'some-station'),
      null,
    )
    assert.equal(
      resolveExplicitCrossoverPortalLegPathPx(
        areas,
        crossoverPortalTopologyNodeId('xo1', 'a'),
        'D34',
      ),
      null,
    )
  })

  it('returns null for same portal', () => {
    const areas = [makeCrossoverArea()]
    assert.equal(
      resolveExplicitCrossoverPortalLegPathPx(areas, 'xo_1_a', 'xo_1_a'),
      null,
    )
  })
})

describe('resolveCrossoverPortalRouteStopMapPx', () => {
  it('maps A/B portals to distinct screen points without refField bounds', () => {
    const areas = [makeCrossoverArea()]
    const a = resolveCrossoverPortalRouteStopMapPx(areas, 'xo_1_a')
    const b = resolveCrossoverPortalRouteStopMapPx(areas, 'xo_1_b')
    assert.ok(a)
    assert.ok(b)
    assert.equal(a!.stationName, 'A')
    assert.equal(b!.stationName, 'B')
    assert.equal(a!.xM, 40)
    assert.equal(a!.yM, 20)
    assert.equal(b!.xM, 40)
    assert.equal(b!.yM, 40)
    // 不同端點不得落到同一畫面座標
    assert.notEqual(a!.x === b!.x && a!.y === b!.y, true)
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

  it('follows tracks from docking to distant crossover portal on same corridor', () => {
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
              refFieldYMinM: 100,
              refFieldYMaxM: 200,
            },
          }),
          facility({
            id: 'd19',
            type: 'Track',
            customName: 'D19',
            parameters: {
              refFieldXMinM: 100,
              refFieldXMaxM: 103.5,
              refFieldYMinM: 200,
              refFieldYMaxM: 300,
            },
          }),
          facility({
            id: 's1',
            type: 'DockingPoint',
            customName: 'T3下行',
            parameters: {
              stationId: 'station_3',
              refFieldXM: 101.75,
              refFieldYM: 120,
            },
          }),
          facility({
            id: '3',
            type: 'TrackCrossover',
            parameters: {
              [TRACK_CROSSOVER_PORTALS_KEY]: {
                a: {
                  xM: 105,
                  yM: 280,
                  attachedTrackId: 'u19',
                  waypointCode: 'xo_3_a',
                  alias: '終點',
                },
                b: {
                  xM: 101.75,
                  yM: 280,
                  attachedTrackId: 'd19',
                  waypointCode: 'xo_3_b',
                  alias: '起點',
                },
              },
            },
          }),
          facility({
            id: 'u19',
            type: 'Track',
            customName: 'U19',
            parameters: {
              refFieldXMinM: 103.5,
              refFieldXMaxM: 107,
              refFieldYMinM: 200,
              refFieldYMaxM: 300,
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_3', 'xo_3_b'])
    assert.equal(geo.brokenLegs.length, 0, geo.warnings.map((w) => w.message).join('; '))
    assert.equal(geo.followsTracks, true)
    assert.ok(geo.pathLegs.length >= 1)
  })

  it('crossing via attached crossover does not jump to far track end then fold back', () => {
    const areas: MapAreaObject[] = [
      {
        id: '1',
        customName: 'A',
        layout: { xPx: 0, yPx: 0, wPx: 4000, hPx: 2000, borderPx: 1 },
        domain: { xMinM: 0, xMaxM: 200, yMinM: 0, yMaxM: 100 },
        view: { panXM: 0, panYM: 0, zoom: 1 },
        facilities: [
          facility({
            id: 'u05',
            type: 'Track',
            customName: 'U05',
            parameters: {
              refFieldXMinM: 10,
              refFieldXMaxM: 60,
              refFieldYMinM: 40,
              refFieldYMaxM: 44,
            },
          }),
          facility({
            id: 'u04',
            type: 'Track',
            customName: 'U04',
            parameters: {
              refFieldXMinM: 60,
              refFieldXMaxM: 110,
              refFieldYMinM: 40,
              refFieldYMaxM: 44,
            },
          }),
          facility({
            id: 'd05',
            type: 'Track',
            customName: 'D05',
            parameters: {
              refFieldXMinM: 10,
              refFieldXMaxM: 60,
              refFieldYMinM: 20,
              refFieldYMaxM: 24,
            },
          }),
          facility({
            id: 's-u',
            type: 'DockingPoint',
            customName: 'U站',
            parameters: {
              stationId: 'station_u',
              refFieldXM: 90,
              refFieldYM: 42,
            },
          }),
          facility({
            id: 's-d',
            type: 'DockingPoint',
            customName: 'D站',
            parameters: {
              stationId: 'station_d',
              refFieldXM: 20,
              refFieldYM: 22,
            },
          }),
          facility({
            id: 'xo',
            type: 'TrackCrossover',
            parameters: {
              [TRACK_CROSSOVER_PORTALS_KEY]: {
                a: {
                  xM: 30,
                  yM: 42,
                  attachedTrackId: 'u05',
                  waypointCode: 'xo_ab_a',
                },
                b: {
                  xM: 30,
                  yM: 22,
                  attachedTrackId: 'd05',
                  waypointCode: 'xo_ab_b',
                },
              },
            },
          }),
        ],
      },
    ]

    const geo = resolveRoutePreviewGeometry(areas, ['station_u', 'station_d'])
    assert.equal(geo.brokenLegs.length, 0, geo.warnings.map((w) => w.message).join('; '))
    assert.equal(geo.followsTracks, true)
    assert.ok(geo.pathLegs[0] && geo.pathLegs[0].length >= 2)

    // 不應出現遠大於走廊間距的「跳到軌道端再折回」長斜線
    const leg = geo.pathLegs[0]!
    let maxStep = 0
    for (let i = 0; i < leg.length - 1; i++) {
      maxStep = Math.max(
        maxStep,
        Math.hypot(leg[i + 1]!.x - leg[i]!.x, leg[i + 1]!.y - leg[i]!.y),
      )
    }
    assert.ok(
      maxStep < 400,
      `unexpected long jump in path (${maxStep.toFixed(1)} px)`,
    )
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
})
