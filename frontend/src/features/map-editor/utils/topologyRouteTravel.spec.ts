import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { emptyPointTopology } from '../types/pointTopology'
import {
  buildTopologyRouteTravelBreakdown,
  findDirectedTopologyPath,
} from './topologyRouteTravel'

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

describe('topologyRouteTravel', () => {
  it('finds directed path via waypoint', () => {
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
    const path = findDirectedTopologyPath(topology, 'f1', 'f3')
    assert.ok(path)
    assert.deepEqual(path!.nodeIds, ['f1', 'f2', 'f3'])
    const breakdown = buildTopologyRouteTravelBreakdown(topology, areas, ['S1', 'S2'])
    assert.equal(breakdown.timesComplete, true)
    assert.equal(breakdown.totalMinTravelTimeSeconds, 30)
    assert.equal(breakdown.totalAvgTravelTimeSeconds, 37)
    assert.equal(breakdown.totalDistanceMeters, 130)
  })

  it('warns when directed path is missing', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'f1', kind: 'docking' as const, label: '站一', stationId: 'S1', x: 0, y: 0, color: '#111111' },
        { id: 'f3', kind: 'docking' as const, label: '站二', stationId: 'S2', x: 20, y: 0, color: '#333333' },
      ],
      edges: [],
    }
    const breakdown = buildTopologyRouteTravelBreakdown(topology, areas, ['S1', 'S2'])
    assert.equal(breakdown.pathsComplete, false)
    assert.equal(breakdown.timesComplete, false)
    assert.ok(breakdown.warnings.length > 0)
  })

  it('treats opposite-only edge as missing forward path', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'f1', kind: 'docking' as const, label: '站一', stationId: 'S1', x: 0, y: 0, color: '#111111' },
        { id: 'f3', kind: 'docking' as const, label: '站二', stationId: 'S2', x: 20, y: 0, color: '#333333' },
      ],
      edges: [
        {
          id: 'e:f3->f1',
          fromNodeId: 'f3',
          toNodeId: 'f1',
          minTravelTimeSeconds: 10,
          avgTravelTimeSeconds: 12,
          distanceMeters: 40,
        },
      ],
    }
    const forward = buildTopologyRouteTravelBreakdown(topology, areas, ['S1', 'S2'])
    assert.equal(forward.pathsComplete, false)
    const reverse = buildTopologyRouteTravelBreakdown(topology, areas, ['S2', 'S1'])
    assert.equal(reverse.timesComplete, true)
    assert.equal(reverse.totalAvgTravelTimeSeconds, 12)
  })

  it('marks path found but times incomplete when edge metrics missing', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'f1', kind: 'docking' as const, label: '站一', stationId: 'S1', x: 0, y: 0, color: '#111111' },
        { id: 'f3', kind: 'docking' as const, label: '站二', stationId: 'S2', x: 20, y: 0, color: '#333333' },
      ],
      edges: [
        {
          id: 'e:f1->f3',
          fromNodeId: 'f1',
          toNodeId: 'f3',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: 40,
          distanceMeters: 100,
        },
      ],
    }
    const breakdown = buildTopologyRouteTravelBreakdown(topology, areas, ['S1', 'S2'])
    assert.equal(breakdown.pathsComplete, true)
    assert.equal(breakdown.timesComplete, false)
    assert.equal(breakdown.totalAvgTravelTimeSeconds, 40)
    assert.equal(breakdown.totalMinTravelTimeSeconds, null)
  })
})
