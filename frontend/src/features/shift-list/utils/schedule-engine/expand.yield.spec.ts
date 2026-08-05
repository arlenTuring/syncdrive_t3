import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandRowBlocks } from './expand.ts';
import { secondToMinute } from './types.ts';
import type { ScheduleTask } from '../../../time-templates/types/editor.ts';
import type { ResolvedTemplateTask } from './types.ts';

describe('expandRowBlocks maintenance yield', () => {
  it('defers charging start when preceding passenger ends after charging template start', () => {
    const stStart = 3 * 3600 + 30 * 60 + 40;
    const stOcc = 180;
    const chStart = 3 * 3600 + 33 * 60 + 30;
    const chEnd = 4 * 3600 + 30 * 60;

    const rowTasks: ScheduleTask[] = [
      {
        id: 'st',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: secondToMinute(stStart),
        durationMinutes: stOcc / 60,
        label: 'ST',
      },
      {
        id: 'eb',
        rowIndex: 1,
        taskType: 'charging',
        startMinute: secondToMinute(chStart),
        durationMinutes: (chEnd - chStart) / 60,
        label: '充電',
      },
    ];

    const resolvedByTaskId = new Map<string, ResolvedTemplateTask>([
      [
        'st',
        {
          task: rowTasks[0]!,
          route: null,
          occupancySeconds: stOcc,
          travelSeconds: 160,
          dwellSeconds: 20,
        },
      ],
      [
        'eb',
        {
          task: rowTasks[1]!,
          route: null,
          occupancySeconds: chEnd - chStart,
          travelSeconds: 0,
          dwellSeconds: chEnd - chStart,
        },
      ],
    ]);

    const errors = [];
    const blocks = expandRowBlocks(rowTasks, resolvedByTaskId, errors, 30, []);
    const st = blocks.find((b) => b.id === 'st')!;
    const eb = blocks.find((b) => b.id === 'eb')!;
    assert.ok(st);
    assert.ok(eb);
    assert.ok(
      st.plannedEndMinute <= eb.plannedStartMinute + 1e-9,
      `overlap: ST ends ${st.plannedEndMinute}, EB starts ${eb.plannedStartMinute}`,
    );
    assert.equal(Math.round(eb.plannedStartMinute * 60), stStart + stOcc);
    assert.equal(Math.round(eb.plannedEndMinute * 60), chEnd);
  });
});
