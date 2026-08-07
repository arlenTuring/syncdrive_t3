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

describe('碰撞保護時間', () => {
  const tn = route({ routeId: 'tn', routeCode: 'TN' });

  /**
   * 路線 T3（不停靠）→ P1（停 40 秒），行駛 120 秒。
   * A 車 60:00 發車，62:00 到 P1，62:40 離開 P1。
   * B 車的 P1 到站時刻由 arriveMinute 決定（發車 = 到站 − 2 分鐘行駛）。
   */
  function twoCarsAtP1(args: {
    laterArriveMinute: number;
    /** A 車在 P1 之後排的下一個任務（充電）開始分鐘；不給就沒有下一個任務 */
    earlierNextTaskStartMinute?: number;
  }) {
    const earlierBlocks: GeneratedScheduleBlock[] = [
      block({
        id: 'a',
        timelineRow: 1,
        plannedStartMinute: 60,
        plannedEndMinute: 60 + 160 / 60,
        routeId: 'tn',
        routeCode: 'TN',
      }),
    ];
    if (args.earlierNextTaskStartMinute != null) {
      earlierBlocks.push({
        id: 'a-next',
        timelineRow: 1,
        taskType: 'charging',
        label: '充電',
        source: 'template_bar',
        plannedStartMinute: args.earlierNextTaskStartMinute,
        plannedEndMinute: args.earlierNextTaskStartMinute + 30,
        anchorStartMinute: args.earlierNextTaskStartMinute,
        travelSeconds: 0,
        dwellSeconds: 0,
      } as GeneratedScheduleBlock);
    }
    return [
      { row: 1, blocks: earlierBlocks },
      {
        row: 2,
        blocks: [
          block({
            id: 'b',
            timelineRow: 2,
            plannedStartMinute: args.laterArriveMinute - 2,
            plannedEndMinute: args.laterArriveMinute - 2 + 160 / 60,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
    ];
  }

  function p1Hits(
    timelines: ReturnType<typeof twoCarsAtP1>,
    collisionProtectionSeconds?: number,
  ) {
    return findStationBerthCollisions(
      collectStationBerthOccupancies(
        timelines,
        [tn],
        collisionProtectionSeconds != null ? { collisionProtectionSeconds } : null,
      ),
      [tn],
    ).filter((hit) => hit.stationId === 'P1');
  }

  it('關閉時：後車貼著前車離站 30 秒進站不算碰撞', () => {
    // A 車 62:40 離開 P1，B 車 63:10 到 P1——只差 30 秒，但區間沒重疊
    const timelines = twoCarsAtP1({ laterArriveMinute: 62 + 70 / 60 });
    assert.equal(p1Hits(timelines).length, 0);
  });

  it('開啟時：同一情境要求 2×30＝60 秒，只有 30 秒就回報保護不足', () => {
    const timelines = twoCarsAtP1({ laterArriveMinute: 62 + 70 / 60 });
    const hits = p1Hits(timelines, 30);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'protection_gap');
    assert.equal(hits[0]!.overlapSeconds, 0, '區間沒重疊，不是實體碰撞');
    assert.equal(Math.round(hits[0]!.protectionShortfallSeconds), 30);
  });

  it('開啟時：間隔已達 60 秒就不回報', () => {
    // B 車 63:40 到 P1，距 A 車 62:40 離站整整 60 秒
    const timelines = twoCarsAtP1({ laterArriveMinute: 63 + 40 / 60 });
    assert.equal(p1Hits(timelines, 30).length, 0);
  });

  it('開啟時：前車跑完還滯留在站上等下一個任務，滯留期間都算佔用', () => {
    // A 車 62:40 抵達完 P1，但下一個任務要到 66:00 才開始——車還停在 P1。
    // B 車 64:30 到 P1：離 A 車「跑完」有 110 秒，看似夠，
    // 但 A 車真正開走是 66:00，加保護後要 67:00 才輪得到 B 車。
    const timelines = twoCarsAtP1({
      laterArriveMinute: 64.5,
      earlierNextTaskStartMinute: 66,
    });
    const hits = p1Hits(timelines, 30);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'protection_gap');
    assert.equal(Math.round(hits[0]!.protectionShortfallSeconds), 150);
  });

  it('滯留佔用屬於防碰撞判定的一部分：碰撞保護關閉時同樣不檢查', () => {
    const timelines = twoCarsAtP1({
      laterArriveMinute: 64.5,
      earlierNextTaskStartMinute: 66,
    });
    assert.equal(p1Hits(timelines).length, 0);
  });
});
