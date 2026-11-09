import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VehicleTrajectory } from './pathOccupancy';
import { moveConflictSolverInternals, solveMoveShifts, type ShiftVariable } from './moveConflictSolver';

function trajectory(blockId: string, row: number, kind: 'move' | 'passenger', visits: Array<[string, number, number?]>): VehicleTrajectory {
  return {
    blockId, timelineRow: row, kind, label: blockId,
    visits: visits.map(([nodeId, a, d]) => ({ nodeId, nodeLabel: nodeId, arriveSecond: a, departSecond: d ?? a })),
  };
}

function variable(key: string, t: VehicleTrajectory, min: number, max: number, fixedLast: number | null = null): ShiftVariable {
  return { key, timelineRow: t.timelineRow, trajectories: [t], min, max, fixedLastDepartSecond: fixedLast };
}

describe('moveConflictSolver（替代圖）', () => {
  it('可行點：每段可行區間取最接近 0 的一點', () => {
    const points = moveConflictSolverInternals.feasiblePoints(-300, 300, [[-100, 100]]);
    assert.deepEqual(points.slice(0, 2).sort((a, b) => a - b), [-100, 100]);
  });

  it('穿過有車停靠的月台：往前閃到對方到站前一個緩衝', () => {
    const exit = trajectory('exit', 6, 'move', [['H1', 1000], ['T3u', 1060], ['NW', 1230]]);
    const pax = trajectory('st', 8, 'passenger', [['SW', 900], ['T3u', 1060, 1100]]);
    const solved = solveMoveShifts({ variables: [variable('exit', exit, -600, 0)], fixed: [pax], bufferSeconds: 60 });
    assert.equal(solved?.shifts.get('exit'), -60);
  });

  it('兩台同時結束充電、要過同一個月台：一台照原時刻，另一台讓', () => {
    const a = trajectory('a', 3, 'move', [['E1', 1000], ['NW', 1030], ['T3d', 1200]]);
    const b = trajectory('b', 4, 'move', [['E2', 1000], ['NW', 1030], ['T3d', 1200]]);
    const solved = solveMoveShifts({
      variables: [variable('a', a, 0, 600), variable('b', b, 0, 600)], fixed: [], bufferSeconds: 60,
    });
    const values = [solved!.shifts.get('a'), solved!.shifts.get('b')].sort((x, y) => x! - y!);
    assert.deepEqual(values, [0, 60]);
  });

  it('同向不超車：後出發的不能排成先到', () => {
    // 對方 1000 進 A、1300 才到 B；我平移 0 時 1100 進、1200 到——超車，要讓
    const slow = trajectory('slow', 1, 'passenger', [['A', 1000], ['B', 1300]]);
    const mine = trajectory('mine', 2, 'move', [['A', 1100], ['B', 1200]]);
    const solved = solveMoveShifts({ variables: [variable('mine', mine, -300, 300)], fixed: [slow], bufferSeconds: 0 });
    const shift = solved!.shifts.get('mine')!;
    const enter = 1100 + shift;
    const exit = 1200 + shift;
    assert.ok((enter < 1000 && exit < 1300) || (enter > 1000 && exit > 1300), `平移 ${shift} 仍然超車`);
  });

  it('固定交通把可挪範圍全擋死：回報無解，不亂挪', () => {
    const exit = trajectory('exit', 6, 'move', [['H1', 1000], ['T3u', 1060]]);
    const pax = trajectory('st', 8, 'passenger', [['T3u', 1000, 1200]]);
    const solved = solveMoveShifts({ variables: [variable('exit', exit, -30, 30)], fixed: [pax], bufferSeconds: 60 });
    assert.deepEqual(solved?.unsolvable, ['exit']);
    assert.equal(solved?.shifts.size, 0);
  });

  it('提早到站後在站上等：等待那段也不能撞到站的別列車', () => {
    // 我要等到 2000 才發下一班；別列車 1500 到這一站、1540 離開 → 我不能在 1600 之前到
    const exit = trajectory('exit', 6, 'move', [['H1', 1300], ['NW', 1700]]);
    const pax = trajectory('tn', 1, 'passenger', [['T3', 1300], ['NW', 1500, 1540]]);
    const solved = solveMoveShifts({ variables: [variable('exit', exit, -600, 0, 2000)], fixed: [pax], bufferSeconds: 60 });
    assert.equal(solved?.shifts.get('exit'), 0);
    const early = solveMoveShifts({ variables: [variable('exit', exit, -600, -200, 2000)], fixed: [pax], bufferSeconds: 60 });
    assert.deepEqual(early?.unsolvable, ['exit']);
  });
});
