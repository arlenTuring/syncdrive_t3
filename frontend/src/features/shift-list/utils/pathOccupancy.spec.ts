import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';
import {
  collectTrajectories,
  conflictsBetween,
  escapeShiftsFor,
  facilityAliases,
  moveTrajectory,
  type VehicleTrajectory,
} from './pathOccupancy';

function trajectory(
  blockId: string,
  row: number,
  kind: 'move' | 'passenger',
  visits: Array<[string, number, number?]>,
): VehicleTrajectory {
  return {
    blockId,
    timelineRow: row,
    kind,
    label: blockId,
    visits: visits.map(([nodeId, arrive, depart]) => ({
      nodeId, nodeLabel: nodeId, arriveSecond: arrive, departSecond: depart ?? arrive,
    })),
  };
}

const BUFFER = 60;

describe('pathOccupancy', () => {
  it('出場移動穿過別列車正在停靠的月台＝節點衝突（2026-11-08 OT062200 × ST2159）', () => {
    // 出場 22:00:30 出廠，22:01:30 經過 T3上行；別列車 22:01:30 到 T3上行、停到 22:02:10
    const exit = trajectory('exit', 6, 'move', [['H1', 79230], ['gate', 79260], ['T3u', 79290], ['N2W', 79455]]);
    const st = trajectory('st2159', 8, 'passenger', [['SW', 79150], ['T3u', 79290, 79330]]);
    const conflicts = conflictsBetween(exit, st, BUFFER);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.kind, 'node');
    assert.equal(conflicts[0]!.nodeId, 'T3u');
  });

  it('提早到能在別列車到站前一個緩衝離開，就不衝突', () => {
    const exit = trajectory('exit', 6, 'move', [['H1', 79160], ['gate', 79190], ['T3u', 79220], ['N2W', 79385]]);
    const st = trajectory('st2159', 8, 'passenger', [['SW', 79150], ['T3u', 79290, 79330]]);
    assert.equal(conflictsBetween(exit, st, BUFFER).length, 0);
  });

  it('閃避候選貼著緩衝邊緣：往前要讓我比對方到站早一個緩衝離開', () => {
    const exit = trajectory('exit', 6, 'move', [['H1', 79230], ['gate', 79260], ['T3u', 79290], ['N2W', 79455]]);
    const st = trajectory('st2159', 8, 'passenger', [['SW', 79150], ['T3u', 79290, 79330]]);
    const shifts = escapeShiftsFor(conflictsBetween(exit, st, BUFFER), BUFFER);
    assert.ok(shifts.includes(-60), `應有提早 60 秒的候選，實際 ${shifts.join(',')}`);
    assert.ok(shifts.includes(100), `應有延後到對方離站後一個緩衝（+100 秒）的候選，實際 ${shifts.join(',')}`);
  });

  it('同向同一段路：後進的車不能先出（不能要求穿過前車）', () => {
    // 前車 100 秒進 A→B、慢慢開 300 秒到；後車 200 秒進、100 秒就到——要超車
    const lead = trajectory('lead', 1, 'passenger', [['A', 0, 100], ['B', 400]]);
    const follower = trajectory('follow', 2, 'move', [['A', 200], ['B', 300]]);
    const conflicts = conflictsBetween(follower, lead, 0);
    assert.ok(conflicts.some((item) => item.kind === 'overtake'));
  });

  it('同向跟車、先進先出，間隔足夠就允許', () => {
    const lead = trajectory('lead', 1, 'passenger', [['A', 0, 100], ['B', 260]]);
    const follower = trajectory('follow', 2, 'move', [['A', 200], ['B', 360]]);
    assert.equal(conflictsBetween(follower, lead, BUFFER).length, 0);
  });

  it('同一條聯絡線兩個方向同時有車＝對開', () => {
    const inbound = trajectory('in', 1, 'move', [['gate', 0], ['H1', 30]]);
    const outbound = trajectory('out', 2, 'move', [['H1', 10], ['gate', 40]]);
    // 端點本身也會撞（節點衝突），重點是對開要被認出來
    assert.ok(conflictsBetween(inbound, outbound, 0).some((item) => item.kind === 'head-on'));
  });

  it('載客班次彼此不在這裡比（交給站位與班距）', () => {
    const a = trajectory('a', 1, 'passenger', [['T3u', 0, 40]]);
    const b = trajectory('b', 2, 'passenger', [['T3u', 10, 50]]);
    assert.equal(conflictsBetween(a, b, BUFFER).length, 0);
  });

  it('跨午夜：23:59:50 與 00:00:10 只差 20 秒', () => {
    const exit = trajectory('exit', 1, 'move', [['H1', 86_360], ['T3u', 86_390]]);
    const pax = trajectory('pax', 2, 'passenger', [['T3u', 10, 40]]);
    assert.equal(conflictsBetween(exit, pax, BUFFER)[0]?.kind, 'node');
  });
});

describe('moveTrajectory', () => {
  const topology = {
    nodes: [
      { id: '132', label: 'H1', kind: 'facility' },
      { id: 'gate', label: '整備調度入口點', kind: 'waypoint' },
      { id: '156', label: 'T3上行', kind: 'docking', stationId: 't3_u' },
    ],
    edges: [
      { id: 'a', fromNodeId: '132', toNodeId: 'gate', avgTravelTimeSeconds: 30, minTravelTimeSeconds: 30, distanceMeters: 100 },
      { id: 'b', fromNodeId: 'gate', toNodeId: '156', avgTravelTimeSeconds: 30, minTravelTimeSeconds: 30, distanceMeters: 100 },
    ],
  } as unknown as PointTopology;

  it('地圖改名後（D1 → H1）用卡片記的節點 id 對回路網', () => {
    const exit = {
      id: 'exit', timelineRow: 6, taskType: 'dispatch', source: 'yard_exit_move', label: '出場移動 · D1 → T3上行',
      plannedStartMinute: 1320.5, plannedEndMinute: 1321.5, anchorStartMinute: 1320.5, travelSeconds: 60,
      yardMoveViaLabels: ['D1', '整備調度入口點', 'T3上行'], yardExitFacilityNodeId: '132',
    } as unknown as GeneratedScheduleBlock;
    const result = moveTrajectory(exit, 6, topology);
    assert.deepEqual(result?.visits.map((visit) => visit.nodeId), ['132', 'gate', '156']);
    assert.equal(result?.visits[2]!.arriveSecond, 79290);
  });

  it('整備出廠卡只佔自己那一段（卡上記的是整趟轉場路線）', () => {
    const exit = {
      id: 'x', timelineRow: 1, taskType: 'dispatch', source: 'yard_exit_move', label: '整備出廠 · H1 → 整備調度入口點',
      plannedStartMinute: 690, plannedEndMinute: 690.5,
      yardExitFacilityNodeId: '132', yardExitStationId: 'gate',
      yardMoveViaLabels: ['H1', '整備調度入口點', 'T3上行'],
    } as unknown as GeneratedScheduleBlock;
    const entry = {
      id: 'n', timelineRow: 1, taskType: 'dispatch', source: 'yard_entry_move', label: '整備入廠 · 整備調度入口點 → T3上行',
      plannedStartMinute: 690.5, plannedEndMinute: 691,
      yardExitFacilityNodeId: '156', yardExitStationId: 'gate',
      yardMoveViaLabels: ['H1', '整備調度入口點', 'T3上行'],
    } as unknown as GeneratedScheduleBlock;
    assert.deepEqual(moveTrajectory(exit, 1, topology)?.visits.map((v) => v.nodeId), ['132', 'gate']);
    assert.deepEqual(moveTrajectory(entry, 1, topology)?.visits.map((v) => v.nodeId), ['gate', '156']);
  });

  it('整備間轉場的舊名稱用班表裡同名設施記下的節點 id 對回去', () => {
    const yard = {
      id: 'yard', timelineRow: 1, taskType: 'standby', label: '待命', plannedStartMinute: 0, plannedEndMinute: 10,
      yardFacilityLabel: 'D1', yardFacilityNodeId: '132',
    } as unknown as GeneratedScheduleBlock;
    const transfer = {
      id: 't', timelineRow: 1, taskType: 'dispatch', source: 'yard_entry_move', label: '入廠',
      plannedStartMinute: 10, plannedEndMinute: 11, yardMoveViaLabels: ['T3上行', '整備調度入口點', 'D1'],
    } as unknown as GeneratedScheduleBlock;
    const timelines = [{ row: 1, blocks: [yard, transfer] }] as unknown as GeneratedScheduleTimeline[];
    const result = moveTrajectory(transfer, 1, topology, undefined, facilityAliases(timelines));
    assert.deepEqual(result?.visits.map((visit) => visit.nodeId), ['156', 'gate', '132']);
  });
});

describe('0 秒相連的兩個停車位', () => {
  const topology = {
    nodes: [
      { id: 'end', label: 'NW上停1', kind: 'docking' },
      { id: 'start', label: 'NW下發1', kind: 'docking' },
      { id: 'gate', label: '轉線點', kind: 'waypoint' },
    ],
    edges: [
      { id: 'z', fromNodeId: 'end', toNodeId: 'start', avgTravelTimeSeconds: 0, minTravelTimeSeconds: 0, distanceMeters: 9.1 },
      { id: 'g', fromNodeId: 'gate', toNodeId: 'end', avgTravelTimeSeconds: 30, minTravelTimeSeconds: 30, distanceMeters: 100 },
    ],
  } as unknown as PointTopology;

  it('一台停 NW上停1、另一台停 NW下發1，不算同一個位置', () => {
    const a = trajectory('a', 1, 'move', [['end', 0, 300]]);
    const b = trajectory('b', 2, 'move', [['start', 100, 200]]);
    assert.equal(conflictsBetween(a, b, BUFFER).length, 0);
  });

  it('折返：車停在到站點等到發車，期間到站點被佔用', () => {
    const arrive = {
      id: 'in', timelineRow: 1, taskType: 'dispatch', label: '入', plannedStartMinute: 0, plannedEndMinute: 0.5,
      yardMoveViaLabels: ['轉線點', 'NW上停1'],
    } as unknown as GeneratedScheduleBlock;
    const leave = {
      id: 'out', timelineRow: 1, taskType: 'dispatch', label: '出', plannedStartMinute: 10, plannedEndMinute: 10.5,
      yardMoveViaLabels: ['NW下發1', 'NW上停1'],
    } as unknown as GeneratedScheduleBlock;
    const timelines = [{ row: 1, blocks: [arrive, leave] }] as unknown as GeneratedScheduleTimeline[];
    const [first] = collectTrajectories(timelines, [], topology);
    const tail = first!.visits[first!.visits.length - 1]!;
    assert.equal(tail.nodeId, 'end');
    assert.equal(tail.departSecond, 600);
  });
});
