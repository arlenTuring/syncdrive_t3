import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlanFingerprint,
  resolveSchedulePublishState,
  runSchedulePublishCheck,
  toPublishCheckRecord,
} from './schedulePublishCheck';
import type { GeneratedSchedulePlan } from './schedule-engine/types';

/** 一條 A→B 路線，終點站 B 就是站位 */
const ROUTES = [
  {
    routeId: 'ab',
    routeCode: 'AB',
    routeName: 'A>B',
    stationIds: ['station_a', 'station_b'],
    stationDwells: [
      { stationId: 'station_a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'station_b', stationName: 'B', dwellSeconds: 0, dwellRequired: false },
    ],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
] as never as Parameters<typeof runSchedulePublishCheck>[0]['selectedRoutes'];

function planWith(starts: number[]): GeneratedSchedulePlan {
  return {
    timelines: starts.map((startMinute, index) => ({
      row: index + 1,
      blocks: [
        {
          id: `blk-${index}`,
          timelineRow: index + 1,
          taskType: 'passenger',
          label: 'A>B',
          routeId: 'ab',
          anchorStartMinute: startMinute,
          plannedStartMinute: startMinute,
          plannedEndMinute: startMinute + 5,
          travelSeconds: 300,
          dwellSeconds: 0,
          source: 'template_bar',
        },
      ],
    })),
  } as never as GeneratedSchedulePlan;
}

function check(plan: GeneratedSchedulePlan) {
  return runSchedulePublishCheck({
    plan,
    selectedRoutes: ROUTES,
    collisionProtectionSeconds: 30,
  });
}

describe('schedulePublishCheck', () => {
  it('班次拉得開時檢查通過', () => {
    const result = check(planWith([0, 60]));
    assert.equal(result.publishSafe, true);
    assert.equal(result.publishBlockingCount, 0);
  });

  it('兩台車擠在同一個站位時擋發布', () => {
    // 兩列同時抵達 station_b，一個停靠點停不下兩台
    const result = check(planWith([0, 0]));
    assert.equal(result.publishSafe, false);
    assert.ok(result.publishBlockingCount > 0);
    assert.ok(result.blockingIssues.length > 0);
  });

  it('沒檢查紀錄就是未檢查', () => {
    assert.equal(resolveSchedulePublishState(null, planWith([0])), 'unchecked');
  });

  it('檢查通過且班表沒被改過＝可發布', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-08-09T00:00:00.000Z');
    assert.equal(resolveSchedulePublishState(record, plan), 'ready');
  });

  it('檢查有擋發布的問題＝不建議發布', () => {
    const plan = planWith([0, 0]);
    const record = toPublishCheckRecord(check(plan), '2026-08-09T00:00:00.000Z');
    assert.equal(resolveSchedulePublishState(record, plan), 'blocked');
  });

  it('檢查之後班表被改動，狀態回到未檢查（不拿舊結論替新內容背書）', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-08-09T00:00:00.000Z');
    assert.equal(resolveSchedulePublishState(record, plan), 'ready');

    const edited = planWith([0, 61]);
    assert.equal(resolveSchedulePublishState(record, edited), 'unchecked');
  });

  it('改完又改回原樣時仍算已檢查——指紋比的是內容不是時間', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-08-09T00:00:00.000Z');
    const movedBack = planWith([0, 60]);
    assert.equal(buildPlanFingerprint(movedBack), record.planFingerprint);
    assert.equal(resolveSchedulePublishState(record, movedBack), 'ready');
  });
});
