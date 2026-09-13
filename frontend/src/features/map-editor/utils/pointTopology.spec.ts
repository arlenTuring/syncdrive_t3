import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { emptyPointTopology } from '../types/pointTopology'
import {
  addDirectedEdge,
  addFacilitiesToPointTopology,
  buildTopologyFacilityFingerprint,
  canAddDirectedEdge,
  canReconnectDirectedEdge,
  canReversePointTopologyEdge,
  collectSubtreeNodeIds,
  findOppositePointTopologyEdgeId,
  isPointTopologyEdgeBidirectional,
  makePointTopologyEdgeBidirectional,
  colorForTopologyNodeKind,
  curveOffsetFromDesiredMidpoint,
  facilityDockingTopologyNodeId,
  findFacilityDispatchDockingId,
  hasCustomEdgeBend,
  isDispatchAfterServiceEdge,
  isPointTopologyEdgeTravelInvalid,
  isServiceFacilityLinkEdge,
  labelForTopologyFacility,
  listInvalidTravelEdges,
  listTopologyLoadCandidates,
  movePointTopologyNodesByDelta,
  resolveTopologyNodeLabelFromAreas,
  parsePointTopology,
  reconnectPointTopologyEdge,
  removePointTopologyEdge,
  resolvePointTopologyEdgePath,
  reversePointTopologyEdge,
  setFacilityDispatchDocking,
  syncPointTopologyWithAreas,
  TOPOLOGY_KIND_COLORS,
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

  it('colors nodes by facility kind (docking / waypoint / facility)', () => {
    assert.equal(colorForTopologyNodeKind('docking'), TOPOLOGY_KIND_COLORS.docking)
    assert.equal(colorForTopologyNodeKind('waypoint'), TOPOLOGY_KIND_COLORS.waypoint)
    assert.equal(colorForTopologyNodeKind('facility'), TOPOLOGY_KIND_COLORS.facility)
    assert.notEqual(TOPOLOGY_KIND_COLORS.docking, TOPOLOGY_KIND_COLORS.waypoint)
    assert.notEqual(TOPOLOGY_KIND_COLORS.docking, TOPOLOGY_KIND_COLORS.facility)
    assert.notEqual(TOPOLOGY_KIND_COLORS.waypoint, TOPOLOGY_KIND_COLORS.facility)

    const areas = areaWith(
      facility({
        id: 'd1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站一' },
      }),
      facility({
        id: 'd2',
        type: 'DockingPoint',
        parameters: { stationId: 'S2', stationName: '站二' },
      }),
      facility({ id: 'f1', type: 'Facility', customName: 'E1' }),
      facility({ id: 'f2', type: 'Facility', customName: 'H1' }),
    )
    const loaded = addFacilitiesToPointTopology(emptyPointTopology(), areas, [
      'd1',
      'd2',
      'f1',
      'f2',
    ])
    assert.equal(loaded.nodes.find((n) => n.id === 'd1')?.color, TOPOLOGY_KIND_COLORS.docking)
    assert.equal(loaded.nodes.find((n) => n.id === 'd2')?.color, TOPOLOGY_KIND_COLORS.docking)
    assert.equal(loaded.nodes.find((n) => n.id === 'f1')?.color, TOPOLOGY_KIND_COLORS.facility)
    assert.equal(loaded.nodes.find((n) => n.id === 'f2')?.color, TOPOLOGY_KIND_COLORS.facility)

    const mismatched = {
      ...loaded,
      nodes: loaded.nodes.map((node) => ({ ...node, color: '#111111' })),
    }
    const reconciled = syncPointTopologyWithAreas(mismatched, areas)
    assert.equal(reconciled.nodes.find((n) => n.id === 'd1')?.color, TOPOLOGY_KIND_COLORS.docking)
    assert.equal(reconciled.nodes.find((n) => n.id === 'f1')?.color, TOPOLOGY_KIND_COLORS.facility)
  })

  it('does not auto-add map facilities; addFacilitiesToPointTopology loads them', () => {
    const areas = areaWith(
      facility({
        id: 'd1',
        type: 'DockingPoint',
        customName: '',
        parameters: { stationId: 'S1', stationName: '站一' },
      }),
      facility({
        id: 'w1',
        type: 'Waypoint',
        parameters: { waypointCode: 'WP1' },
      }),
      facility({
        id: 'f1',
        type: 'Facility',
        customName: '充電格 A',
      }),
    )
    const empty = syncPointTopologyWithAreas(null, areas)
    assert.equal(empty.nodes.length, 0)

    const loaded = addFacilitiesToPointTopology(empty, areas, ['d1', 'w1', 'f1'])
    assert.equal(loaded.nodes.length, 3)
    assert.equal(loaded.nodes.find((n) => n.id === 'd1')?.label, '站一')
    assert.equal(loaded.nodes.find((n) => n.id === 'w1')?.label, 'WP1')
    assert.equal(loaded.nodes.find((n) => n.id === 'f1')?.kind, 'facility')
    assert.equal(loaded.nodes.find((n) => n.id === 'f1')?.label, '充電格 A')
    assert.notEqual(
      loaded.nodes[0]!.color.toLowerCase(),
      loaded.nodes[1]!.color.toLowerCase(),
    )

    const reconciled = syncPointTopologyWithAreas(loaded, areas)
    assert.equal(reconciled.nodes.length, 3)
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

  it('設為雙向：自動補一條反向邊，時間與距離沿用原邊', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'a', kind: 'facility' as const, label: 'E4', x: 0, y: 0, color: '#111111' },
        { id: 'b', kind: 'docking' as const, label: 'N2W', x: 10, y: 10, color: '#222222' },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: 30,
          avgTravelTimeSeconds: 30,
          distanceMeters: 100,
          curveOffsetX: 12,
          curveOffsetY: 8,
        },
      ],
    }

    assert.equal(isPointTopologyEdgeBidirectional(topology, 'e:a->b'), false)
    assert.equal(findOppositePointTopologyEdgeId(topology, 'e:a->b'), null)

    const { topology: both, newEdgeId } = makePointTopologyEdgeBidirectional(
      topology,
      'e:a->b',
    )
    assert.equal(newEdgeId, 'e:b->a')
    assert.equal(both.edges.length, 2)
    const reverse = both.edges.find((edge) => edge.id === 'e:b->a')!
    assert.equal(reverse.fromNodeId, 'b')
    assert.equal(reverse.toNodeId, 'a')
    assert.equal(reverse.minTravelTimeSeconds, 30)
    assert.equal(reverse.avgTravelTimeSeconds, 30)
    assert.equal(reverse.distanceMeters, 100)
    // 彎折不沿用，否則兩條線會疊在一起
    assert.equal(reverse.curveOffsetX, null)
    assert.equal(reverse.curveOffsetY, null)
    // 原邊不動
    assert.equal(both.edges.find((edge) => edge.id === 'e:a->b')!.curveOffsetX, 12)

    assert.equal(isPointTopologyEdgeBidirectional(both, 'e:a->b'), true)
    assert.equal(findOppositePointTopologyEdgeId(both, 'e:a->b'), 'e:b->a')
  })

  it('已經雙向時再設一次不會重複建邊', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'a', kind: 'facility' as const, label: 'E4', x: 0, y: 0, color: '#111111' },
        { id: 'b', kind: 'docking' as const, label: 'N2W', x: 10, y: 10, color: '#222222' },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: 30,
          avgTravelTimeSeconds: 30,
          distanceMeters: 100,
        },
      ],
    }
    const { topology: both } = makePointTopologyEdgeBidirectional(topology, 'e:a->b')
    const again = makePointTopologyEdgeBidirectional(both, 'e:a->b')
    assert.equal(again.newEdgeId, null)
    assert.equal(again.topology.edges.length, 2)
  })

  it('preserves layout when re-syncing existing nodes', () => {
    const areas = areaWith(
      facility({
        id: 'd1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站一' },
      }),
    )
    const first = addFacilitiesToPointTopology(emptyPointTopology(), areas, ['d1'])
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

  it('moves subtree as a rigid group past the world origin', () => {
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
    const moved = movePointTopologyNodesByDelta(topology, ['a', 'b'], -100, -80)
    assert.equal(moved.nodes.find((n) => n.id === 'a')!.x, -60)
    assert.equal(moved.nodes.find((n) => n.id === 'a')!.y, 20)
    assert.equal(moved.nodes.find((n) => n.id === 'b')!.x, 40)
    assert.equal(moved.nodes.find((n) => n.id === 'b')!.y, 20)
  })

  it('sets facility dispatch docking as a single outbound edge', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        {
          id: 'f1',
          kind: 'facility' as const,
          label: 'E1',
          x: 0,
          y: 0,
          color: TOPOLOGY_KIND_COLORS.facility,
        },
        {
          id: 'd1',
          kind: 'docking' as const,
          label: 'N2W下行',
          x: 100,
          y: 0,
          color: TOPOLOGY_KIND_COLORS.docking,
        },
        {
          id: 'd2',
          kind: 'docking' as const,
          label: 'T3下行',
          x: 200,
          y: 0,
          color: TOPOLOGY_KIND_COLORS.docking,
        },
      ],
    }
    const toD1 = setFacilityDispatchDocking(topology, 'f1', 'd1')
    assert.equal(findFacilityDispatchDockingId(toD1, 'f1'), 'd1')
    assert.equal(toD1.edges.length, 1)
    assert.equal(
      isDispatchAfterServiceEdge(
        toD1.nodes.find((n) => n.id === 'f1'),
        toD1.nodes.find((n) => n.id === 'd1'),
      ),
      true,
    )
    const toD2 = setFacilityDispatchDocking(toD1, 'f1', 'd2')
    assert.equal(findFacilityDispatchDockingId(toD2, 'f1'), 'd2')
    assert.equal(toD2.edges.length, 1)
    const cleared = setFacilityDispatchDocking(toD2, 'f1', null)
    assert.equal(findFacilityDispatchDockingId(cleared, 'f1'), null)
    assert.equal(cleared.edges.length, 0)
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

  it('topology labels prefer alias over stationId for docking points', () => {
    const docking = facility({
      id: '090',
      type: 'DockingPoint',
      customName: 'N2W上行停靠',
      parameters: { stationId: 'n2w_d_end' },
    })
    assert.equal(labelForTopologyFacility(docking), 'N2W上行停靠')
    const areas = areaWith(docking)
    const candidates = listTopologyLoadCandidates(areas, emptyPointTopology())
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0]!.label, 'N2W上行停靠')
    assert.equal(
      resolveTopologyNodeLabelFromAreas('090', areas),
      'N2W上行停靠',
    )
    const noAlias = facility({
      id: '091',
      type: 'DockingPoint',
      customName: '',
      parameters: { stationId: 'n2w_d_start' },
    })
    assert.equal(labelForTopologyFacility(noAlias), 'n2w_d_start')
  })

  it('excludes zone partitions and entrances from topology load candidates', () => {
    const areas = areaWith(
      facility({
        id: 'zone-1',
        type: 'Facility',
        name: 'ZonePartition',
        customName: '調度區',
      }),
      facility({
        id: 'ent-1',
        type: 'Facility',
        name: 'ZoneEntrance',
        customName: '入口',
      }),
      facility({
        id: 'f1',
        type: 'Facility',
        customName: '充電格 A',
      }),
      facility({
        id: 'd1',
        type: 'DockingPoint',
        customName: 'T3上行',
        parameters: { stationId: 't3_u' },
      }),
    )
    const candidates = listTopologyLoadCandidates(areas, emptyPointTopology())
    assert.deepEqual(
      candidates.map((c) => c.nodeId).sort(),
      ['d1', 'f1'],
    )
    assert.ok(!candidates.some((c) => c.nodeId === 'zone-1'))
    assert.ok(!candidates.some((c) => c.nodeId === 'ent-1'))
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
    const synced = addFacilitiesToPointTopology(emptyPointTopology(), b, ['d1', 'w1'])
    assert.equal(synced.nodes.length, 2)
    const afterRemove = syncPointTopologyWithAreas(synced, a)
    assert.equal(afterRemove.nodes.length, 1)
    assert.equal(afterRemove.nodes[0]!.id, 'd1')
  })

  it('lists and loads facility docking points as facility-docking nodes', () => {
    const areas = areaWith(
      facility({
        id: 'f1',
        type: 'Facility',
        customName: '車場 A',
        parameters: {
          refFieldXMinM: 0,
          refFieldXMaxM: 90,
          refFieldYMinM: 0,
          refFieldYMaxM: 60,
          facilityDockingPoint: { xM: 30, yM: 30 },
        },
      }),
    )
    const candidates = listTopologyLoadCandidates(areas, emptyPointTopology())
    assert.equal(candidates.length, 2)
    assert.equal(candidates[0]!.kind, 'facility-docking')
    assert.equal(candidates[0]!.nodeId, facilityDockingTopologyNodeId('f1'))
    assert.equal(candidates[1]!.kind, 'facility')
    assert.equal(candidates[1]!.nodeId, 'f1')

    const loaded = addFacilitiesToPointTopology(emptyPointTopology(), areas, [
      facilityDockingTopologyNodeId('f1'),
      'f1',
    ])
    assert.equal(loaded.nodes.length, 2)
    const dockNode = loaded.nodes.find((n) => n.kind === 'facility-docking')
    assert.ok(dockNode)
    assert.equal(dockNode!.id, 'fdock:f1')
    assert.equal(dockNode!.color, TOPOLOGY_KIND_COLORS['facility-docking'])
    assert.equal(dockNode!.label, '車場 A停靠點')

    const withoutDock = areaWith(
      facility({
        id: 'f1',
        type: 'Facility',
        customName: '車場 A',
        parameters: {
          refFieldXMinM: 0,
          refFieldXMaxM: 90,
          refFieldYMinM: 0,
          refFieldYMaxM: 60,
        },
      }),
    )
    const pruned = syncPointTopologyWithAreas(loaded, withoutDock)
    assert.equal(pruned.nodes.length, 1)
    assert.equal(pruned.nodes[0]!.id, 'f1')
    assert.equal(pruned.nodes[0]!.kind, 'facility')
  })

  it('parses facility-docking kind from map file', () => {
    const parsed = parsePointTopology({
      version: 1,
      nodes: [
        {
          id: 'fdock:f1',
          kind: 'facility-docking',
          label: '車場 · 設施停靠點',
          x: 10,
          y: 20,
          color: '#000000',
        },
      ],
      edges: [],
    })
    assert.equal(parsed.nodes[0]!.kind, 'facility-docking')
    assert.equal(parsed.nodes[0]!.color, TOPOLOGY_KIND_COLORS['facility-docking'])
  })

  it('stores and resolves custom edge bend offsets', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 200, y: 0 }
    const straight = resolvePointTopologyEdgePath(from, to, {})
    assert.equal(straight.cy, straight.midY)
    const bent = resolvePointTopologyEdgePath(from, to, {
      curveOffsetX: 0,
      curveOffsetY: 40,
    })
    assert.ok(bent.hasCustomBend)
    assert.equal(bent.cy, (straight.y1 + straight.y2) / 2 + 40)
    const offset = curveOffsetFromDesiredMidpoint(
      bent.x1,
      bent.y1,
      bent.x2,
      bent.y2,
      bent.midX,
      bent.midY,
    )
    assert.ok(Math.abs(offset.curveOffsetY - 40) < 1e-6)

    const parsed = parsePointTopology({
      version: 1,
      nodes: [
        { id: 'a', kind: 'docking', label: 'A', x: 0, y: 0, color: '#111' },
        { id: 'b', kind: 'docking', label: 'B', x: 100, y: 0, color: '#222' },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: null,
          avgTravelTimeSeconds: null,
          distanceMeters: null,
          curveOffsetX: 12,
          curveOffsetY: -8,
        },
      ],
    })
    assert.equal(parsed.edges[0]!.curveOffsetX, 12)
    assert.equal(parsed.edges[0]!.curveOffsetY, -8)
    assert.equal(hasCustomEdgeBend(parsed.edges[0]!), true)
  })

  it('reconnects an edge endpoint and preserves travel metrics', () => {
    const topology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'a', kind: 'docking' as const, label: 'A', x: 0, y: 0, color: '#111' },
        { id: 'b', kind: 'docking' as const, label: 'B', x: 100, y: 0, color: '#222' },
        { id: 'c', kind: 'docking' as const, label: 'C', x: 200, y: 0, color: '#333' },
      ],
      edges: [
        {
          id: 'e:a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          minTravelTimeSeconds: 10,
          avgTravelTimeSeconds: 12,
          distanceMeters: 80,
          curveOffsetX: 5,
          curveOffsetY: 9,
        },
      ],
    }
    assert.equal(canReconnectDirectedEdge(topology, 'e:a->b', 'to', 'c'), true)
    assert.equal(canReconnectDirectedEdge(topology, 'e:a->b', 'to', 'a'), false)
    const { topology: next, newEdgeId } = reconnectPointTopologyEdge(
      topology,
      'e:a->b',
      'to',
      'c',
    )
    assert.equal(newEdgeId, 'e:a->c')
    assert.equal(next.edges.length, 1)
    assert.equal(next.edges[0]!.fromNodeId, 'a')
    assert.equal(next.edges[0]!.toNodeId, 'c')
    assert.equal(next.edges[0]!.avgTravelTimeSeconds, 12)
    assert.equal(next.edges[0]!.curveOffsetY, 9)
  })

  it('dashes facility↔facility-docking; solid docking↔facility-docking', () => {
    const facility = {
      id: 'f',
      kind: 'facility' as const,
      label: 'F',
      x: 0,
      y: 0,
      color: '#111',
    }
    const fdock = {
      id: 'fdock:f',
      kind: 'facility-docking' as const,
      label: 'F停',
      x: 40,
      y: 0,
      color: '#222',
    }
    const dock = {
      id: 'd',
      kind: 'docking' as const,
      label: 'D',
      x: 80,
      y: 0,
      color: '#333',
    }
    assert.equal(isServiceFacilityLinkEdge(facility, fdock), true)
    assert.equal(isServiceFacilityLinkEdge(fdock, facility), true)
    assert.equal(isServiceFacilityLinkEdge(facility, dock), true)
    assert.equal(isServiceFacilityLinkEdge(dock, fdock), false)
    assert.equal(isDispatchAfterServiceEdge(facility, dock), true)
    assert.equal(isDispatchAfterServiceEdge(facility, fdock), false)
  })

  it('keeps TrackCrossover portal waypoints when syncing topology with areas', () => {
    const areas = areaWith(
      facility({
        id: 'dock-1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站1' },
      }),
      facility({
        id: 'xo1',
        type: 'TrackCrossover',
        parameters: {
          trackCrossoverPortals: {
            a: {
              xM: 10,
              yM: 20,
              attachedTrackId: 't1',
              waypointCode: 'xo_1_a',
              alias: '上行轉N2W正線終點',
            },
            b: {
              xM: 30,
              yM: 40,
              attachedTrackId: 't2',
              waypointCode: 'xo_1_b',
              alias: '上行轉N2W正線起點',
            },
          },
        },
      }),
    )

    const loaded = addFacilitiesToPointTopology(emptyPointTopology(), areas, [
      'dock-1',
      'xowp:xo1:a',
      'xowp:xo1:b',
    ])
    assert.equal(loaded.nodes.length, 3)
    assert.ok(loaded.nodes.some((n) => n.id === 'xowp:xo1:a' && n.kind === 'crossover-waypoint'))
    assert.ok(loaded.nodes.some((n) => n.id === 'xowp:xo1:b' && n.kind === 'crossover-waypoint'))

    const synced = syncPointTopologyWithAreas(loaded, areas)
    assert.equal(synced.nodes.length, 3)
    const portalA = synced.nodes.find((n) => n.id === 'xowp:xo1:a')
    assert.equal(portalA?.kind, 'crossover-waypoint')
    assert.equal(portalA?.stationId, 'xo_1_a')
    assert.equal(portalA?.label, '上行轉N2W正線終點')

    const candidates = listTopologyLoadCandidates(areas, synced)
    assert.ok(
      candidates.some(
        (c) => c.nodeId === 'xowp:xo1:a' && c.kind === 'crossover-waypoint' && c.alreadyInTopology,
      ),
    )
  })

  it('keeps RailCross portal waypoints when syncing topology with areas', () => {
    const areas = areaWith(
      facility({
        id: 'dock-1',
        type: 'DockingPoint',
        parameters: { stationId: 'S1', stationName: '站1' },
      }),
      facility({
        id: 'xc1',
        type: 'Track',
        name: 'RailCross',
        parameters: {
          crossTrackPortals: {
            lt: { waypointCode: 'xc_1_lt', alias: '左上口' },
            lb: { waypointCode: 'xc_1_lb', alias: '左下口' },
            rt: { waypointCode: 'xc_1_rt', alias: '右上口' },
            rb: { waypointCode: 'xc_1_rb', alias: '右下口' },
          },
        },
      }),
    )

    const loaded = addFacilitiesToPointTopology(emptyPointTopology(), areas, [
      'dock-1',
      'xcwp:xc1:lt',
      'xcwp:xc1:lb',
      'xcwp:xc1:rt',
      'xcwp:xc1:rb',
    ])
    assert.equal(loaded.nodes.length, 5)
    assert.ok(loaded.nodes.some((n) => n.id === 'xcwp:xc1:lt' && n.kind === 'cross-waypoint'))
    assert.ok(loaded.nodes.some((n) => n.id === 'xcwp:xc1:rb' && n.kind === 'cross-waypoint'))

    const synced = syncPointTopologyWithAreas(loaded, areas)
    assert.equal(synced.nodes.length, 5)
    const portalLt = synced.nodes.find((n) => n.id === 'xcwp:xc1:lt')
    assert.equal(portalLt?.kind, 'cross-waypoint')
    assert.equal(portalLt?.stationId, 'xc_1_lt')
    assert.equal(portalLt?.label, '左上口')

    const candidates = listTopologyLoadCandidates(areas, synced)
    assert.ok(
      candidates.some(
        (c) => c.nodeId === 'xcwp:xc1:lt' && c.kind === 'cross-waypoint' && c.alreadyInTopology,
      ),
    )
  })
})
