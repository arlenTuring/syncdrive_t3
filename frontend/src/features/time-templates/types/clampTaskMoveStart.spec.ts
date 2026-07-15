import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ScheduleTask } from './editor';
import { clampTaskMoveStart } from './editor';

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
