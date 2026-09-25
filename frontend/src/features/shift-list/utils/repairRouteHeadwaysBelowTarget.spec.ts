import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create.ts';
import type { GeneratedScheduleBlock } from './schedule-engine/types.ts';
import { repairRouteHeadwaysBelowTarget } from './repairRouteHeadwaysBelowTarget.ts';

function route(routeId = 'tn'): ShiftScheduleSelectedRoute {
  return {
    instanceId: routeId,
    routeId,
    routeName: 'TN',
    routeCode: 'TN',
    groupId: 'g',
    groupName: 'g',
    executionOrder: 1,
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 100,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationIds: ['A', 'B'],
    stationDwells: [
      { stationId: 'A', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'B', stationName: 'B', dwellSeconds: 20 },
    ],
    stationLegTravels: [
      {
        fromStationId: 'A',
        toStationId: 'B',
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
  id: string,
  row: number,
  startMin: number,
  routeId = 'tn',
): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: row,
    taskType: 'passenger',
    label: '正線',
    source: 'template_bar',
    plannedStartMinute: startMin,
    plannedEndMinute: startMin + 3,
    anchorStartMinute: startMin,
    travelSeconds: 120,
    dwellSeconds: 20,
    routeId,
    routeCode: 'TN',
    routeName: 'TN',
    routeInstanceId: routeId,
  };
}

describe('repairRouteHeadwaysBelowTarget', () => {
  it('pushes later same-route trip to meet target headway', () => {
    const tn = route();
    const timelines = [
      { row: 1, blocks: [block('a', 1, 10)] },
      { row: 2, blocks: [block('b', 2, 10 + 200 / 60)] }, // only 200s gap; target 400
    ];
    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn],
      intervals: [
        {
          id: 'i1',
          name: '尖峰',
          startTime: '00:00',
          endTime: '24:00',
          attributeId: 'attr',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'attr',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 400,
          capacityPphpd: 500,
        },
      ],
    });
    const later = repaired.flatMap((t) => t.blocks).find((b) => b.id === 'b')!;
    const earlier = repaired.flatMap((t) => t.blocks).find((b) => b.id === 'a')!;
    const gapSec = Math.round(
      (later.plannedStartMinute - earlier.plannedStartMinute) * 60,
    );
    assert.ok(gapSec >= 400 - 20, `expected ≥380s gap, got ${gapSec}`);
  });

  const attrs = (headwaySeconds: number) => ({
    intervals: [
      {
        id: 'i1',
        name: '尖峰',
        startTime: '00:00',
        endTime: '24:00',
        attributeId: 'attr',
        isDraft: false,
      },
    ],
    attributes: [
      { id: 'attr', name: '尖峰', color: '#f00', headwaySeconds, capacityPphpd: 500 },
    ],
  });

  it('partially pushes later trip up to the same-row next-vehicle ceiling instead of giving up entirely', () => {
    const tn = route('tn');
    const other = route('other');
    // earlier@0s, later@200s（缺 200s）；later 同列下一班（不同路線 other，非本組
    // 連環鬆綁對象）8min(=480s) 起頂住，只能推到 300s（400-180 佔用），推不到滿額
    // 400s，但仍應比原本 200s 更接近目標——且多輪迭代也鬆不開這道硬頂線。
    const timelines = [
      { row: 1, blocks: [block('a', 1, 0)] },
      {
        row: 2,
        blocks: [
          block('b', 2, 200 / 60),
          block('b-next', 2, 480 / 60, 'other'),
        ],
      },
    ];
    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn, other],
      ...attrs(400),
    });
    const blocks = repaired.flatMap((t) => t.blocks);
    const earlier = blocks.find((b) => b.id === 'a')!;
    const later = blocks.find((b) => b.id === 'b')!;
    const nextOnRow = blocks.find((b) => b.id === 'b-next')!;
    const gapSec = Math.round(
      (later.plannedStartMinute - earlier.plannedStartMinute) * 60,
    );
    assert.ok(
      gapSec > 200 && gapSec <= 300 + 1e-6,
      `expected partial push into (200, 300] range, got ${gapSec}`,
    );
    // 不可撞上同列下一班（含佔用）
    assert.ok(
      later.plannedEndMinute <= nextOnRow.plannedStartMinute + 1e-9,
      'must not overlap same-row next vehicle block',
    );
  });

  it('needs multiple rounds to unlock a same-route domino chain (single pass leaves it stuck)', () => {
    const tn = route('tn');
    // 同一路線、同一列（單車獨跑），A@0s、B@200s、C@410s，佔用皆 180s，目標 300s。
    // 單輪 forward sweep：B 想推到 300 卻被「還沒讓開」的 C（在 410）頂住，只能推到 230；
    // 同一輪內 C 隨後被推到 530（B 用舊位置 200 算出的 ideal）。
    // 第二輪重新排序後，B 的頂線改用 C「已經讓開」的新位置重算，才推得到滿額 300；
    // 這正是連環卡位（現場常見的 62 車擠一站）需要迭代收斂、單輪必然卡死的情境。
    const timelines = [
      {
        row: 1,
        blocks: [block('A', 1, 0), block('B', 1, 200 / 60), block('C', 1, 410 / 60)],
      },
    ];
    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn],
      ...attrs(300),
    });
    const blocks = repaired.flatMap((t) => t.blocks);
    const a = blocks.find((b) => b.id === 'A')!;
    const b = blocks.find((b) => b.id === 'B')!;
    const c = blocks.find((b) => b.id === 'C')!;
    const gapAB = Math.round((b.plannedStartMinute - a.plannedStartMinute) * 60);
    const gapBC = Math.round((c.plannedStartMinute - b.plannedStartMinute) * 60);
    assert.ok(
      gapAB >= 300 - 20,
      `expected multi-round to fully close A→B to ≥280s, got ${gapAB}s (single-pass would stop at 230s)`,
    );
    assert.ok(gapBC >= 300 - 20, `expected B→C ≥280s, got ${gapBC}s`);
  });

  it('never moves a post-maintenance dispatch trip (entry_service) to satisfy headway', () => {
    const tn = route('tn');
    // a@0s 與 dispatch@120s 只差 120s，遠低於 400s 目標。
    // 但 dispatch 是整備後的調度營運班次——它的任務是把車盡快送到正線起點站上工，
    // 發車時刻由正線開始時刻往回推算，不受班距約束（§10）。一秒都不該被挪動。
    const dispatch = { ...block('dispatch', 2, 120 / 60), source: 'entry_service' as const };
    const timelines = [
      { row: 1, blocks: [block('a', 1, 0)] },
      { row: 2, blocks: [dispatch] },
    ];
    const originalStart = dispatch.plannedStartMinute;
    const originalEnd = dispatch.plannedEndMinute;

    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn],
      ...attrs(400),
    });

    const after = repaired.flatMap((t) => t.blocks).find((b) => b.id === 'dispatch')!;
    assert.equal(
      after.plannedStartMinute,
      originalStart,
      'dispatch trip must not be pushed to satisfy headway',
    );
    assert.equal(after.plannedEndMinute, originalEnd);
  });

  it('pulls earlier trip backward using its own upstream slack to close the remaining deficit (Pass B)', () => {
    const tn = route();
    // predecessor@0s（與 earlier 相隔 1000s，遠超 400s 目標＝既有餘裕 600s）
    // earlier@1000s、later@1200s（缺 200s）；later 同列下一班在 1480s 頂住，
    // Pass A 只能把 later 推到 1300s（殘缺 100s），Pass B 應從 earlier 的既有餘裕借 100s 補足。
    const timelines = [
      { row: 1, blocks: [block('p', 1, 0)] },
      { row: 2, blocks: [block('a', 2, 1000 / 60)] },
      {
        row: 3,
        blocks: [
          block('b', 3, 1200 / 60),
          block('b-next', 3, 1480 / 60),
        ],
      },
    ];
    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn],
      ...attrs(400),
    });
    const blocks = repaired.flatMap((t) => t.blocks);
    const predecessor = blocks.find((b) => b.id === 'p')!;
    const earlier = blocks.find((b) => b.id === 'a')!;
    const later = blocks.find((b) => b.id === 'b')!;

    const finalGapSec = Math.round(
      (later.plannedStartMinute - earlier.plannedStartMinute) * 60,
    );
    assert.ok(
      finalGapSec >= 400 - 20,
      `expected Pass B to close remaining gap to ≥380s, got ${finalGapSec}`,
    );
    assert.ok(
      earlier.plannedStartMinute < 1000 / 60 - 1e-9,
      'expected earlier trip to be pulled backward by Pass B',
    );
    const upstreamGapSec = Math.round(
      (earlier.plannedStartMinute - predecessor.plannedStartMinute) * 60,
    );
    assert.ok(
      upstreamGapSec >= 400 - 20,
      `Pass B must not create new upstream deficit, got ${upstreamGapSec}s vs target 400s`,
    );
  });

  it('Pass B 不把同一台車拉進它自己前一件非正線任務（調度移動）還沒做完的時段', () => {
    const tn = route('tn');
    // p@0s（上游，離 a 1000s，遠超 400s 目標＝有 600s 既有餘裕，理論上 Pass B 可借）。
    // row2：a 前面緊接一張「調度移動」400s–490s，a@500s——車 490s 才做完調度移動，
    // 500s 這個發車時刻本身已經很勉強（只留 10s 恢復），不能再往前拉。
    // b@560s（缺 400-60=340s）；b 同列下一班 740s 頂住，Pass A 只推得到 530s，
    // 缺口交給 Pass B：若沒看到 a 前面的調度移動，Pass B 會借上游的 600s 餘裕把 a
    // 拉到 400s——落在調度移動 400s–490s 裡面，車根本不可能同時在調度又發車。
    const dispatch = {
      ...block('dispatch', 2, 400 / 60),
      taskType: 'dispatch' as const,
      source: 'transition' as const,
      routeId: undefined,
      routeCode: undefined,
      routeName: undefined,
      routeInstanceId: undefined,
      plannedEndMinute: 490 / 60,
    };
    const timelines = [
      { row: 1, blocks: [block('p', 1, 0)] },
      { row: 2, blocks: [dispatch, block('a', 2, 500 / 60)] },
      {
        row: 3,
        blocks: [
          block('b', 3, 560 / 60),
          block('b-next', 3, 740 / 60),
        ],
      },
    ];
    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn],
      minimumRecoveryTimeSeconds: 30,
      ...attrs(400),
    });
    const blocks = repaired.flatMap((t) => t.blocks);
    const a = blocks.find((b) => b.id === 'a')!;
    const dispatchAfter = blocks.find((b) => b.id === 'dispatch')!;

    assert.ok(
      dispatchAfter.plannedEndMinute * 60 <= a.plannedStartMinute * 60 + 1e-6,
      `a 不能早於它自己的調度移動做完：dispatch 到 ${dispatchAfter.plannedEndMinute * 60}s，`
      + `a 卻排在 ${a.plannedStartMinute * 60}s`,
    );
    assert.ok(
      a.plannedStartMinute * 60 >= 490 - 1e-6,
      `a 不該被 Pass B 拉進調度移動時段裡，實際排到 ${a.plannedStartMinute * 60}s`,
    );
  });

  it('Pass A 往後推發車前，也要驗延後造成來源站多待的那段——不能只驗到站那頭的窗', () => {
    const tn = route('tn');
    // b 用另一條路線（不同 routeId，起點同樣是 A，不受這條路線自己的班距處理影響，
    // 求解過程中不會被推走）在 250s 發車，卡在這段加長的停留裡。
    const other = route('other');
    // earlier@0s；a 前面 50s–100s 有一件任務把它送到起點站 A，本來 110s 就發車
    // （只在 A 待 10s）。目標班距 500s，要把 a 推到 500s 才夠——但這樣一來 a 會在
    // A 多待到 100s→500s，390 秒的空檔。b 250s 發車落在這段加長的停留裡：
    // a 若真的被推到 500s，兩台車 250s 前後都算「在 A」，這是
    // projectProtectedBerthWindowsSeconds 只看 a 自己起點窄窗量不出來的。
    const predecessor = {
      ...block('pred-a', 1, 50 / 60),
      taskType: 'dispatch' as const,
      source: 'transition' as const,
      routeId: undefined,
      routeCode: undefined,
      routeName: undefined,
      routeInstanceId: undefined,
      plannedEndMinute: 100 / 60,
    };
    const timelines = [
      { row: 1, blocks: [predecessor, block('a', 1, 110 / 60)] },
      { row: 2, blocks: [block('earlier', 2, 0)] },
      { row: 3, blocks: [block('b', 3, 250 / 60, 'other')] },
    ];
    const repaired = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: [tn, other],
      ...attrs(500),
    });
    const a = repaired.flatMap((t) => t.blocks).find((b) => b.id === 'a')!;
    assert.equal(
      a.plannedStartMinute,
      110 / 60,
      `a 延後會在來源站撞上 b，這次推不該成立，實際被推到 ${a.plannedStartMinute * 60}s`,
    );
  });
});
