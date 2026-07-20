import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { emptyPointTopology } from '../types/pointTopology'
import {
  addDirectedEdge,
  buildTopologyFacilityFingerprint,
  canAddDirectedEdge,
  canReversePointTopologyEdge,
  collectSubtreeNodeIds,
  isPointTopologyEdgeTravelInvalid,
  listInvalidTravelEdges,
  movePointTopologyNodesByDelta,
  parsePointTopology,
  removePointTopologyEdge,
  reversePointTopologyEdge,
  syncPointTopologyWithAreas,
  updatePointTopologyEdge,
} from './pointTopology'

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

function areaWith(...facilities: FacilityObject[]): MapAreaObject[] {
  return [
    {
      id: '1',
      customName: 'A',
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 800,
        hPx: 600,
        borderPx: 1,
      },
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
      view: { panXM: 0, panYM: 0, zoom: 1 },
      facilities,
    },
  ]
}

describe('pointTopology', () => {
  it('parses empty / missing as empty topology', () => {
    assert.deepEqual(parsePointTopology(undefined), emptyPointTopology())
  })

  it('syncs docking and waypoint facilities into nodes with unique colors', () => {
    const areas = areaWith(
      facility({
        id: 'd1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站一' },
      }),
      facility({
        id: 'w1',
        type: 'Waypoint',
        parameters: { waypointCode: 'WP1' },
      }),
    )
    const synced = syncPointTopologyWithAreas(null, areas)
    assert.equal(synced.nodes.length, 2)
    assert.equal(synced.nodes[0]!.label, '站一')
    assert.equal(synced.nodes[1]!.label, 'WP1')
    assert.notEqual(
      synced.nodes[0]!.color.toLowerCase(),
      synced.nodes[1]!.color.toLowerCase(),
    )
  })

  it('allows opposite directed edges but not duplicate same direction', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        {
          id: 'a',
          kind: 'docking' as const,
          label: 'A',
          x: 0,
          y: 0,
          color: '#111111',
        },
        {
          id: 'b',
          kind: 'docking' as const,
          label: 'B',
          x: 10,
          y: 10,
          color: '#222222',
        },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: 10,
          avgTravelTimeSeconds: 12,
          distanceMeters: 100,
        },
      ],
    }
    assert.equal(canAddDirectedEdge(topology, 'a', 'b'), false)
    assert.equal(canAddDirectedEdge(topology, 'b', 'a'), true)
    assert.equal(canAddDirectedEdge(topology, 'a', 'a'), false)
  })

  it('reverses edge direction and keeps metrics', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        {
          id: 'a',
          kind: 'docking' as const,
          label: 'A',
          x: 0,
          y: 0,
          color: '#111111',
        },
        {
          id: 'b',
          kind: 'docking' as const,
          label: 'B',
          x: 10,
          y: 10,
          color: '#222222',
        },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: 10,
          avgTravelTimeSeconds: 12,
          distanceMeters: 100,
        },
      ],
    }
    assert.equal(canReversePointTopologyEdge(topology, 'e:a->b'), true)
    const { topology: flipped, newEdgeId } = reversePointTopologyEdge(topology, 'e:a->b')
    assert.equal(newEdgeId, 'e:b->a')
    assert.equal(flipped.edges.length, 1)
    assert.equal(flipped.edges[0]!.fromNodeId, 'b')
    assert.equal(flipped.edges[0]!.toNodeId, 'a')
    assert.equal(flipped.edges[0]!.minTravelTimeSeconds, 10)
    assert.equal(flipped.edges[0]!.distanceMeters, 100)

    const withBoth = addDirectedEdge(topology, 'b', 'a')
    assert.equal(canReversePointTopologyEdge(withBoth, 'e:a->b'), false)
    const blocked = reversePointTopologyEdge(withBoth, 'e:a->b')
    assert.equal(blocked.newEdgeId, null)
    assert.equal(blocked.topology.edges.length, 2)
  })

  it('preserves layout when re-syncing existing nodes', () => {
    const areas = areaWith(
      facility({
        id: 'd1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站一' },
      }),
    )
    const first = syncPointTopologyWithAreas(null, areas)
    const moved = {
      ...first,
      nodes: first.nodes.map((n) => ({ ...n, x: 240, y: 180 })),
    }
    const again = syncPointTopologyWithAreas(moved, areas)
    assert.equal(again.nodes[0]!.x, 240)
    assert.equal(again.nodes[0]!.y, 180)
  })

  it('adds / updates / removes directed edges', () => {
    let topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'a', kind: 'docking' as const, label: 'A', x: 0, y: 0, color: '#111111' },
        { id: 'b', kind: 'docking' as const, label: 'B', x: 10, y: 0, color: '#222222' },
      ],
    }
    topology = addDirectedEdge(topology, 'a', 'b')
    assert.equal(topology.edges.length, 1)
    topology = addDirectedEdge(topology, 'a', 'b')
    assert.equal(topology.edges.length, 1)
    topology = addDirectedEdge(topology, 'b', 'a')
    assert.equal(topology.edges.length, 2)
    const edgeId = topology.edges[0]!.id
    topology = updatePointTopologyEdge(topology, edgeId, {
      minTravelTimeSeconds: 20,
      avgTravelTimeSeconds: 25,
      distanceMeters: 120,
    })
    assert.equal(topology.edges[0]!.avgTravelTimeSeconds, 25)
    topology = removePointTopologyEdge(topology, edgeId)
    assert.equal(topology.edges.length, 1)
    assert.equal(topology.edges[0]!.fromNodeId, 'b')
  })

  it('collects outward subtree and moves those nodes together', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'a', kind: 'docking' as const, label: 'A', x: 100, y: 100, color: '#111111' },
        { id: 'b', kind: 'waypoint' as const, label: 'B', x: 200, y: 100, color: '#222222' },
        { id: 'c', kind: 'docking' as const, label: 'C', x: 300, y: 100, color: '#333333' },
        { id: 'd', kind: 'docking' as const, label: 'D', x: 50, y: 50, color: '#444444' },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: null,
          distanceMeters: null,
        },
        {
          id: 'e:b->c',
          fromNodeId: 'b',
          toNodeId: 'c',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: null,
          distanceMeters: null,
        },
        {
          id: 'e:d->a',
          fromNodeId: 'd',
          toNodeId: 'a',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: null,
          distanceMeters: null,
        },
      ],
    }
    assert.deepEqual(collectSubtreeNodeIds(topology, 'a').sort(), ['a', 'b', 'c'])
    const moved = movePointTopologyNodesByDelta(
      topology,
      collectSubtreeNodeIds(topology, 'a'),
      10,
      5,
    )
    assert.equal(moved.nodes.find((n) => n.id === 'a')!.x, 110)
    assert.equal(moved.nodes.find((n) => n.id === 'b')!.y, 105)
    assert.equal(moved.nodes.find((n) => n.id === 'c')!.x, 310)
    assert.equal(moved.nodes.find((n) => n.id === 'd')!.x, 50)
  })

  it('clamps subtree as a rigid group at the canvas edge', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'a', kind: 'docking' as const, label: 'A', x: 40, y: 100, color: '#111111' },
        { id: 'b', kind: 'docking' as const, label: 'B', x: 140, y: 100, color: '#222222' },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: null,
          distanceMeters: null,
        },
      ],
    }
    const moved = movePointTopologyNodesByDelta(topology, ['a', 'b'], -100, 0)
    // NODE_RADIUS_PX = 36；整組只能再往左 4px，相對距離維持 100
    assert.equal(moved.nodes.find((n) => n.id === 'a')!.x, 36)
    assert.equal(moved.nodes.find((n) => n.id === 'b')!.x, 136)
  })

  it('detects edges where min travel exceeds avg', () => {
    const ok = {
      id: 'e:a->b',
      fromNodeId: 'a',
      toNodeId: 'b',
      minTravelTimeSeconds: 10,
      avgTravelTimeSeconds: 20,
      distanceMeters: null,
    }
    const bad = {
      ...ok,
      id: 'e:b->a',
      fromNodeId: 'b',
      toNodeId: 'a',
      minTravelTimeSeconds: 30,
      avgTravelTimeSeconds: 20,
    }
    assert.equal(isPointTopologyEdgeTravelInvalid(ok), false)
    assert.equal(isPointTopologyEdgeTravelInvalid(bad), true)
    const listed = listInvalidTravelEdges({
      ...emptyPointTopology(),
      edges: [ok, bad],
    })
    assert.equal(listed.length, 1)
    assert.equal(listed[0]!.id, 'e:b->a')
  })

  it('facility fingerprint changes when docking is added or removed', () => {
    const a = areaWith(facility({ id: 'd1', type: 'DockingPoint', customName: 'D1' }))
    const b = areaWith(
      facility({ id: 'd1', type: 'DockingPoint', customName: 'D1' }),
      facility({ id: 'w1', type: 'Waypoint', customName: 'W1' }),
    )
    assert.notEqual(
      buildTopologyFacilityFingerprint(a),
      buildTopologyFacilityFingerprint(b),
    )
    const synced = syncPointTopologyWithAreas(emptyPointTopology(), b)
    assert.equal(synced.nodes.length, 2)
    const afterRemove = syncPointTopologyWithAreas(synced, a)
    assert.equal(afterRemove.nodes.length, 1)
    assert.equal(afterRemove.nodes[0]!.id, 'd1')
  })
})
