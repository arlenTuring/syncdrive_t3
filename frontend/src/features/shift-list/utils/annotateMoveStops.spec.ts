import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology, type PointTopology } from '../../map-editor/types/pointTopology';
import { annotateMoveStops } from './annotateMoveStops';
import type { GeneratedSchedulePlan, GeneratedScheduleBlock } from './schedule-engine/types';

function node(id: string, kind: 'facility' | 'docking' | 'waypoint', stationId?: string) {
  return { id, kind, label: id, x: 0, y: 0, color: '#111111', ...(stationId ? { stationId } : {}) } as const;
}
function edge(from: string, to: string, seconds: number) {
  return { id: `e:${from}->${to}`, fromNodeId: from, toNodeId: to, minTravelTimeSeconds: seconds, avgTravelTimeSeconds: seconds, distanceMeters: null };
}

/** 入口點 G 經 P1（到 T 共 20 秒）或 P2（到 T 共 viaP2Seconds 秒）都能到 H */
function topology(viaP2Seconds: number): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [node('G', 'waypoint'), node('P1', 'docking', 'p1'), node('P2', 'docking', 'p2'), node('T', 'docking', 't'), node('H', 'facility')],
    edges: [edge('G', 'P1', 10), edge('P1', 'T', 10), edge('G', 'P2', 10), edge('P2', 'T', viaP2Seconds - 10), edge('T', 'H', 10)],
  } as PointTopology;
}

function moveCard(via: string[]): GeneratedScheduleBlock {
  return {
    id: 'yardtransit-in-1',
    timelineRow: 1,
    taskType: 'dispatch',
    source: 'yard_entry_move',
    plannedStartMinute: 600,
    plannedEndMinute: 601,
    yardExitFacilityNodeId: 'H',
    yardExitStationId: 'G',
    yardMoveViaLabels: via,
  } as unknown as GeneratedScheduleBlock;
}

function plan(block: GeneratedScheduleBlock): GeneratedSchedulePlan['timelines'] {
  return [{ row: 1, blocks: [block] }] as unknown as GeneratedSchedulePlan['timelines'];
}

describe('annotateMoveStops：訂單途經點', () => {
  it('走唯一最短路也帶途經點：車端的「最短」不一定跟引擎同一把尺', () => {
    const block = moveCard(['G', 'P1', 'T', 'H']);
    annotateMoveStops(plan(block), topology(40));
    assert.deepEqual(block.yardMoveStops?.map((stop) => stop.stationId), ['p1', 't']);
  });

  it('中途沒有點位識別碼的節點：不帶', () => {
    const block = moveCard(['G', 'P1', 'T', 'H']);
    const topo = topology(40);
    topo.nodes = topo.nodes.map((n) => ({ ...n, stationId: undefined })) as PointTopology['nodes'];
    annotateMoveStops(plan(block), topo);
    assert.equal(block.yardMoveStops, undefined);
  });

  it('走替代路線：寫下途經點與經過秒數，沒有點位識別碼的節點不送', () => {
    const block = moveCard(['G', 'P2', 'T', 'H']);
    annotateMoveStops(plan(block), topology(40));
    assert.deepEqual(block.yardMoveStops, [
      { stationId: 'p2', name: 'P2', offsetSeconds: 10 },
      { stationId: 't', name: 'T', offsetSeconds: 40 },
    ]);
  });

  it('兩條路一樣快：就算走的是第一條也要帶，避免車開去另一條', () => {
    const block = moveCard(['G', 'P1', 'T', 'H']);
    annotateMoveStops(plan(block), topology(20));
    assert.deepEqual(block.yardMoveStops?.map((stop) => stop.stationId), ['p1', 't']);
  });
});
