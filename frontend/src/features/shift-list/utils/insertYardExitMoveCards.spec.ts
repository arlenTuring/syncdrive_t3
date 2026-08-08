import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { insertYardExitMoveCards } from './insertYardExitMoveCards';
import type { MaintenanceFirstTripOrigin } from './maintenanceFirstTripOrigins';
import type { GeneratedSchedulePlan } from './schedule-engine/types';

const ORIGINS: MaintenanceFirstTripOrigin[] = [
  {
    stationId: 'station_4',
    label: 'T3上行',
    deadheadSeconds: 60,
    facilityNodeIds: ['fac-m1', 'fac-m2'],
    facilityLabels: ['M1', 'M2'],
    facilities: [
      { nodeId: 'fac-m1', label: 'M1', deadheadSeconds: 30 },
      { nodeId: 'fac-m2', label: 'M2', deadheadSeconds: 60 },
    ],
  },
];

const MAINTENANCE_BODY = {
  maintenance: {
    stepEnabled: true,
    equipmentRows: [{ id: 'r1', mapCode: 'M1' }, { id: 'r2', mapCode: 'M2' }],
  },
};

const SELECTED_ROUTES = [
  { routeId: 'route_tn', routeName: 'TN', stationIds: ['station_4', 'station_2'] },
] as never as Parameters<typeof insertYardExitMoveCards>[0]['selectedRoutes'];

function buildTimelines(args: {
  yardStartMinute: number;
  yardEndMinute: number;
  departMinute: number;
}): GeneratedSchedulePlan['timelines'] {
  return [
    {
      row: 1,
      blocks: [
        {
          id: 'yard-1',
          timelineRow: 1,
          taskType: 'servicing',
          label: '保養',
          anchorStartMinute: args.yardStartMinute,
          plannedStartMinute: args.yardStartMinute,
          plannedEndMinute: args.yardEndMinute,
          travelSeconds: 0,
          dwellSeconds: 0,
          source: 'template_bar',
        },
        {
          id: 'trip-1',
          timelineRow: 1,
          taskType: 'passenger',
          label: 'TN',
          routeId: 'route_tn',
          anchorStartMinute: args.departMinute,
          plannedStartMinute: args.departMinute,
          plannedEndMinute: args.departMinute + 5,
          travelSeconds: 300,
          dwellSeconds: 0,
          source: 'entry_service',
        },
      ],
    },
  ] as never as GeneratedSchedulePlan['timelines'];
}

function run(timelines: GeneratedSchedulePlan['timelines']) {
  return insertYardExitMoveCards({
    timelines,
    origins: ORIGINS,
    maintenanceBody: MAINTENANCE_BODY,
    selectedRoutes: SELECTED_ROUTES,
    sectionCodes: {
      charging: 'E',
      carWash: 'W',
      maintenance: 'M',
      preTrip: 'P',
      mobile: 'H',
    },
  });
}

describe('insertYardExitMoveCards', () => {
  it('卡片結束時刻貼齊下一段發車（零秒緩衝），且往前推出開始時刻', () => {
    // 保養 00:00–01:00，發車 01:10 → 有 10 分鐘空檔，M1 只要 30 秒
    const timelines = buildTimelines({
      yardStartMinute: 0,
      yardEndMinute: 60,
      departMinute: 70,
    });
    const result = run(timelines);

    assert.equal(result.inserted, 1);
    const card = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
    assert.ok(card);
    // 貼齊：結束 == 下一段發車
    assert.equal(card.plannedEndMinute, 70);
    // 往前推 30 秒
    assert.equal(card.plannedStartMinute, 70 - 0.5);
    assert.equal(card.travelSeconds, 30);
  });

  it('挑最快的那一台具體設施，並帶出設施代號', () => {
    const timelines = buildTimelines({
      yardStartMinute: 0,
      yardEndMinute: 60,
      departMinute: 70,
    });
    run(timelines);
    const card = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
    // M1(30s) 比 M2(60s) 快
    assert.equal(card?.yardExitFacilityLabel, 'M1');
    assert.equal(card?.yardExitFacilityNodeId, 'fac-m1');
    assert.equal(card?.yardExitStationId, 'station_4');
    assert.equal(card?.yardExitSectionCode, 'M');
  });

  it('下一段時間一律不動', () => {
    const timelines = buildTimelines({
      yardStartMinute: 0,
      yardEndMinute: 60,
      departMinute: 70,
    });
    run(timelines);
    const trip = timelines[0]!.blocks.find((b) => b.id === 'trip-1');
    assert.equal(trip?.plannedStartMinute, 70);
    assert.equal(trip?.plannedEndMinute, 75);
  });

  it('整備完零秒就要發車時，才吃整備尾巴（全系統唯一有此特權的卡）', () => {
    // 保養 00:00–01:10，發車也在 01:10 → 完全沒有空檔
    const timelines = buildTimelines({
      yardStartMinute: 0,
      yardEndMinute: 70,
      departMinute: 70,
    });
    const result = run(timelines);

    assert.equal(result.inserted, 1);
    assert.equal(result.ateYardTail, 1);
    const yard = timelines[0]!.blocks.find((b) => b.id === 'yard-1');
    const card = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
    // 整備結束被往前縮 30 秒，卡片接上去
    assert.equal(yard?.plannedEndMinute, 70 - 0.5);
    assert.equal(card?.plannedStartMinute, 70 - 0.5);
    assert.equal(card?.plannedEndMinute, 70);
    assert.equal(card?.yardExitAteYardTail, true);
  });

  it('同一台設施同一時刻不給兩列車用，用完就回報排不出來', () => {
    const timelines = buildTimelines({
      yardStartMinute: 0,
      yardEndMinute: 60,
      departMinute: 70,
    });
    // 第 2、3 列同時段保養：M1、M2 各一台，第 3 列就沒設施可用
    for (const row of [2, 3]) {
      const clone = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 60,
        departMinute: 70,
      })[0]!;
      clone.row = row;
      for (const block of clone.blocks) {
        block.timelineRow = row;
        block.id = `${block.id}-r${row}`;
      }
      timelines.push(clone);
    }

    const result = run(timelines);
    assert.equal(result.inserted, 2);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!.reason, /設施都被別列車佔著/);
  });

  it('拓樸沒有設施連到下一段起點站時，回報而不硬塞', () => {
    const timelines = buildTimelines({
      yardStartMinute: 0,
      yardEndMinute: 60,
      departMinute: 70,
    });
    const result = insertYardExitMoveCards({
      timelines,
      origins: ORIGINS,
      // 保養設施改成 W1：拓樸上 W1 沒有連到 station_4
      maintenanceBody: {
        maintenance: { stepEnabled: true, equipmentRows: [{ id: 'r', mapCode: 'W1' }] },
      },
      selectedRoutes: SELECTED_ROUTES,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!.reason, /都沒有連到 station_4/);
  });
});
