import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import { densifyRouteHeadwaysAfterBerth } from './densifyRouteHeadwaysAfterBerth';

function route(): ShiftScheduleSelectedRoute {
  return {
    instanceId: 'sel-tn',
    routeId: 'tn',
    routeName: 'TN',
    routeCode: 'TN',
    groupId: 'g',
    groupName: 'g',
    executionOrder: 1,
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 100,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationIds: ['T3U', 'P1'],
    stationDwells: [
      { stationId: 'T3U', stationName: 'T3', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'P1', stationName: 'P1', dwellSeconds: 40 },
    ],
    stationLegTravels: [
      {
        fromStationId: 'T3U',
        toStationId: 'P1',
        avgTravelTimeSeconds: 120,
        minTravelTimeSeconds: 100,
      },
    ],
    stationDwellsConfirmed: true,
    backupForInstanceId: null,
    backupForRouteId: null,
  } as ShiftScheduleSelectedRoute;
}

function block(
  partial: Partial<GeneratedScheduleBlock> & {
    id: string;
    timelineRow: number;
    plannedStartMinute: number;
    plannedEndMinute: number;
  },
): GeneratedScheduleBlock {
  return {
    taskType: 'passenger',
    label: '正線',
    source: 'template_bar',
    travelSeconds: 120,
    dwellSeconds: 40,
    anchorStartMinute: partial.plannedStartMinute,
    routeId: 'tn',
    routeInstanceId: 'sel-tn',
    routeCode: 'TN',
    routeName: 'TN',
    ...partial,
  };
}

describe('densifyRouteHeadwaysAfterBerth', () => {
  it('pulls a late same-route trip back toward peak headway when berth is free', () => {
    const tn = route();
    // 目標 180s，但第二班被推到 400s 之後
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'a',
            timelineRow: 1,
            plannedStartMinute: 8 * 60,
            plannedEndMinute: 8 * 60 + 3,
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'b',
            timelineRow: 2,
            plannedStartMinute: 8 * 60 + 400 / 60,
            plannedEndMinute: 8 * 60 + 400 / 60 + 3,
          }),
        ],
      },
    ];
    const densified = densifyRouteHeadwaysAfterBerth({
      timelines,
      selectedRoutes: [tn],
      intervals: [
        {
          id: 'peak',
          name: '尖峰',
          startTime: '07:00',
          endTime: '10:00',
          attributeId: 'pk',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'pk',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 180,
          capacityPphpd: 1400,
          isDraft: false,
        },
      ],
      minimumRecoveryTimeSeconds: 0,
    });
    const b = densified.flatMap((t) => t.blocks).find((x) => x.id === 'b')!;
    const a = densified.flatMap((t) => t.blocks).find((x) => x.id === 'a')!;
    const gapSeconds =
      (b.plannedStartMinute - a.plannedStartMinute) * 60;
    assert.ok(
      gapSeconds <= 200,
      `expected pull toward 180s headway, got gap=${gapSeconds}`,
    );
  });

  it('does not pull a trip into same-row 行檢 tail', () => {
    const tn = route();
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'a',
            timelineRow: 1,
            plannedStartMinute: 9 * 60 + 50,
            plannedEndMinute: 9 * 60 + 53,
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          {
            ...block({
              id: 'pre',
              timelineRow: 2,
              plannedStartMinute: 9 * 60 + 30,
              plannedEndMinute: 10 * 60,
            }),
            taskType: 'inspection' as const,
            label: '行檢',
            routeId: undefined,
            routeCode: undefined,
          },
          block({
            id: 'b',
            timelineRow: 2,
            plannedStartMinute: 10 * 60 + 5,
            plannedEndMinute: 10 * 60 + 8,
          }),
        ],
      },
    ];
    const densified = densifyRouteHeadwaysAfterBerth({
      timelines,
      selectedRoutes: [tn],
      intervals: [
        {
          id: 'peak',
          name: '尖峰',
          startTime: '07:00',
          endTime: '11:00',
          attributeId: 'pk',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'pk',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 180,
          capacityPphpd: 1400,
          isDraft: false,
        },
      ],
      minimumRecoveryTimeSeconds: 0,
    });
    const b = densified.flatMap((t) => t.blocks).find((x) => x.id === 'b')!;
    assert.ok(
      b.plannedStartMinute >= 10 * 60 - 1e-9,
      `must not steal 行檢 tail, got ${b.plannedStartMinute}`,
    );
  });

  it('never pulls a post-maintenance dispatch trip (entry_service) toward target headway', () => {
    const tn = route();
    // 第二班是整備後的調度營運班次，被排在 400s 之後（遠疏於 180s 目標）。
    // 但它的發車時刻是由「正線開始時刻往回推」決定的，不受班距約束（§10），
    // 不可以為了把班距拉回目標而往前拉。
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'a',
            timelineRow: 1,
            plannedStartMinute: 8 * 60,
            plannedEndMinute: 8 * 60 + 3,
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'dispatch',
            timelineRow: 2,
            source: 'entry_service',
            plannedStartMinute: 8 * 60 + 400 / 60,
            plannedEndMinute: 8 * 60 + 400 / 60 + 3,
          }),
        ],
      },
    ];
    const before = timelines[1]!.blocks[0]!.plannedStartMinute;
    const densified = densifyRouteHeadwaysAfterBerth({
      timelines,
      selectedRoutes: [tn],
      intervals: [
        {
          id: 'peak',
          name: '尖峰',
          startTime: '07:00',
          endTime: '10:00',
          attributeId: 'pk',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'pk',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 180,
          capacityPphpd: 1400,
          isDraft: false,
        },
      ],
      minimumRecoveryTimeSeconds: 0,
    });
    const d = densified.flatMap((t) => t.blocks).find((x) => x.id === 'dispatch')!;
    assert.equal(
      d.plannedStartMinute,
      before,
      'dispatch trip must not be pulled forward to satisfy headway',
    );
  });
});
