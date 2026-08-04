import { describe, expect, it } from 'vitest'
import {
  hashRevisionContent,
  isMilestoneReason,
  pickRevisionIdsToDelete,
  type MapRevisionMeta,
  type MapRevisionSummary,
} from './mapRevisionHistory'

const emptySummary: MapRevisionSummary = {
  areaCount: 0,
  facilityCount: 0,
  routeCount: 0,
  topologyNodeCount: 0,
  topologyEdgeCount: 0,
}

function meta(
  partial: Pick<MapRevisionMeta, 'id' | 'createdAt' | 'reason'> &
    Partial<MapRevisionMeta>,
): MapRevisionMeta {
  return {
    libraryId: 'lib-1',
    mapId: 'map-1',
    label: partial.id,
    contentHash: partial.id,
    byteSize: 100,
    summary: emptySummary,
    ...partial,
  }
}

describe('mapRevisionHistory helpers', () => {
  it('hashRevisionContent is stable for same input', () => {
    expect(hashRevisionContent('{"a":1}')).toBe(hashRevisionContent('{"a":1}'))
    expect(hashRevisionContent('{"a":1}')).not.toBe(
      hashRevisionContent('{"a":2}'),
    )
  })

  it('isMilestoneReason treats autosave as non-milestone', () => {
    expect(isMilestoneReason('autosave')).toBe(false)
    expect(isMilestoneReason('session-save')).toBe(true)
    expect(isMilestoneReason('manual-bookmark')).toBe(true)
  })

  it('pickRevisionIdsToDelete prefers dropping oldest autosaves', () => {
    const rows: MapRevisionMeta[] = [
      meta({ id: 'm1', createdAt: 1, reason: 'session-enter' }),
      meta({ id: 'a1', createdAt: 2, reason: 'autosave' }),
      meta({ id: 'a2', createdAt: 3, reason: 'autosave' }),
      meta({ id: 's1', createdAt: 4, reason: 'session-save' }),
      meta({ id: 'a3', createdAt: 5, reason: 'autosave' }),
    ]
    const drop = pickRevisionIdsToDelete(rows, 3)
    expect(drop.sort()).toEqual(['a1', 'a2'])
  })

  it('pickRevisionIdsToDelete can drop milestones if still over cap', () => {
    const rows: MapRevisionMeta[] = [
      meta({ id: 'm1', createdAt: 1, reason: 'session-enter' }),
      meta({ id: 'm2', createdAt: 2, reason: 'session-save' }),
      meta({ id: 'm3', createdAt: 3, reason: 'manual-bookmark' }),
    ]
    const drop = pickRevisionIdsToDelete(rows, 1)
    expect(drop).toHaveLength(2)
    expect(drop).not.toContain('m3')
  })

  it('pickRevisionIdsToDelete returns empty when under cap', () => {
    expect(
      pickRevisionIdsToDelete(
        [meta({ id: 'a1', createdAt: 1, reason: 'autosave' })],
        5,
      ),
    ).toEqual([])
  })
})
