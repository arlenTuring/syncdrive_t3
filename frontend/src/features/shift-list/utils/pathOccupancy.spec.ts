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
  it('07:04:30 出場經過 T3U 時，驗證會抓到載客車的停留佔用', () => {
    const exit = trajectory('M2→NWD', 2, 'move', [['156', 25_470]]);
    const passenger = trajectory('passenger', 5, 'passenger', [['156', 25_290, 25_650]]);
    const conflicts = conflictsBetween(exit, passenger, 30);
    assert.equal(conflicts[0]?.kind, 'node');
    assert.equal(conflicts[0]?.gapSeconds, -180);
  });

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

describe('月台套站位規則（兩個 30 秒）', () => {
  const berthVisit = (t: VehicleTrajectory, nodeId: string) => {
    for (const visit of t.visits) if (visit.nodeId === nodeId) visit.berth = true;
    return t;
  };

  it('s4：入廠車在月台掉頭，30 秒後載客車進同一個月台停靠——只差一個 30 秒，不成立', () => {
    // 01:33:10 掉頭（5590）；載客車 01:33:40 到（5620）、停到 01:43:30（6210）
    const move = berthVisit(trajectory('in', 3, 'move', [['gate', 5540], ['NWD', 5590], ['T3D', 5760]]), 'NWD');
    const pax = berthVisit(trajectory('tn', 2, 'passenger', [['T3U', 5445], ['NWD', 5620, 6210]]), 'NWD');
    const conflicts = conflictsBetween(move, pax, 30);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.nodeId, 'NWD');
    assert.equal(conflicts[0]!.requiredGapSeconds, 60);
    // 往前需提早 30 秒，往後只需等到對方離站後 30 秒。
    const shifts = escapeShiftsFor(conflicts, 30);
    assert.ok(shifts.includes(-30), `候選 ${shifts.join(',')}`);
    assert.ok(shifts.includes(6210 + 30 - 5590), `候選 ${shifts.join(',')}`);
  });

  it('移動車在載客車離站後 30 秒通過，交換檢查順序也合法', () => {
    const pax = berthVisit(trajectory('pax', 2, 'passenger', [['NWD', 100, 700]]), 'NWD');
    const move = berthVisit(trajectory('move', 3, 'move', [['NWD', 730]]), 'NWD');
    assert.deepEqual(conflictsBetween(move, pax, 30), []);
    assert.deepEqual(conflictsBetween(pax, move, 30), []);
  });

  it('差滿兩個 30 秒就成立', () => {
    const move = berthVisit(trajectory('in', 3, 'move', [['gate', 5510], ['NWD', 5560], ['T3D', 5730]]), 'NWD');
    const pax = berthVisit(trajectory('tn', 2, 'passenger', [['T3U', 5445], ['NWD', 5620, 6210]]), 'NWD');
    assert.equal(conflictsBetween(move, pax, 30).length, 0);
  });

  it('月台上兩台都只是經過不停：維持一個 30 秒', () => {
    const a = berthVisit(trajectory('a', 3, 'move', [['gate', 100], ['T3U', 150], ['x', 300]]), 'T3U');
    const b = berthVisit(trajectory('b', 4, 'move', [['y', 0], ['T3U', 185], ['z', 400]]), 'T3U');
    assert.equal(conflictsBetween(a, b, 30).length, 0);
  });

  it('不是月台的點（入口點、轉線點）就算對方停著，也維持一個 30 秒', () => {
    const move = trajectory('in', 3, 'move', [['a', 100], ['gate', 150], ['b', 300]]);
    const waiting = trajectory('w', 4, 'move', [['c', 0], ['gate', 185, 400]]);
    assert.equal(conflictsBetween(move, waiting, 30).length, 0);
  });
});
