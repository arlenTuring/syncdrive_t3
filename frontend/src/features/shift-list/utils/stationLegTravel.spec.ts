import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../../map-editor/types/area'
import type { FacilityObject } from '../../map-editor/types/facility'
import { emptyPointTopology } from '../../map-editor/types/pointTopology'
import {
  areStationLegTravelsComplete,
  buildStationLegTravelsFromTopology,
  describeStationLegTravelIssue,
  resolveEffectiveRouteTravelSeconds,
  resolveLegTravelSecondsForBudget,
} from './stationLegTravel'

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

const areas: MapAreaObject[] = [
  {
    id: '1',
    customName: 'A',
    layout: { xPx: 0, yPx: 0, wPx: 800, hPx: 600, borderPx: 1 },
    domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
    view: { panXM: 0, panYM: 0, zoom: 1 },
    facilities: [
      facility({
        id: 'f1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站一' },
      }),
      facility({
        id: 'f2',
        type: 'Waypoint',
        parameters: { waypointCode: 'WP' },
      }),
      facility({
        id: 'f3',
        type: 'DockingPoint',
        parameters: { stationId: 'S2', stationName: '站二' },
      }),
    ],
  },
]

describe('stationLegTravel', () => {
  it('builds legs from topology and prefers them for occupancy travel', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'f1', kind: 'docking' as const, label: '站一', stationId: 'S1', x: 0, y: 0, color: '#111111' },
        { id: 'f2', kind: 'waypoint' as const, label: 'WP', x: 10, y: 0, color: '#222222' },
        { id: 'f3', kind: 'docking' as const, label: '站二', stationId: 'S2', x: 20, y: 0, color: '#333333' },
      ],
      edges: [
        {
          id: 'e:f1->f2',
          fromNodeId: 'f1',
          toNodeId: 'f2',
          minTravelTimeSeconds: 10,
          avgTravelTimeSeconds: 12,
          distanceMeters: 50,
        },
        {
          id: 'e:f2->f3',
          fromNodeId: 'f2',
          toNodeId: 'f3',
          minTravelTimeSeconds: 20,
          avgTravelTimeSeconds: 25,
          distanceMeters: 80,
        },
      ],
    }
    const built = buildStationLegTravelsFromTopology(topology, areas, ['S1', 'S2'])
    assert.equal(built.timesComplete, true)
    assert.equal(built.legs.length, 1)
    assert.equal(built.avgTravelTimeSeconds, 37)
    assert.equal(built.minTravelTimeSeconds, 30)
    assert.ok(areStationLegTravelsComplete(['S1', 'S2'], built.legs))

    const effective = resolveEffectiveRouteTravelSeconds({
      stationIds: ['S1', 'S2'],
      stationLegTravels: built.legs,
      avgTravelTimeSeconds: 999,
      minTravelTimeSeconds: 888,
    })
    assert.deepEqual(effective, {
      avgTravelTimeSeconds: 37,
      minTravelTimeSeconds: 30,
    })
  })

  it('scales leg budget by weights and falls back to equal split', () => {
    const legs = [
      {
        fromStationId: 'a',
        toStationId: 'b',
        avgTravelTimeSeconds: 100,
        minTravelTimeSeconds: 80,
      },
      {
        fromStationId: 'b',
        toStationId: 'c',
        avgTravelTimeSeconds: 300,
        minTravelTimeSeconds: 240,
      },
    ]
    const weighted = resolveLegTravelSecondsForBudget({
      stationIds: ['a', 'b', 'c'],
      legs,
      travelBudgetSeconds: 400,
    })
    assert.deepEqual(weighted, [100, 300])

    const equal = resolveLegTravelSecondsForBudget({
      stationIds: ['a', 'b', 'c'],
      legs: [],
      travelBudgetSeconds: 400,
    })
    assert.deepEqual(equal, [200, 200])
  })

  it('flags invalid min > avg on a leg', () => {
    const issue = describeStationLegTravelIssue(
      ['a', 'b'],
      [
        {
          fromStationId: 'a',
          toStationId: 'b',
          avgTravelTimeSeconds: 10,
          minTravelTimeSeconds: 20,
        },
      ],
    )
    assert.equal(issue?.code, 'invalid')
  })
})
