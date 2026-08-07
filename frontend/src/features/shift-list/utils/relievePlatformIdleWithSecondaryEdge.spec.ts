import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';
import { ROUTE_SUCCESSOR_ALGORITHM_GRAPH } from './schedule-engine/routeSuccessorPolicy';
import type { RouteSuccessorPolicy } from './schedule-engine/routeSuccessorPolicy';
import { relievePlatformIdleWithSecondaryEdge } from './relievePlatformIdleWithSecondaryEdge';

function route(partial: Partial<ShiftScheduleSelectedRoute> & {
  routeId: string;
  routeCode: string;
  stationIds: string[];
}): ShiftScheduleSelectedRoute {
  return {
    instanceId: partial.instanceId ?? partial.routeId,
    routeName: partial.routeName ?? partial.routeCode,
    groupId: 'g',
    groupName: 'g',
    executionOrder: partial.executionOrder ?? 1,
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 100,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationDwells: partial.stationIds.map((stationId, index) => ({
      stationId,
      stationName: stationId,
      dwellSeconds: index === 0 ? 0 : 30,
    })),
    stationLegTravels: [],
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
    dwellSeconds: 30,
    anchorStartMinute: partial.plannedStartMinute,
    routeId: partial.routeId ?? 'a',
    routeCode: partial.routeCode ?? 'A',
    routeName: 'A',
    routeInstanceId: partial.routeInstanceId ?? partial.routeId ?? 'a',
    ...partial,
  } as GeneratedScheduleBlock;
}

/** 路線 A：X→T3（車跑完一輪，最後停在 T3） */
const routeA = route({ routeId: 'a', routeCode: 'A', stationIds: ['X', 'T3'] });
/** 路線 A-next：T3→Z（下一個脈衝排定的下一段，起點正是 T3） */
const routeANext = route({ routeId: 'a-next', routeCode: 'ANEXT', stationIds: ['T3', 'Z'] });
/** 路線 LOOP：T3→Y→T3，繞一圈又回到 T3——次要邊，終點正好等於 A-next 的起點站 */
const routeLoop = route({
  routeId: 'loop',
  routeCode: 'LOOP',
  stationIds: ['T3', 'Y', 'T3'],
  avgTravelTimeSeconds: 60,
  minTravelTimeSeconds: 50,
});
/** 路線 LOOP-LONG：跟 LOOP 一樣繞回 T3，但太久，塞不進空等區間 */
const routeLoopLong = route({
  routeId: 'loop-long',
  routeCode: 'LOOPLONG',
  stationIds: ['T3', 'W', 'T3'],
  avgTravelTimeSeconds: 900,
  minTravelTimeSeconds: 850,
});
/** 路線 LOOP-ELSEWHERE：次要邊存在，但終點不是 T3，接不回下一段 */
const routeLoopElsewhere = route({
  routeId: 'loop-elsewhere',
  routeCode: 'LOOPELSEWHERE',
  stationIds: ['T3', 'V'],
  avgTravelTimeSeconds: 60,
  minTravelTimeSeconds: 50,
});
/** 另一列在 T3 撞上 earlierBlock 空等期間的車 */
const routeOther = route({ routeId: 'other', routeCode: 'OTHER', stationIds: ['U', 'T3'] });

/** 兩跳繞法（使用者實際的備用路線形狀）：T3 → 備用站，再 備用站 → T3 */
const routeOutLeg = route({
  routeId: 'out-leg',
  routeCode: 'OUTLEG',
  stationIds: ['T3', 'BACKUP'],
  avgTravelTimeSeconds: 60,
  minTravelTimeSeconds: 50,
});
const routeBackLeg = route({
  routeId: 'back-leg',
  routeCode: 'BACKLEG',
  stationIds: ['BACKUP', 'T3'],
  avgTravelTimeSeconds: 60,
  minTravelTimeSeconds: 50,
});
/**
 * 終點對（回到 T3），但<strong>起點不是車現在停的地方</strong>——
 * 車停在 T3，這條卻要從 ELSEWHERE 發車，車根本開不過去。
 */
const routeWrongOrigin = route({
  routeId: 'wrong-origin',
  routeCode: 'WRONGORIGIN',
  stationIds: ['ELSEWHERE', 'T3'],
  avgTravelTimeSeconds: 60,
  minTravelTimeSeconds: 50,
});
/** 兩跳但回程太久，塞不進空等區間 */
const routeBackLegLong = route({
  routeId: 'back-leg-long',
  routeCode: 'BACKLEGLONG',
  stationIds: ['BACKUP', 'T3'],
  avgTravelTimeSeconds: 900,
  minTravelTimeSeconds: 850,
});

function successorPolicy(secondary: Map<string, string[]>): RouteSuccessorPolicy {
  return {
    algorithm: ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
    valid: true,
    routesByInstanceId: new Map([
      ['a', routeA],
      ['a-next', routeANext],
      ['loop', routeLoop],
      ['loop-long', routeLoopLong],
      ['loop-elsewhere', routeLoopElsewhere],
      ['other', routeOther],
      ['out-leg', routeOutLeg],
      ['back-leg', routeBackLeg],
      ['back-leg-long', routeBackLegLong],
      ['wrong-origin', routeWrongOrigin],
    ]),
    rotationRoutes: [routeA, routeANext],
    prioritySuccessors: new Map([['a', ['a-next']]]),
    secondarySuccessors: secondary,
    startInstanceIds: ['a'],
    endInstanceIds: new Set(['a-next']),
    canonicalCycleInstanceIds: ['a', 'a-next'],
    throughCycles: [],
  };
}

/**
 * row1：A（X→T3，60:00 出發，到 T3 後很快靠站結束）跑完後，
 * 排定的下一段 A-next（T3→Z）要等到 70:00 才發車——中間空等 10 分鐘。
 * row2：另一台車 Other（U→T3）在這段空等期間到了 T3，兩者撞上。
 */
function idleCollisionTimelines(): GeneratedScheduleTimeline[] {
  return [
    {
      row: 1,
      blocks: [
        block({
          id: 'a-in',
          timelineRow: 1,
          plannedStartMinute: 60,
          plannedEndMinute: 60 + 170 / 60,
          routeId: 'a',
          routeCode: 'A',
          routeInstanceId: 'a',
        }),
        block({
          id: 'a-next',
          timelineRow: 1,
          plannedStartMinute: 70,
          plannedEndMinute: 70 + 170 / 60,
          routeId: 'a-next',
          routeCode: 'ANEXT',
          routeInstanceId: 'a-next',
        }),
      ],
    },
    {
      row: 2,
      blocks: [
        block({
          id: 'other-in',
          timelineRow: 2,
          plannedStartMinute: 65,
          plannedEndMinute: 65 + 170 / 60,
          routeId: 'other',
          routeCode: 'OTHER',
          routeInstanceId: 'other',
        }),
      ],
    },
  ];
}

describe('relievePlatformIdleWithSecondaryEdge', () => {
  it('有次要邊迴圈、時間塞得下、終點接得回下一段起點站 → 插入站位讓渡', () => {
    const warnings: never[] = [];
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: idleCollisionTimelines(),
      selectedRoutes: [routeA, routeANext, routeLoop, routeOther],
      successorPolicy: successorPolicy(new Map([['a', ['loop']]])),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: warnings as never,
    });

    const row1 = result.find((t) => t.row === 1)!;
    const relief = row1.blocks.find((b) => b.source === 'relief_loop');
    assert.ok(relief, '應該插入 relief_loop 區塊');
    assert.equal(relief!.routeId, 'loop');
    // 讓渡必須夾在 A 結束與 A-next 開始之間，不得咬到任何一段
    assert.ok(relief!.plannedStartMinute >= 60 + 170 / 60 - 1e-9);
    assert.ok(relief!.plannedEndMinute <= 70 + 1e-6);
    assert.equal(warnings.length, 1);
    assert.equal((warnings[0] as { code: string }).code, 'STATION_BERTH_RELIEF_INSERTED');
  });

  it('沒有次要邊 → 不插入，時間線原樣不變', () => {
    const timelines = idleCollisionTimelines();
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines,
      selectedRoutes: [routeA, routeANext, routeOther],
      successorPolicy: successorPolicy(new Map()),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(row1.blocks.length, 2);
    assert.equal(row1.blocks.some((b) => b.source === 'relief_loop'), false);
  });

  it('次要邊終點不是下一段起點站 → 不插入', () => {
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: idleCollisionTimelines(),
      selectedRoutes: [routeA, routeANext, routeLoopElsewhere, routeOther],
      successorPolicy: successorPolicy(new Map([['a', ['loop-elsewhere']]])),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(row1.blocks.some((b) => b.source === 'relief_loop'), false);
  });

  it('次要邊終點對，但繞一圈太久塞不進空等區間 → 不插入', () => {
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: idleCollisionTimelines(),
      selectedRoutes: [routeA, routeANext, routeLoopLong, routeOther],
      successorPolicy: successorPolicy(new Map([['a', ['loop-long']]])),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(row1.blocks.some((b) => b.source === 'relief_loop'), false);
  });

  it('碰撞保護時間為 0（整組關閉）→ 直接不處理，回傳原時間線', () => {
    const timelines = idleCollisionTimelines();
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines,
      selectedRoutes: [routeA, routeANext, routeLoop, routeOther],
      successorPolicy: successorPolicy(new Map([['a', ['loop']]])),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 0,
      warnings: [],
    });
    assert.equal(result, timelines);
  });

  it('沒有 successorPolicy（或無效）→ 直接不處理，回傳原時間線', () => {
    const timelines = idleCollisionTimelines();
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines,
      selectedRoutes: [routeA, routeANext, routeLoop, routeOther],
      successorPolicy: null,
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    assert.equal(result, timelines);
  });

  it('沒有真的滯留（同列緊接著就是下一段）→ 不插入，即使有現成次要邊', () => {
    const timelines: GeneratedScheduleTimeline[] = [
      {
        row: 1,
        blocks: [
          block({
            id: 'a-in',
            timelineRow: 1,
            plannedStartMinute: 60,
            plannedEndMinute: 60 + 170 / 60,
            routeId: 'a',
            routeCode: 'A',
            routeInstanceId: 'a',
          }),
          block({
            id: 'a-next',
            timelineRow: 1,
            // 緊接著發車（換線間隔內），不是滯留
            plannedStartMinute: 60 + 170 / 60 + 30 / 60,
            plannedEndMinute: 60 + 340 / 60,
            routeId: 'a-next',
            routeCode: 'ANEXT',
            routeInstanceId: 'a-next',
          }),
        ],
      },
    ];
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines,
      selectedRoutes: [routeA, routeANext, routeLoop],
      successorPolicy: successorPolicy(new Map([['a', ['loop']]])),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(row1.blocks.some((b) => b.source === 'relief_loop'), false);
  });
  it('兩跳繞法：T3 出去到備用站再繞回 T3，兩段都插入', () => {
    const warnings: never[] = [];
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: idleCollisionTimelines(),
      selectedRoutes: [routeA, routeANext, routeOutLeg, routeBackLeg, routeOther],
      successorPolicy: successorPolicy(
        new Map([
          ['a', ['out-leg']],
          ['out-leg', ['back-leg']],
        ]),
      ),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: warnings as never,
    });

    const row1 = result.find((t) => t.row === 1)!;
    const relief = row1.blocks
      .filter((b) => b.source === 'relief_loop')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.equal(relief.length, 2, '兩跳都要插入');
    assert.deepEqual(relief.map((b) => b.routeId), ['out-leg', 'back-leg']);
    // 整條路徑必須夾在 A 結束與 A-next 開始之間
    assert.ok(relief[0]!.plannedStartMinute >= 60 + 170 / 60 - 1e-9);
    assert.ok(relief[1]!.plannedEndMinute <= 70 + 1e-6);
    // 兩跳之間不得重疊
    assert.ok(relief[1]!.plannedStartMinute >= relief[0]!.plannedEndMinute - 1e-9);
    assert.equal(warnings.length, 1);
    assert.equal(
      (warnings[0] as { detail: { reliefHopCount: number } }).detail.reliefHopCount,
      2,
    );
  });

  it('兩跳但回程太久塞不進空等 → 整條放棄，不留半條在版面上', () => {
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: idleCollisionTimelines(),
      selectedRoutes: [routeA, routeANext, routeOutLeg, routeBackLegLong, routeOther],
      successorPolicy: successorPolicy(
        new Map([
          ['a', ['out-leg']],
          ['out-leg', ['back-leg-long']],
        ]),
      ),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(
      row1.blocks.some((b) => b.source === 'relief_loop'),
      false,
      '第一跳也不可以留下',
    );
  });

  it('次要邊終點對，但起點不是車現在停的站 → 不插入（車開不過去）', () => {
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: idleCollisionTimelines(),
      selectedRoutes: [routeA, routeANext, routeWrongOrigin, routeOther],
      successorPolicy: successorPolicy(new Map([['a', ['wrong-origin']]])),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(row1.blocks.some((b) => b.source === 'relief_loop'), false);
  });
});

/**
 * 使用者實際的關聯圖形狀（2026-08-08）：主線與備用是<strong>成對的替身</strong>，
 * 停不同的站位，而不是「繞出去再繞回來」。
 *
 *   ST ─優→ TN（終點 N2W下行出發）─優→ NT（起點 N2W下行出發）─優→ TS
 *   ST ─次→ TNB（終點 備用N2W）───優→ NTB（起點 備用N2W）───優→ TS
 *
 * 車跑完 TN 停在 N2W下行出發、等著跑 NT 從那裡出發，這段空等擋住別台車時，
 * 正解是整對換成 TNB→NTB 停到備用站位，時刻完全不動。
 */
describe('滯留改停備用站位（成對替身）', () => {
  const st = route({ routeId: 'st', routeCode: 'ST', stationIds: ['S2W', 'T3上行'] });
  const tn = route({ routeId: 'tn', routeCode: 'TN', stationIds: ['T3上行', 'N2W下行出發'] });
  const nt = route({ routeId: 'nt', routeCode: 'NT', stationIds: ['N2W下行出發', 'T3下行'] });
  const tnb = route({ routeId: 'tnb', routeCode: 'TNB', stationIds: ['T3上行', '備用N2W'] });
  const ntb = route({ routeId: 'ntb', routeCode: 'NTB', stationIds: ['備用N2W', 'T3下行'] });
  const ts = route({ routeId: 'ts', routeCode: 'TS', stationIds: ['T3下行', 'S2W'] });
  /** 別列車：也要用到 N2W下行出發 */
  const rival = route({ routeId: 'rival', routeCode: 'RIVAL', stationIds: ['Q', 'N2W下行出發'] });
  const allRoutes = [st, tn, nt, tnb, ntb, ts, rival];

  function policy(): RouteSuccessorPolicy {
    return {
      algorithm: ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
      valid: true,
      routesByInstanceId: new Map([
        ['st', st], ['tn', tn], ['nt', nt],
        ['tnb', tnb], ['ntb', ntb], ['ts', ts], ['rival', rival],
      ]),
      rotationRoutes: [nt, ts, st, tn],
      prioritySuccessors: new Map([
        ['st', ['tn']],
        ['tn', ['nt']],
        ['nt', ['ts']],
        ['tnb', ['ntb']],
        ['ntb', ['ts']],
        ['ts', ['st']],
      ]),
      secondarySuccessors: new Map([['st', ['tnb']]]),
      startInstanceIds: ['nt'],
      endInstanceIds: new Set(['tn']),
      canonicalCycleInstanceIds: ['nt', 'ts', 'st', 'tn'],
      throughCycles: [],
    };
  }

  /** row1：ST → TN（停在 N2W下行出發）→ 空等 → NT。row2：別台車也要 N2W下行出發 */
  function timelines(): GeneratedScheduleTimeline[] {
    const mk = (
      id: string, row: number, start: number, routeId: string, code: string,
    ) => block({
      id, timelineRow: row,
      plannedStartMinute: start,
      plannedEndMinute: start + 170 / 60,
      routeId, routeCode: code, routeInstanceId: routeId,
    });
    return [
      { row: 1, blocks: [mk('st1', 1, 56, 'st', 'ST'), mk('tn1', 1, 60, 'tn', 'TN'), mk('nt1', 1, 70, 'nt', 'NT')] },
      { row: 2, blocks: [mk('rival1', 2, 65, 'rival', 'RIVAL')] },
    ];
  }

  it('整對換成備用替身、時刻完全不動', () => {
    const warnings: never[] = [];
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: timelines(),
      selectedRoutes: allRoutes,
      successorPolicy: policy(),
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: warnings as never,
    });

    const row1 = result.find((t) => t.row === 1)!;
    const tnBlock = row1.blocks.find((b) => b.id === 'tn1')!;
    const ntBlock = row1.blocks.find((b) => b.id === 'nt1')!;
    assert.equal(tnBlock.routeId, 'tnb', 'TN 應換成 TNB');
    assert.equal(ntBlock.routeId, 'ntb', 'NT 應換成 NTB');
    // 發車時刻不得改變——這是這個做法相對「延後」最重要的性質
    assert.equal(tnBlock.plannedStartMinute, 60);
    assert.equal(ntBlock.plannedStartMinute, 70);
    // 不是靠插入班次解決的
    assert.equal(row1.blocks.some((b) => b.source === 'relief_loop'), false);
    assert.equal(row1.blocks.length, 3, '不應多出任何班次');
    assert.equal((warnings[0] as { code: string }).code, 'STATION_BERTH_BACKUP_USED');
  });

  it('沒有備用替身可換（關聯圖沒那條次要邊）→ 不動', () => {
    const p = policy();
    p.secondarySuccessors = new Map();
    const result = relievePlatformIdleWithSecondaryEdge({
      timelines: timelines(),
      selectedRoutes: allRoutes,
      successorPolicy: p,
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: [],
    });
    const row1 = result.find((t) => t.row === 1)!;
    assert.equal(row1.blocks.find((b) => b.id === 'tn1')!.routeId, 'tn');
    assert.equal(row1.blocks.find((b) => b.id === 'nt1')!.routeId, 'nt');
  });
});
