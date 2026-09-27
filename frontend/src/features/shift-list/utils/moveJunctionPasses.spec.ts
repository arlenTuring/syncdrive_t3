import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';
import { collectMoveJunctionPasses, findJunctionConflictsForBlocks } from './moveJunctionPasses';
import { moveCardFacilityIsFree } from './moveCardShared';

const topology = {
  nodes: [
    { id: 'st', label: 'N2W', kind: 'docking', stationId: 'n2w' },
    { id: 'gate', label: '入口點', kind: 'waypoint' },
    { id: 'e1', label: 'E1', kind: 'facility' },
    { id: 'e2', label: 'E2', kind: 'facility' },
  ],
  edges: [
    { id: 'a', fromNodeId: 'st', toNodeId: 'gate', avgTravelTimeSeconds: 20, minTravelTimeSeconds: 20, distanceMeters: null },
    { id: 'b', fromNodeId: 'gate', toNodeId: 'e1', avgTravelTimeSeconds: 10, minTravelTimeSeconds: 10, distanceMeters: null },
    { id: 'c', fromNodeId: 'gate', toNodeId: 'e2', avgTravelTimeSeconds: 10, minTravelTimeSeconds: 10, distanceMeters: null },
  ],
} as unknown as PointTopology;

function move(id: string, row: number, startSecond: number, via: string[]): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: row,
    taskType: 'dispatch',
    label: id,
    source: 'yard_entry_move',
    travelSeconds: 30,
    dwellSeconds: 0,
    anchorStartMinute: startSecond / 60,
    plannedStartMinute: startSecond / 60,
    plannedEndMinute: (startSecond + 30) / 60,
    yardMoveViaLabels: via,
  } as GeneratedScheduleBlock;
}

describe('moveJunctionPasses', () => {
  it('沿拓樸行駛秒數重建中途節點的經過時刻，兩列 40 秒內經過同一點就是衝突', () => {
    const timelines: GeneratedScheduleTimeline[] = [
      { row: 1, blocks: [move('out-1', 1, 1000, ['E1', '入口點', 'N2W'])] },
      { row: 2, blocks: [move('in-2', 2, 950, ['N2W', '入口點', 'E2'])] },
    ];
    const passes = collectMoveJunctionPasses(timelines, topology);
    assert.deepEqual(
      passes.map((pass) => [pass.blockId, pass.nodeId, pass.instant]).sort(),
      [['in-2', 'gate', 970], ['out-1', 'gate', 1010]],
    );
    const conflicts = findJunctionConflictsForBlocks(passes, new Set(['in-2']), 60);
    assert.equal(conflicts.length, 1);
    assert.equal(Math.round(conflicts[0]!.gapSeconds), 40);
    assert.equal(findJunctionConflictsForBlocks(passes, new Set(['in-2']), 30).length, 0);
  });

  it('零長度示意卡（同區域 0 秒轉移）沒有實際路徑，不參與', () => {
    const zero = { ...move('z', 1, 1000, ['E1', '入口點', 'E2']), plannedEndMinute: 1000 / 60 };
    assert.equal(collectMoveJunctionPasses([{ row: 1, blocks: [zero] }], topology).length, 0);
  });
});

describe('moveCardFacilityIsFree：交接間隔', () => {
  const bookings = [{ facilityNodeId: 'E2', startSecond: 79960, endSecond: 86400, timelineRow: 4 }];
  it('前車 24:00 離格，後車 00:00:01 進格：不給交接間隔時算空，給 60 秒就不空', () => {
    assert.equal(moveCardFacilityIsFree(bookings, 'E2', 86401, 91800, 7), true);
    assert.equal(moveCardFacilityIsFree(bookings, 'E2', 86401, 91800, 7, 60), false);
    assert.equal(moveCardFacilityIsFree(bookings, 'E2', 86460, 91800, 7, 60), true);
  });
});
