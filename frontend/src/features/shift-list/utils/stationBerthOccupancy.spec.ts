import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
} from './stationBerthOccupancy';

function route(partial: Partial<ShiftScheduleSelectedRoute> & {
  routeId: string;
  routeCode: string;
}): ShiftScheduleSelectedRoute {
  return {
    instanceId: partial.instanceId ?? partial.routeId,
    routeId: partial.routeId,
    routeName: partial.routeName ?? partial.routeCode,
    routeCode: partial.routeCode,
    groupName: 'g',
    executionOrder: partial.executionOrder ?? 1,
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 100,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationIds: partial.stationIds ?? ['T3', 'P1'],
    stationDwells: partial.stationDwells ?? [
      { stationId: 'T3', stationName: 'T3', dwellSeconds: 0 },
      { stationId: 'P1', stationName: 'P1停靠點', dwellSeconds: 40 },
    ],
    stationLegTravels: partial.stationLegTravels ?? [
      {
        fromStationId: 'T3',
        toStationId: 'P1',
        avgTravelTimeSeconds: 120,
        minTravelTimeSeconds: 100,
      },
    ],
    stationDwellsConfirmed: true,
    backupForInstanceId: null,
    backupForRouteId: null,
    ...partial,
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
    routeId: partial.routeId ?? 'tn',
    routeCode: partial.routeCode ?? 'TN',
    routeName: 'TN',
    ...partial,
  } as GeneratedScheduleBlock;
}

describe('stationBerthOccupancy', () => {
  it('flags overlapping natural dwell windows at the same berth', () => {
    const tn = route({ routeId: 'tn', routeCode: 'TN' });
    // 兩車幾乎同時到 P1 且靠站中重疊（到站～離站）
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'a',
            timelineRow: 1,
            plannedStartMinute: 60,
            plannedEndMinute: 63,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'b',
            timelineRow: 2,
            plannedStartMinute: 60.25,
            plannedEndMinute: 63.25,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
    ];

    const hits = findStationBerthCollisions(
      collectStationBerthOccupancies(timelines, [tn]),
      [tn],
    );
    assert.ok(
      hits.some((h) => h.stationName.includes('P1') && h.overlapSeconds > 0),
      'must detect overlapping P1 dwell',
    );
  });

  it('does not treat post-trip charging as terminal berth occupancy', () => {
    const tn = route({
      routeId: 'tn',
      routeCode: 'TN',
      stationDwells: [
        { stationId: 'T3', stationName: 'T3', dwellSeconds: 0 },
        { stationId: 'P1', stationName: 'P1停靠點', dwellSeconds: 0 },
      ],
    });
    const timelines = [
      {
        row: 9,
        blocks: [
          block({
            id: 'a',
            timelineRow: 9,
            plannedStartMinute: 51.5,
            plannedEndMinute: 55 + 10 / 60,
            routeId: 'tn',
            routeCode: 'TN',
            dwellSeconds: 0,
          }),
          {
            id: 'chg-a',
            timelineRow: 9,
            taskType: 'charging' as const,
            label: '充電',
            source: 'template_bar' as const,
            plannedStartMinute: 55 + 10 / 60,
            plannedEndMinute: 120,
            travelSeconds: 0,
            dwellSeconds: 0,
            anchorStartMinute: 55 + 10 / 60,
          },
        ],
      },
      {
        row: 10,
        blocks: [
          block({
            id: 'b',
            timelineRow: 10,
            plannedStartMinute: 61.5,
            plannedEndMinute: 65 + 10 / 60,
            routeId: 'tn',
            routeCode: 'TN',
            dwellSeconds: 0,
          }),
          {
            id: 'chg-b',
            timelineRow: 10,
            taskType: 'charging' as const,
            label: '充電',
            source: 'template_bar' as const,
            plannedStartMinute: 65 + 10 / 60,
            plannedEndMinute: 120,
            travelSeconds: 0,
            dwellSeconds: 0,
            anchorStartMinute: 65 + 10 / 60,
          },
        ],
      },
    ];
    const hits = findStationBerthCollisions(
      collectStationBerthOccupancies(timelines, [tn]),
      [tn],
    );
    assert.equal(
      hits.filter((h) => h.stationName.includes('P1')).length,
      0,
      'charging after trip must not invent P1 hold',
    );
  });

  it('allows staggered tip use when dwell windows do not overlap', () => {
    const tn = route({ routeId: 'tn', routeCode: 'TN' });
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'tn1',
            timelineRow: 1,
            plannedStartMinute: 60,
            plannedEndMinute: 63,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'tn2',
            timelineRow: 2,
            plannedStartMinute: 70,
            plannedEndMinute: 73,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
    ];
    const hits = findStationBerthCollisions(
      collectStationBerthOccupancies(timelines, [tn]),
      [tn],
    );
    assert.equal(
      hits.filter((h) => h.stationName.includes('P1')).length,
      0,
    );
  });
});
