import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapPlannedRoute } from '../types/mapFile'
import type { PointTopologyNode } from '../types/pointTopology'
import {
  estimateTopologyEdgeDistanceFromSimRoutes,
  extractDirectSimPathSpan,
  topologyNodeRouteCodes,
} from './topologySimRouteDistance'

function node(
  partial: Partial<PointTopologyNode> & Pick<PointTopologyNode, 'id' | 'kind'>,
): PointTopologyNode {
  return {
    label: partial.label ?? partial.id,
    x: 0,
    y: 0,
    color: '#000',
    ...partial,
  }
}

describe('topologySimRouteDistance', () => {
  it('extracts direct span without intermediate stations', () => {
    const from = new Set(['A'])
    const to = new Set(['B'])
    const span = extractDirectSimPathSpan(
      [
        { px: 0, py: 0, x: 0, y: 0, stationId: 'A' },
        { px: 10, py: 0, x: 50, y: 0 },
        { px: 20, py: 0, x: 100, y: 0, stationId: 'B' },
      ],
      from,
      to,
    )
    assert.equal(span?.length, 3)
    assert.equal(
      extractDirectSimPathSpan(
        [
          { px: 0, py: 0, x: 0, y: 0, stationId: 'A' },
          { px: 10, py: 0, x: 50, y: 0, stationId: 'X' },
          { px: 20, py: 0, x: 100, y: 0, stationId: 'B' },
        ],
        from,
        to,
      ),
      null,
    )
  })

  it('estimates distance from pathWaypoints field meters', () => {
    const from = node({ id: 'n1', kind: 'docking', stationId: 'A' })
    const to = node({ id: 'n2', kind: 'docking', stationId: 'B' })
    const routes: MapPlannedRoute[] = [
      {
        routeId: 'r1',
        displayName: '主線',
        stationIds: ['A', 'B'],
        pathWaypoints: [
          { px: 0, py: 0, x: 0, y: 0, stationId: 'A' },
          { px: 10, py: 0, x: 30, y: 40 },
          { px: 20, py: 0, x: 60, y: 40, stationId: 'B' },
        ],
      },
    ]
    const est = estimateTopologyEdgeDistanceFromSimRoutes(
      from,
      to,
      routes,
      [],
      null,
    )
    assert.ok(est)
    assert.equal(est!.source, 'pathWaypoints')
    assert.equal(est!.distanceMeters, 80)
    assert.equal(est!.routeDisplayName, '主線')
  })

  it('matches node id as route code', () => {
    const codes = topologyNodeRouteCodes(
      node({ id: 'xcwp:f:lt', kind: 'cross-waypoint', stationId: 'XP1' }),
    )
    assert.ok(codes.has('XP1'))
    assert.ok(codes.has('xcwp:f:lt'))
  })
})
