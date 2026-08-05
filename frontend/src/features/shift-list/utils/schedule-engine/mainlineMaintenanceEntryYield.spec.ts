import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyMainlineMaintenanceEntryYield } from '../mainlineMaintenanceEntryYield.ts';
import type { GeneratedScheduleBlock } from './types.ts';

function block(
  partial: Partial<GeneratedScheduleBlock> & {
    id: string;
    taskType: GeneratedScheduleBlock['taskType'];
    plannedStartMinute: number;
    plannedEndMinute: number;
  },
): GeneratedScheduleBlock {
  return {
    timelineRow: 1,
    label: partial.id,
    anchorStartMinute: partial.plannedStartMinute,
    travelSeconds: 0,
    dwellSeconds: 0,
    source: 'template_bar',
    ...partial,
  };
}

describe('applyMainlineMaintenanceEntryYield', () => {
  it('pushes charging start when ST ends after charging template start (EB0333 case)', () => {
    // ST 03:30:40–03:33:40；充電原 03:33:30–04:30 → 應推到 03:33:40，尾鎖 04:30
    const stStart = (3 * 3600 + 30 * 60 + 40) / 60;
    const stEnd = (3 * 3600 + 33 * 60 + 40) / 60;
    const chStart = (3 * 3600 + 33 * 60 + 30) / 60;
    const chEnd = (4 * 3600 + 30 * 60) / 60;

    const timelines = applyMainlineMaintenanceEntryYield([
      {
        row: 1,
        blocks: [
          block({
            id: 'st',
            taskType: 'passenger',
            plannedStartMinute: stStart,
            plannedEndMinute: stEnd,
            routeCode: 'ST',
          }),
          block({
            id: 'eb',
            taskType: 'charging',
            plannedStartMinute: chStart,
            plannedEndMinute: chEnd,
            label: '充電',
          }),
        ],
      },
    ]);

    const eb = timelines[0]!.blocks.find((item) => item.id === 'eb')!;
    assert.ok(eb);
    assert.ok(eb.plannedStartMinute >= stEnd - 1e-9);
    assert.equal(Math.round(eb.plannedStartMinute * 60), Math.round(stEnd * 60));
    assert.equal(Math.round(eb.plannedEndMinute * 60), Math.round(chEnd * 60));
  });
});
