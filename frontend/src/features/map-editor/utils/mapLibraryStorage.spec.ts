import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyPointTopology } from '../types/pointTopology'
import { mergeBuiltinRefreshPreservingEditorData } from './mergeBuiltinRefFields'
import type { ParsedMapFile } from './mapFileJson'

function baseParsed(over: Partial<ParsedMapFile> = {}): ParsedMapFile {
  return {
    mapId: 't3-main-version',
    displayName: 'test',
    version: 'v1',
    pixelSize: { width: 100, height: 100 },
    pixelOrigin: { x: 0, y: 0 },
    areas: [],
    basemaps: [],
    routes: [],
    routeGroups: [],
    pointTopology: emptyPointTopology(),
    ...over,
  }
}

describe('mergeBuiltinRefreshPreservingEditorData', () => {
  it('keeps local routes and pointTopology when remote builtin has none', () => {
    const local = baseParsed({
      routes: [
        {
          routeId: 'r1',
          displayName: '路線A',
          stationIds: ['a', 'b'],
        },
      ],
      pointTopology: {
        version: 1,
        nodes: [
          {
            id: 'n1',
            kind: 'docking',
            label: '停1',
            x: 10,
            y: 20,
            color: '#111111',
          },
        ],
        edges: [
          {
            id: 'e1',
            fromNodeId: 'n1',
            toNodeId: 'n1',
            minTravelTimeSeconds: 10,
            avgTravelTimeSeconds: 20,
            distanceMeters: 30,
          },
        ],
      },
    })
    const remote = baseParsed({
      displayName: '內建新版',
      areas: [],
    })
    const merged = mergeBuiltinRefreshPreservingEditorData(remote, local)
    assert.equal(merged.displayName, '內建新版')
    assert.equal(merged.routes.length, 1)
    assert.equal(merged.routes[0]!.routeId, 'r1')
    assert.equal(merged.pointTopology.nodes.length, 1)
    assert.equal(merged.pointTopology.edges.length, 1)
  })
})
