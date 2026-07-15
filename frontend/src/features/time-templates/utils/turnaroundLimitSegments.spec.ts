import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ScheduleTask } from '../types/editor';
import { computeTurnaroundLimitSegments } from './turnaroundLimitSegments';

const intervals = [
  {
    id: 'slot-1',
    attributeId: 'attr-1',
    name: '尖峰',
    startTime: '06:00',
    endTime: '22:00',
    isDraft: false,
  },
];

const attributes = [
  {
    id: 'attr-1',
    name: '尖峰',
    color: '#ff0000',
    headwaySeconds: 600,
    capacityPphpd: 300,
    isDraft: false,
  },
];

function passengerTask(
  id: string,
  rowIndex: number,
  startMinute: number,
  durationMinutes: number,
): ScheduleTask {
  return {
    id,
    rowIndex,
    taskType: 'passenger',
    startMinute,
    durationMinutes,
    label: '正線',
  };
}

describe('computeTurnaroundLimitSegments', () => {
  it('returns empty when no passenger tasks', () => {
    assert.deepEqual(
      computeTurnaroundLimitSegments([], intervals, attributes),
      [],
    );
  });

  it('splits at passenger boundaries and computes N × headway', () => {
    const tasks = [
      passengerTask('t1', 1, 600, 120),
      passengerTask('t2', 2, 660, 120),
    ];

    const segments = computeTurnaroundLimitSegments(tasks, intervals, attributes);
    assert.equal(segments.length, 3);

    assert.equal(segments[0]!.startMinute, 600);
    assert.equal(segments[0]!.endMinute, 660);
    assert.equal(segments[0]!.activePassengerCount, 1);
    assert.equal(segments[0]!.turnaroundLimitSeconds, 600);

    assert.equal(segments[1]!.startMinute, 660);
    assert.equal(segments[1]!.endMinute, 720);
    assert.equal(segments[1]!.activePassengerCount, 2);
    assert.equal(segments[1]!.turnaroundLimitSeconds, 1200);

    assert.equal(segments[2]!.startMinute, 720);
    assert.equal(segments[2]!.endMinute, 780);
    assert.equal(segments[2]!.activePassengerCount, 1);
    assert.equal(segments[2]!.turnaroundLimitSeconds, 600);
  });

  it('ignores non-passenger tasks for splitting', () => {
    const tasks = [
      passengerTask('t1', 1, 600, 60),
      {
        id: 'c1',
        rowIndex: 2,
        taskType: 'charging' as const,
        startMinute: 630,
        durationMinutes: 60,
        label: '充電',
      },
    ];

    const segments = computeTurnaroundLimitSegments(tasks, intervals, attributes);
    assert.equal(segments.length, 1);
    assert.equal(segments[0]!.turnaroundLimitSeconds, 600);
  });
});
