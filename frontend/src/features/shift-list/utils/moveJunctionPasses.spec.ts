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

  it('經過時刻算不出來（缺時間、沒有路段、名稱對不到或重名）都要回報，不能略過當沒問題', () => {
    const gaps: Array<{ reason: string; fromLabel: string; toLabel: string }> = [];
    const collect = (topo: PointTopology, via: string[]) => {
      gaps.length = 0;
      collectMoveJunctionPasses([{ row: 1, blocks: [move('m', 1, 1000, via)] }], topo, (gap) => gaps.push(gap));
      return gaps.map((gap) => [gap.reason, gap.fromLabel, gap.toLabel]);
    };
    const noTime = {
      ...topology,
      edges: topology.edges.map((edge) => edge.id === 'b'
        ? { ...edge, avgTravelTimeSeconds: null, minTravelTimeSeconds: null } : edge),
    } as unknown as PointTopology;
    assert.deepEqual(collect(noTime, ['N2W', '入口點', 'E1']), [['missing-time', '入口點', 'E1']]);
    assert.deepEqual(collect(topology, ['E1', 'E2', '入口點']), [['no-edge', 'E1', 'E2']]);
    assert.deepEqual(collect(topology, ['N2W', '不存在', 'E1']), [['unknown-node', '不存在', '不存在']]);
    const duplicated = {
      ...topology,
      nodes: [...topology.nodes, { id: 'gate-2', label: '入口點', kind: 'waypoint' }],
    } as unknown as PointTopology;
    assert.deepEqual(collect(duplicated, ['N2W', '入口點', 'E1']), [['ambiguous-node', '入口點', '入口點']]);
    // 資料齊全：不回報
    assert.deepEqual(collect(topology, ['N2W', '入口點', 'E1']), []);
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
