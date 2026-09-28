import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlanFingerprint,
  buildSafetySettingsFingerprint,
  buildTopologyFingerprint,
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

it('缺少路線時不能略過站位檢查而通過發布', () => {
  const result = runSchedulePublishCheck({ plan: planWith([0]), selectedRoutes: [], collisionProtectionSeconds: 30 });
  assert.equal(result.publishSafe, false);
  assert.ok(result.blockingIssues.some((issue) => issue.code === 'NO_ROUTE_FOR_TASK_TYPE'));
});

describe('schedulePublishCheck', () => {
  it('移動卡缺路網時不得略過路徑檢查而顯示通過', () => {
    const plan = planWith([0]);
    const card = plan.timelines[0]!.blocks[0]!;
    card.taskType = 'dispatch';
    card.source = 'yard_entry_move';
    const result = check(plan);
    assert.equal(result.publishSafe, false);
    assert.equal(result.publishBlockingByCode.MISSING_TRAVEL_TIME, 1);
  });

  it('修改移動路徑或行駛秒數後，原本檢查紀錄失效', () => {
    const plan = planWith([0]);
    const record = toPublishCheckRecord(check(plan), '2026-09-27T00:00:00Z');
    plan.timelines[0]!.blocks[0]!.yardMoveViaLabels = ['A', 'C', 'B'];
    assert.equal(resolveSchedulePublishState(record, plan), 'unchecked');
    delete plan.timelines[0]!.blocks[0]!.yardMoveViaLabels;
    plan.timelines[0]!.blocks[0]!.travelSeconds += 1;
    assert.equal(resolveSchedulePublishState(record, plan), 'unchecked');
  });

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

  it('換了停放格位但時刻不變：指紋不同，舊的通過結果不能沿用', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-09-26T00:00:00.000Z');
    const moved = planWith([0, 60]);
    (moved.timelines[0]!.blocks[0] as { routeId?: string }).routeId = 'ab-backup';
    assert.equal(resolveSchedulePublishState(record, moved), 'unchecked');
  });

  it('發布前重驗證也看設施格交接：兩車同格只隔 30 秒就擋發布', () => {
    const plan = {
      timelines: [
        {
          row: 1,
          blocks: [
            {
              id: 'chg-1', timelineRow: 1, taskType: 'charging', label: '充電', source: 'template_bar',
              anchorStartMinute: 600, plannedStartMinute: 600, plannedEndMinute: 630,
              travelSeconds: 0, dwellSeconds: 0, yardFacilityNodeId: 'E2', yardFacilityLabel: 'E2',
            },
            {
              id: 'out-1', timelineRow: 1, taskType: 'dispatch', label: '出廠', source: 'yard_exit_move',
              anchorStartMinute: 630, plannedStartMinute: 630, plannedEndMinute: 631,
              travelSeconds: 60, dwellSeconds: 0, yardExitFacilityNodeId: 'E2',
            },
          ],
        },
        {
          row: 2,
          blocks: [
            {
              id: 'in-2', timelineRow: 2, taskType: 'dispatch', label: '入廠', source: 'yard_entry_move',
              anchorStartMinute: 629.5, plannedStartMinute: 629.5, plannedEndMinute: 630.5,
              travelSeconds: 30, dwellSeconds: 0, yardExitFacilityNodeId: 'E2',
            },
            {
              id: 'chg-2', timelineRow: 2, taskType: 'charging', label: '充電', source: 'template_bar',
              anchorStartMinute: 630.5, plannedStartMinute: 630.5, plannedEndMinute: 700,
              travelSeconds: 0, dwellSeconds: 0, yardFacilityNodeId: 'E2', yardFacilityLabel: 'E2',
            },
          ],
        },
      ],
    } as never as GeneratedSchedulePlan;
    const result = check(plan);
    assert.equal(result.publishSafe, false);
    assert.equal(result.publishBlockingByCode.FACILITY_HANDOVER_GAP, 1);
  });

  it('發布前重驗證抓得到缺移動：充電完直接跑正線、中間沒有出廠卡', () => {
    const plan = {
      timelines: [
        {
          row: 1,
          blocks: [
            {
              id: 'chg-1', timelineRow: 1, taskType: 'charging', label: '充電', source: 'template_bar',
              anchorStartMinute: 600, plannedStartMinute: 600, plannedEndMinute: 630,
              travelSeconds: 0, dwellSeconds: 0, yardFacilityNodeId: 'E2', yardFacilityLabel: 'E2',
            },
            {
              id: 'pax-1', timelineRow: 1, taskType: 'passenger', label: 'A>B', routeId: 'ab',
              source: 'template_bar', anchorStartMinute: 631, plannedStartMinute: 631,
              plannedEndMinute: 636, travelSeconds: 300, dwellSeconds: 0,
            },
          ],
        },
      ],
    } as never as GeneratedSchedulePlan;
    const result = check(plan);
    assert.equal(result.publishSafe, false);
    assert.equal(result.publishBlockingByCode.VEHICLE_LOCATION_DISCONTINUITY, 2,
      '充電後沒出廠卡、日循環繞回來正線後也沒入廠卡');
  });

  it('卡片起訖不變、只加了系統緩衝：指紋不同，舊的通過結果失效', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-09-26T00:00:00.000Z');
    const adjusted = planWith([0, 60]);
    (adjusted.timelines[0]!.blocks[0] as { dwellSlackAdjustment?: unknown }).dwellSlackAdjustment = {
      baseSlackSeconds: 0, addedSeconds: 30,
      reason: { code: 'X', resourceId: 's', resourceLabel: 'S', counterpartBlockIds: [], message: '' },
      affectedStops: [], blockBefore: { startMinute: 0, endMinute: 5 },
    };
    assert.equal(resolveSchedulePublishState(record, adjusted), 'unchecked');
  });

  it('舊紀錄沒有設定指紋：有提供目前設定時一律視為未檢查', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-08-09T00:00:00.000Z');
    const legacy = { ...record };
    delete legacy.settingsFingerprint;
    const current = buildSafetySettingsFingerprint({ selectedRoutes: ROUTES, collisionProtectionSeconds: 30 });
    assert.equal(resolveSchedulePublishState(record, plan, { settingsFingerprint: current }), 'ready');
    assert.equal(resolveSchedulePublishState(legacy, plan, { settingsFingerprint: current }), 'unchecked');
  });

  it('碰撞保護時間或停靠秒數改了，舊的通過結果失效', () => {
    const plan = planWith([0, 60]);
    const record = toPublishCheckRecord(check(plan), '2026-08-09T00:00:00.000Z');
    const protection60 = buildSafetySettingsFingerprint({ selectedRoutes: ROUTES, collisionProtectionSeconds: 60 });
    assert.equal(resolveSchedulePublishState(record, plan, { settingsFingerprint: protection60 }), 'unchecked');
    const longerDwell = [{
      ...ROUTES[0]!,
      stationDwells: [ROUTES[0]!.stationDwells![0]!, { ...ROUTES[0]!.stationDwells![1]!, dwellSeconds: 20 }],
    }] as typeof ROUTES;
    const dwell20 = buildSafetySettingsFingerprint({ selectedRoutes: longerDwell, collisionProtectionSeconds: 30 });
    assert.equal(resolveSchedulePublishState(record, plan, { settingsFingerprint: dwell20 }), 'unchecked');
  });

  it('路網的行駛秒數改了，舊的通過結果失效', () => {
    const plan = planWith([0, 60]);
    const topology = {
      version: 1,
      nodes: [{ id: 'n1', kind: 'docking', stationId: 'station_a', label: 'A', x: 0, y: 0, color: '#000' }],
      edges: [{ id: 'e', fromNodeId: 'n1', toNodeId: 'n1', minTravelTimeSeconds: 10, avgTravelTimeSeconds: 10, distanceMeters: null }],
    } as never as Parameters<typeof buildTopologyFingerprint>[0];
    const record = toPublishCheckRecord(
      runSchedulePublishCheck({ plan, selectedRoutes: ROUTES, collisionProtectionSeconds: 30, topology }),
      '2026-08-09T00:00:00.000Z',
    );
    const slower = { ...topology!, edges: [{ ...topology!.edges[0]!, avgTravelTimeSeconds: 20 }] };
    assert.equal(resolveSchedulePublishState(record, plan, { topologyFingerprint: buildTopologyFingerprint(topology) }), 'ready');
    assert.equal(resolveSchedulePublishState(record, plan, { topologyFingerprint: buildTopologyFingerprint(slower) }), 'unchecked');
  });
});
