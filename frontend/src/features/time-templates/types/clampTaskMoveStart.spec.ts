import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ScheduleTask } from './editor';
import {
  clampRangeEndAwayFromOverlappingTasks,
  clampRangeStartAwayFromOverlappingTasks,
  clampTaskMoveStart,
} from './editor';

const activeRanges = [{ start: 180, end: 1320 }]; // 03:00–22:00

const tasks: ScheduleTask[] = [
  {
    id: 'a',
    rowIndex: 1,
    taskType: 'passenger',
    startMinute: 180,
    durationMinutes: 60,
    label: '正線',
  },
  {
    id: 'b',
    rowIndex: 1,
    taskType: 'charging',
    startMinute: 300,
    durationMinutes: 60,
    label: '充電',
  },
];

describe('clampTaskMoveStart', () => {
  it('shifts task within active range', () => {
    assert.equal(
      clampTaskMoveStart('a', 1, 60, 240, activeRanges, tasks),
      240,
    );
  });

  it('stops before overlapping neighbor when moving right', () => {
    assert.equal(
      clampTaskMoveStart('a', 1, 60, 280, activeRanges, tasks),
      240,
    );
  });

  it('stops after overlapping neighbor when moving left', () => {
    assert.equal(
      clampTaskMoveStart('b', 1, 60, 200, activeRanges, tasks),
      240,
    );
  });
});

describe('拉伸邊緣遇到同列其他任務（含跨午夜）', () => {
  const early: ScheduleTask = { id: 'early', rowIndex: 1, taskType: 'standby', startMinute: 0, durationMinutes: 30, label: '待命' };
  const late: ScheduleTask = { id: 'late', rowIndex: 1, taskType: 'charging', startMinute: 23 * 60, durationMinutes: 120, label: '充電' };

  it('右緣拉過午夜：停在清晨那根任務的開始（00:00），不會蓋上去', () => {
    // 條子 23:00 起，右緣想拉到隔天 01:00；清晨 00:00–00:30 有一根待命
    assert.equal(clampRangeEndAwayFromOverlappingTasks('t', 1, 23 * 60, 25 * 60, [early]), 24 * 60);
  });

  it('左緣往前拉：停在跨午夜那根任務的結束（01:00）', () => {
    // 同列有一根 23:00–隔天 01:00 的充電；條子 02:00 結束，左緣想拉到 00:30
    assert.equal(clampRangeStartAwayFromOverlappingTasks('t', 1, 30, 120, [late]), 60);
  });

  it('縮這一邊解不掉的重疊不硬縮：條子維持原樣交給另一邊處理', () => {
    // 對方 05:00–06:00 蓋住條子的結尾（04:40–05:40）：縮左緣解不掉，左緣不動
    const other: ScheduleTask = { id: 'o', rowIndex: 1, taskType: 'charging', startMinute: 300, durationMinutes: 60, label: '充電' };
    assert.equal(clampRangeStartAwayFromOverlappingTasks('t', 1, 280, 340, [other]), 280);
    // 縮右緣才解得掉：右緣停在對方開始
    assert.equal(clampRangeEndAwayFromOverlappingTasks('t', 1, 280, 340, [other]), 300);
  });

  it('別列的任務不影響', () => {
    const otherRow: ScheduleTask = { ...early, rowIndex: 2 };
    assert.equal(clampRangeEndAwayFromOverlappingTasks('t', 1, 23 * 60, 25 * 60, [otherRow]), 25 * 60);
  });
});
