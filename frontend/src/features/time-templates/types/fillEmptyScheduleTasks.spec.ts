import { describe, expect, it } from 'vitest';
import {
  buildTasksToFillEmptyScheduleSlots,
  computeUncoveredRangesForRow,
  emptyEditorDraft,
  isCreateTemplateStep2Complete,
  listScheduleTimeGaps,
  type ScheduleTask,
} from './editor';

const ACTIVE_0_60 = [{ start: 0, end: 60 }];

describe('computeUncoveredRangesForRow', () => {
  it('returns full active range when row has no tasks', () => {
    expect(computeUncoveredRangesForRow(1, [], ACTIVE_0_60)).toEqual([
      { start: 0, end: 60 },
    ]);
  });

  it('returns trailing gap after existing task', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'a',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 30,
        label: '正線',
      },
    ];
    expect(computeUncoveredRangesForRow(1, tasks, ACTIVE_0_60)).toEqual([
      { start: 30, end: 60 },
    ]);
  });

  it('ignores tasks on other rows', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'a',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 60,
        label: '正線',
      },
    ];
    expect(computeUncoveredRangesForRow(1, tasks, ACTIVE_0_60)).toEqual([
      { start: 0, end: 60 },
    ]);
  });
});

describe('listScheduleTimeGaps', () => {
  it('lists gaps across rows with rowIndex', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'a',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 30,
        label: '正線',
      },
    ];
    expect(listScheduleTimeGaps(2, tasks, ACTIVE_0_60)).toEqual([
      { rowIndex: 1, start: 30, end: 60 },
      { rowIndex: 2, start: 0, end: 60 },
    ]);
  });

  it('returns empty when every active minute is covered', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'a',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 60,
        label: '正線',
      },
    ];
    expect(listScheduleTimeGaps(1, tasks, ACTIVE_0_60)).toEqual([]);
  });
});

describe('isCreateTemplateStep2Complete', () => {
  it('is false when active intervals have uncovered minutes', () => {
    const draft = emptyEditorDraft('測試');
    draft.intervals = [
      {
        id: 'i1',
        attributeId: 'a1',
        name: '早峰',
        startTime: '00:00',
        endTime: '01:00',
        isDraft: false,
      },
    ];
    draft.scheduleRowCount = 1;
    draft.tasks = [];
    expect(isCreateTemplateStep2Complete(draft)).toBe(false);
  });

  it('is true when all active minutes are filled', () => {
    const draft = emptyEditorDraft('測試');
    draft.intervals = [
      {
        id: 'i1',
        attributeId: 'a1',
        name: '早峰',
        startTime: '00:00',
        endTime: '01:00',
        isDraft: false,
      },
    ];
    draft.scheduleRowCount = 1;
    draft.tasks = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 60,
        label: '正線',
      },
    ];
    expect(isCreateTemplateStep2Complete(draft)).toBe(true);
  });
});

describe('buildTasksToFillEmptyScheduleSlots', () => {
  it('fills empty slots for every row', () => {
    const created = buildTasksToFillEmptyScheduleSlots(
      2,
      [],
      ACTIVE_0_60,
      'servicing',
    );
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ rowIndex: 1, taskType: 'servicing', startMinute: 0, durationMinutes: 60 });
    expect(created[1]).toMatchObject({ rowIndex: 2, taskType: 'servicing', startMinute: 0, durationMinutes: 60 });
  });

  it('skips already covered time', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'a',
        rowIndex: 1,
        taskType: 'charging',
        startMinute: 0,
        durationMinutes: 60,
        label: '充電',
      },
    ];
    const created = buildTasksToFillEmptyScheduleSlots(1, tasks, ACTIVE_0_60, 'servicing');
    expect(created).toHaveLength(0);
  });
});
