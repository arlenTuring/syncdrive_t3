import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GeneratedScheduleBlock } from './schedule-engine/types.ts';
import { trimIncompleteRotationCyclesOnTimelines } from './trimIncompleteRotationCycles.ts';

function pax(
  id: string,
  row: number,
  start: number,
  routeCode = 'TN',
): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: row,
    taskType: 'passenger',
    label: '正線',
    source: 'template_bar',
    plannedStartMinute: start,
    plannedEndMinute: start + 5,
    anchorStartMinute: start,
    travelSeconds: 200,
    dwellSeconds: 50,
    routeId: `route-${routeCode}`,
    routeCode,
    routeName: routeCode,
  };
}

function yard(
  id: string,
  row: number,
  start: number,
  taskType: 'charging' | 'servicing' = 'charging',
): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: row,
    taskType,
    label: taskType,
    source: 'template_bar',
    plannedStartMinute: start,
    plannedEndMinute: start + 30,
    anchorStartMinute: start,
    travelSeconds: 0,
    dwellSeconds: 0,
  };
}

describe('trimIncompleteRotationCyclesOnTimelines', () => {
  it('drops trailing trips until passenger count is a multiple of routeCount', () => {
    const result = trimIncompleteRotationCyclesOnTimelines({
      routeCount: 4,
      timelines: [
        {
          row: 4,
          blocks: [
            pax('a', 4, 10, 'TN'),
            pax('b', 4, 20, 'NT'),
            pax('c', 4, 30, 'TS'),
            pax('d', 4, 40, 'ST'),
            pax('e', 4, 50, 'TNB'),
            pax('f', 4, 60, 'NT'),
            pax('g', 4, 70, 'TS'),
            // 7 trips → drop last 3
          ],
        },
      ],
    });
    assert.equal(result.trimmedTotal, 3);
    assert.equal(result.trimmedByRow[4], 3);
    const remaining = result.timelines[0]!.blocks.filter((b) => b.taskType === 'passenger');
    assert.equal(remaining.length, 4);
    assert.deepEqual(
      remaining.map((b) => b.id),
      ['a', 'b', 'c', 'd'],
    );
  });

  it('trims incomplete stretch before mid-day charging even when day total is multiple', () => {
    // 全日 4+3+1=8 趟（被 4 整除），但充電前 3 趟未成輪 → 應撤 NT/TS/ST
    const result = trimIncompleteRotationCyclesOnTimelines({
      routeCount: 4,
      timelines: [
        {
          row: 1,
          blocks: [
            pax('m1', 1, 10, 'NT'),
            pax('m2', 1, 20, 'TS'),
            pax('m3', 1, 30, 'ST'),
            pax('m4', 1, 40, 'TN'),
            pax('a', 1, 50, 'NT'),
            pax('b', 1, 60, 'TS'),
            pax('c', 1, 70, 'ST'),
            yard('chg', 1, 80, 'charging'),
            pax('e', 1, 120, 'NT'),
          ],
        },
      ],
    });
    assert.equal(result.trimmedTotal, 4); // 充電前 3 + 日終 1
    const remaining = result.timelines[0]!.blocks.filter((b) => b.taskType === 'passenger');
    assert.deepEqual(
      remaining.map((b) => b.id),
      ['m1', 'm2', 'm3', 'm4'],
    );
  });

  it('keeps full cycles untouched', () => {
    const result = trimIncompleteRotationCyclesOnTimelines({
      routeCount: 4,
      timelines: [
        {
          row: 1,
          blocks: [
            pax('a', 1, 10),
            pax('b', 1, 20),
            pax('c', 1, 30),
            pax('d', 1, 40),
          ],
        },
      ],
    });
    assert.equal(result.trimmedTotal, 0);
    assert.equal(result.timelines[0]!.blocks.length, 4);
  });

  it('no-ops when routeCount <= 1', () => {
    const result = trimIncompleteRotationCyclesOnTimelines({
      routeCount: 1,
      timelines: [{ row: 1, blocks: [pax('a', 1, 10), pax('b', 1, 20)] }],
    });
    assert.equal(result.trimmedTotal, 0);
    assert.equal(result.timelines[0]!.blocks.length, 2);
  });
});
