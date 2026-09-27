import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
  collectFacilityOccupancies,
  findFacilityOccupancyCollisions,
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

  it('開啟時：前車跑完還滯留在站上等下一個任務，滯留期間後車進站是實體重疊', () => {
    // A 車 62:40 抵達完 P1，但下一個任務要到 66:00 才開始——車還停在 P1。
    // B 車 64:30 到 P1：離 A 車「跑完」有 110 秒，看似夠，
    // 但 A 車真正開走是 66:00：B 車 64:30–65:10 在站時 A 車還在，兩車同時在站位上。
    const timelines = twoCarsAtP1({
      laterArriveMinute: 64.5,
      earlierNextTaskStartMinute: 66,
    });
    const hits = p1Hits(timelines, 30);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'overlap', '看實際離站，不是靠站結束');
    assert.equal(Math.round(hits[0]!.overlapSeconds), 40);
    assert.equal(Math.round(hits[0]!.clearanceGapSeconds), -90, '間距以實際離站 66:00 起算');
    assert.equal(Math.round(hits[0]!.protectionShortfallSeconds), 150);
  });

  it('滯留是實體佔用：碰撞保護關閉也照樣算，只是不再加保護秒數', () => {
    const timelines = twoCarsAtP1({
      laterArriveMinute: 64.5,
      earlierNextTaskStartMinute: 66,
    });
    const hits = p1Hits(timelines);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'overlap');
    assert.equal(Math.round(hits[0]!.overlapSeconds), 40);
  });

  it('暫停卡寫著前車賴站到 10:10:30，後車 10:05:30 進站：實體重疊，不是保護不足', () => {
    // 2026-09-25 實錄：時間線 3 10:02:30 到站、10:10:30 才走；時間線 8 10:05:30 到同一站。
    const earlierArrive = 10 * 60 + 2.5;
    const timelines = [
      {
        row: 3,
        blocks: [
          block({
            id: 'a', timelineRow: 3,
            plannedStartMinute: earlierArrive - 2, plannedEndMinute: earlierArrive + 40 / 60,
          }),
          block({
            id: 'a-hold', timelineRow: 3, taskType: 'idle', source: 'hold',
            plannedStartMinute: earlierArrive + 40 / 60, plannedEndMinute: 10 * 60 + 10.5,
            yardFacilityStationId: 'P1',
          }),
        ],
      },
      {
        row: 8,
        blocks: [
          block({
            id: 'b', timelineRow: 8,
            plannedStartMinute: 10 * 60 + 5.5 - 2, plannedEndMinute: 10 * 60 + 5.5 + 40 / 60,
          }),
        ],
      },
    ];
    const hits = p1Hits(timelines, 30);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'overlap');
    assert.equal(Math.round(hits[0]!.overlapSeconds), 40);
    assert.equal(Math.round(hits[0]!.earlier.actualDepartMinute * 60), (10 * 60 + 10.5) * 60);
  });

  it('回報用的欄位帶的是班次卡起訖，不是幾秒的站位佔用窗', () => {
    // 2026-08-08 使用者回報：hover 顯示 11:08:20–11:08:30，但班次卡是
    // 11:04:40–11:08:20，兩個數字對不起來。原因是訊息拿站位佔用窗當班次時間用。
    // 佔用窗常常只有 10 秒（末站 minPresence），跟畫面上的班次卡本來就是兩回事。
    const timelines = twoCarsAtP1({ laterArriveMinute: 62 + 70 / 60 });
    const occs = collectStationBerthOccupancies(timelines, [tn], {
      collisionProtectionSeconds: 30,
    });
    const p1 = occs.find((occ) => occ.stationId === 'P1' && occ.blockId === 'a')!;
    // 站位佔用窗：62:00 到站、62:40 靠站結束
    assert.equal(Math.round(p1.startMinute * 60), 62 * 60);
    assert.equal(Math.round(p1.endMinute * 60), 62 * 60 + 40);
    // 班次卡起訖：60:00 發車、跑完 170 秒
    assert.equal(Math.round(p1.blockStartMinute * 60), 60 * 60);
    assert.equal(Math.round(p1.blockEndMinute * 60), 60 * 60 + 160);
    assert.notEqual(p1.blockStartMinute, p1.startMinute);
  });
});

describe('collectFacilityOccupancies：設施格佔用不依賴「暫停」卡是否已經補過', () => {
  function chargingBlock(
    partial: Partial<GeneratedScheduleBlock> & {
      id: string;
      timelineRow: number;
      plannedStartMinute: number;
      plannedEndMinute: number;
      yardFacilityNodeId: string;
    },
  ): GeneratedScheduleBlock {
    return {
      taskType: 'charging',
      label: '充電',
      source: 'template_bar',
      travelSeconds: 0,
      dwellSeconds: (partial.plannedEndMinute - partial.plannedStartMinute) * 60,
      anchorStartMinute: partial.plannedStartMinute,
      yardFacilityLabel: partial.yardFacilityNodeId,
      ...partial,
    } as GeneratedScheduleBlock;
  }

  it('整備結束但下一個任務（出場移動）晚很多才開始：沒補「暫停」卡也能分析出實際離開時刻', () => {
    const timelines = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 600, plannedEndMinute: 630,
            yardFacilityNodeId: 'E2',
          }),
          // 出場移動晚了 5 分鐘才排到——車還在 E2 裡面，格位仍算佔著
          block({
            id: 'exit', timelineRow: 1, taskType: 'dispatch', source: 'yard_exit_move',
            plannedStartMinute: 635, plannedEndMinute: 636,
            yardExitFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const [occ] = collectFacilityOccupancies(timelines);
    assert.equal(occ!.endMinute, 630, '自然結束時刻不變');
    assert.equal(occ!.actualDepartMinute, 635, '實際離開＝出場移動真的開始的時刻，不是充電自己的結束時刻');
  });

  it('同一個空檔，補過「暫停」卡之後答案完全一樣（卡只負責呈現，不是資料來源）', () => {
    const withoutHold = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 600, plannedEndMinute: 630,
            yardFacilityNodeId: 'E2',
          }),
          block({
            id: 'exit', timelineRow: 1, taskType: 'dispatch', source: 'yard_exit_move',
            plannedStartMinute: 635, plannedEndMinute: 636,
            yardExitFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const withHold = [
      {
        row: 1,
        blocks: [
          ...withoutHold[0]!.blocks,
          block({
            id: 'hold', timelineRow: 1, taskType: 'idle', source: 'hold',
            plannedStartMinute: 630, plannedEndMinute: 635,
            yardFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const before = collectFacilityOccupancies(withoutHold)[0]!;
    const after = collectFacilityOccupancies(withHold)[0]!;
    assert.equal(before.actualDepartMinute, after.actualDepartMinute);
  });

  it('緊接著就走（零秒空隙）：實際離開＝出場移動開始＝自然結束', () => {
    const timelines = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 600, plannedEndMinute: 630,
            yardFacilityNodeId: 'E2',
          }),
          block({
            id: 'exit', timelineRow: 1, taskType: 'dispatch', source: 'yard_exit_move',
            plannedStartMinute: 630, plannedEndMinute: 630.5,
            yardExitFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const [occ] = collectFacilityOccupancies(timelines);
    assert.equal(occ!.actualDepartMinute, 630);
  });

  it('60 秒以下的停留也算：整備到 10:00、出場移動 10:00:30 才開始，佔用算到 10:00:30', () => {
    // 先前走「空隙超過 60 秒才算滯留」的推論，這 30 秒在補暫停卡前完全看不見
    const exitStart = 600 + 0.5;
    const withoutHold = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 570, plannedEndMinute: 600,
            yardFacilityNodeId: 'E2',
          }),
          block({
            id: 'exit', timelineRow: 1, taskType: 'dispatch', source: 'yard_exit_move',
            plannedStartMinute: exitStart, plannedEndMinute: exitStart + 1,
            yardExitFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const withHold = [
      {
        row: 1,
        blocks: [
          ...withoutHold[0]!.blocks,
          block({
            id: 'hold', timelineRow: 1, taskType: 'idle', source: 'hold',
            plannedStartMinute: 600, plannedEndMinute: exitStart,
            yardFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const before = collectFacilityOccupancies(withoutHold);
    const after = collectFacilityOccupancies(withHold);
    assert.equal(before.length, 1);
    assert.equal(after.length, 1);
    assert.equal(before[0]!.actualDepartMinute, exitStart);
    assert.equal(after[0]!.actualDepartMinute, exitStart);
    assert.deepEqual(after[0]!.blockIds.sort(), ['chg', 'hold']);
  });

  it('下一張不是移動卡（缺必要移動）：不假設車已開走，佔用延續到那張卡開始', () => {
    const timelines = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 600, plannedEndMinute: 630,
            yardFacilityNodeId: 'E2',
          }),
          block({ id: 'pax', timelineRow: 1, plannedStartMinute: 640, plannedEndMinute: 643 }),
        ],
      },
    ];
    const [occ] = collectFacilityOccupancies(timelines);
    assert.equal(occ!.actualDepartMinute, 640);
  });

  it('「暫停」卡本身不獨立算一筆佔用，避免跟它延伸的那張整備卡重複計算', () => {
    const timelines = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 600, plannedEndMinute: 630,
            yardFacilityNodeId: 'E2',
          }),
          block({
            id: 'hold', timelineRow: 1, taskType: 'idle', source: 'hold',
            plannedStartMinute: 630, plannedEndMinute: 635,
            yardFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const occs = collectFacilityOccupancies(timelines);
    assert.equal(occs.length, 1);
    assert.equal(occs[0]!.blockId, 'chg');
  });

  it('讓站／提早進廠插的臨時停格（idle, transition）有明確格位就算佔用', () => {
    const timelines = [
      {
        row: 7,
        blocks: [
          block({
            id: 'in', timelineRow: 7, taskType: 'dispatch', source: 'yard_entry_move',
            plannedStartMinute: 1426 + 20 / 60, plannedEndMinute: 1426 + 50 / 60,
          }),
          block({
            id: 'park', timelineRow: 7, taskType: 'idle', source: 'transition',
            plannedStartMinute: 1426 + 50 / 60, plannedEndMinute: 1440 + 1 / 60,
            yardFacilityNodeId: 'W1',
          }),
          block({
            id: 'hop', timelineRow: 7, taskType: 'dispatch', source: 'yard_entry_move',
            plannedStartMinute: 1440 + 1 / 60, plannedEndMinute: 1440 + 1 / 60,
          }),
          chargingBlock({
            id: 'chg', timelineRow: 7, plannedStartMinute: 1440 + 1 / 60, plannedEndMinute: 1530,
            yardFacilityNodeId: 'E2',
          }),
        ],
      },
    ];
    const occs = collectFacilityOccupancies(timelines);
    const w1 = occs.find((occ) => occ.facilityNodeId === 'W1');
    assert.ok(w1, 'W1 臨時停格不能漏掉');
    assert.equal(w1!.blockId, 'park');
    assert.equal(w1!.actualDepartMinute, 1440 + 1 / 60);
    assert.ok(occs.some((occ) => occ.facilityNodeId === 'E2'));
  });

  it('同車同格連續停留合併成一段；換格才結束', () => {
    const timelines = [
      {
        row: 1,
        blocks: [
          chargingBlock({
            id: 'chg', timelineRow: 1, plannedStartMinute: 600, plannedEndMinute: 630,
            yardFacilityNodeId: 'E2',
          }),
          chargingBlock({
            id: 'stby', timelineRow: 1, taskType: 'standby', plannedStartMinute: 640, plannedEndMinute: 700,
            yardFacilityNodeId: 'E2',
          }),
          block({
            id: 'move', timelineRow: 1, taskType: 'dispatch', source: 'yard_exit_move',
            plannedStartMinute: 710, plannedEndMinute: 711, yardExitFacilityNodeId: 'E2',
          }),
          chargingBlock({
            id: 'other', timelineRow: 1, plannedStartMinute: 711, plannedEndMinute: 750,
            yardFacilityNodeId: 'E3',
          }),
        ],
      },
    ];
    const occs = collectFacilityOccupancies(timelines);
    assert.equal(occs.length, 2);
    const e2 = occs.find((occ) => occ.facilityNodeId === 'E2')!;
    assert.deepEqual(e2.blockIds, ['chg', 'stby']);
    assert.equal(e2.startMinute, 600);
    assert.equal(e2.endMinute, 700);
    assert.equal(e2.actualDepartMinute, 710);
  });
});

describe('findFacilityOccupancyCollisions：重疊記錯誤、交接不足記警告，跨午夜安全', () => {
  function occ(partial: Partial<{
    facilityNodeId: string; facilityLabel: string; timelineRow: number; blockId: string;
    label: string; startMinute: number; endMinute: number; actualDepartMinute: number;
  }> & { timelineRow: number; blockId: string; startMinute: number; actualDepartMinute: number }) {
    return {
      facilityNodeId: 'E2',
      facilityLabel: 'E2',
      label: '充電',
      endMinute: partial.actualDepartMinute,
      blockIds: [partial.blockId],
      ...partial,
    };
  }

  it('兩車真的同時佔格：硬錯誤等級的重疊', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 1, blockId: 'a', startMinute: 600, actualDepartMinute: 630 }),
        occ({ timelineRow: 2, blockId: 'b', startMinute: 620, actualDepartMinute: 650 }),
      ],
      30,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'overlap');
    assert.equal(Math.round(hits[0]!.overlapSeconds), 600); // 10 分鐘重疊
  });

  it('沒有重疊、但交接秒數不夠：只是警告等級的保護不足', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 1, blockId: 'a', startMinute: 600, actualDepartMinute: 630 }),
        // 630:00 離開、630:01 進來——沒重疊，但離 2×30=60 秒的保護差很多
        occ({ timelineRow: 2, blockId: 'b', startMinute: 630 + 1 / 60, actualDepartMinute: 660 }),
      ],
      30,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'protection_gap');
  });

  it('交接秒數夠：什麼都不回報', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 1, blockId: 'a', startMinute: 600, actualDepartMinute: 630 }),
        occ({ timelineRow: 2, blockId: 'b', startMinute: 631, actualDepartMinute: 660 }),
      ],
      30,
    );
    assert.equal(hits.length, 0);
  });

  it('同一列自己的連續停留不算衝突', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 1, blockId: 'a', startMinute: 600, actualDepartMinute: 630 }),
        occ({ timelineRow: 1, blockId: 'b', startMinute: 630, actualDepartMinute: 660 }),
      ],
      30,
    );
    assert.equal(hits.length, 0);
  });

  it('跨午夜：兩段直接比較 start／end 數字看不出重疊，但鐘面上其實疊在一起', () => {
    // A：23:50–00:10（延續到隔天，內部記 1430–1450）
    // B：00:05–00:15（記法沒有延伸，就是 5–15）
    // 直接比大小：max(1430,5)=1430 不小於 min(1450,15)=15 → 判定不重疊（誤判）
    // 鐘面攤開來看：A 在隔天 00:00–00:10 那一段，跟 B 的 00:05–00:15 其實疊了 5 分鐘
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 1, blockId: 'a', startMinute: 1430, actualDepartMinute: 1450 }),
        occ({ timelineRow: 2, blockId: 'b', startMinute: 5, actualDepartMinute: 15 }),
      ],
      0,
    );
    assert.equal(hits.length, 1, '跨午夜的重疊不能被直接比大小漏掉');
    assert.equal(hits[0]!.kind, 'overlap');
    assert.equal(Math.round(hits[0]!.overlapSeconds), 5 * 60);
  });

  it('跨午夜交接：A 23:59:30 離格、B 00:00:00 進格，只隔 30 秒要回報，前後車順序正確', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        // B 記在鐘面上，排序時反而在前面
        occ({ timelineRow: 2, blockId: 'b', startMinute: 0, actualDepartMinute: 90 }),
        occ({ timelineRow: 1, blockId: 'a', startMinute: 1380, actualDepartMinute: 1439.5 }),
      ],
      30,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'protection_gap');
    assert.equal(Math.round(hits[0]!.gapSeconds), 30);
    assert.equal(hits[0]!.earlier.blockId, 'a', '先離開的是 A');
    assert.equal(hits[0]!.later.blockId, 'b');
  });

  it('跨午夜交接：延續記法（1440+）也一樣量得到', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 4, blockId: 'a', startMinute: 1332, actualDepartMinute: 1440 }),
        occ({ timelineRow: 7, blockId: 'b', startMinute: 1440 + 1 / 60, actualDepartMinute: 1530 }),
      ],
      30,
    );
    assert.equal(hits.length, 1);
    assert.equal(Math.round(hits[0]!.gapSeconds), 1);
    assert.equal(hits[0]!.earlier.blockId, 'a');
  });

  it('跨午夜但交接夠久：不回報', () => {
    const hits = findFacilityOccupancyCollisions(
      [
        occ({ timelineRow: 2, blockId: 'b', startMinute: 1, actualDepartMinute: 90 }),
        occ({ timelineRow: 1, blockId: 'a', startMinute: 1380, actualDepartMinute: 1439.5 }),
      ],
      30,
    );
    assert.equal(hits.length, 0);
  });
});
