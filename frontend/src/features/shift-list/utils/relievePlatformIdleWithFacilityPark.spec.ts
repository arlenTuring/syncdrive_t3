import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';
import { relievePlatformIdleWithFacilityPark } from './relievePlatformIdleWithFacilityPark';

function node(id: string, kind: 'facility' | 'docking', stationId?: string) {
  return { id, kind, label: id, stationId, x: 0, y: 0, color: '#111111' } as const;
}

function edge(from: string, to: string, seconds: number) {
  return {
    id: `e:${from}->${to}`,
    fromNodeId: from,
    toNodeId: to,
    minTravelTimeSeconds: seconds,
    avgTravelTimeSeconds: seconds,
    distanceMeters: null,
  };
}

/**
 * T3 → W1 → E2：W1、E2 是不同設施格，但 W1→E2 這段拓樸上是零秒
 * （沒填行駛時間，或就是零秒轉場，2026-09-25 實錄的 M1/E2 情境）。
 */
function topology(): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      node('T3', 'docking', 'T3'),
      node('W1', 'facility'),
      node('E2', 'facility'),
    ],
    edges: [edge('T3', 'W1', 30), edge('W1', 'E2', 0)],
  };
}

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

const routeA = route({ routeId: 'a', routeCode: 'A', stationIds: ['X', 'T3'] });
const routeOther = route({ routeId: 'other', routeCode: 'OTHER', stationIds: ['U', 'T3'] });

/**
 * row1：A（X→T3）跑完停在 T3，排定的入廠移動卡（→ E2）要等到第 90 分鐘才發車
 * ——中間空等接近 27 分鐘。row2：另一台車 Other（U→T3）在這段空等期間到站，撞上。
 *
 * @param ownTravelSeconds nextBlock（既有入廠移動卡）自己的行駛秒數。
 *   >0 時足以觸發甲（直接開進 E2 提早等）；0 時甲的 `ownTravelSeconds > 0` 檢查
 *   不成立，落到乙（借 W1 等，再零秒跳進 E2）。
 */
function timelinesWithYardEntry(ownTravelSeconds: number): GeneratedScheduleTimeline[] {
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
          id: 'entry-e2',
          timelineRow: 1,
          taskType: 'dispatch',
          label: '整備入廠 · → E2',
          source: 'yard_entry_move',
          plannedStartMinute: 90,
          plannedEndMinute: 90,
          travelSeconds: ownTravelSeconds,
          dwellSeconds: 0,
          routeId: undefined,
          routeCode: undefined,
          routeInstanceId: undefined,
          yardExitFacilityNodeId: 'E2',
          yardExitFacilityLabel: 'E2',
        }),
        block({
          id: 'charge-e2',
          timelineRow: 1,
          taskType: 'charging',
          label: '充電',
          source: 'template_bar',
          plannedStartMinute: 90,
          plannedEndMinute: 200,
          travelSeconds: 0,
          dwellSeconds: (200 - 90) * 60,
          routeId: undefined,
          routeCode: undefined,
          routeInstanceId: undefined,
          yardFacilityNodeId: 'E2',
          yardFacilityLabel: 'E2',
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

describe('relievePlatformIdleWithFacilityPark：甲／乙判準改用格位身分', () => {
  it('不同格位、零秒轉場（乙）：保留 W1 等待區間，E2 整備時刻不提前', () => {
    const warnings: never[] = [];
    const result = relievePlatformIdleWithFacilityPark({
      timelines: timelinesWithYardEntry(0),
      selectedRoutes: [routeA, routeOther],
      topology: topology(),
      collisionProtectionSeconds: 30,
      warnings: warnings as never,
    });

    const row1 = result.timelines.find((t) => t.row === 1)!;

    const enterWait = row1.blocks.find((b) => b.id.startsWith('berthpark-early-in-'));
    assert.ok(enterWait, '乙需要自己的入場移動卡（進 W1），不得因為零秒轉場被略過');
    assert.match(enterWait!.label, /W1/);

    const stayWait = row1.blocks.find((b) => b.id.startsWith('berthpark-early-stay-'));
    assert.ok(stayWait, '乙需要在 W1 插一張等待卡，佔住那一格直到合法進 E2 的時刻');
    assert.equal((stayWait as unknown as { yardFacilityNodeId?: string }).yardFacilityNodeId, 'W1');

    // 進 E2 的那段（原本的入廠移動卡）即使零秒，也要貼齊原訂進廠時刻，不能被拉到離站就開始算
    const hopToE2 = row1.blocks.find((b) => b.id === 'entry-e2')!;
    assert.ok(
      Math.abs(hopToE2.plannedEndMinute - 90) < 0.2,
      `hop 段應該在原訂 90 分鐘結束，實際 ${hopToE2.plannedEndMinute}`,
    );

    // 整備（充電）本人完全沒被動到——車還沒到 E2，整備時刻不能提前
    const charge = row1.blocks.find((b) => b.id === 'charge-e2')!;
    assert.equal(charge.plannedStartMinute, 90, '車還在 W1 等，E2 整備不能提早開始');

    assert.equal(result.parked, 1);
  });

  it('直接進目的格本人（甲）：沿用既有入廠卡、整備照樣提早開始（行為不變）', () => {
    const result = relievePlatformIdleWithFacilityPark({
      timelines: timelinesWithYardEntry(30),
      selectedRoutes: [routeA, routeOther],
      topology: topology(),
      collisionProtectionSeconds: 30,
      warnings: [],
    });

    const row1 = result.timelines.find((t) => t.row === 1)!;

    assert.equal(
      row1.blocks.some((b) => b.id.startsWith('berthpark-early-in-')),
      false,
      '甲直接沿用既有入廠卡，不該多插一張進 W1 的卡',
    );
    assert.equal(
      row1.blocks.some((b) => b.id.startsWith('berthpark-early-stay-')),
      false,
      '甲在目的格本人裡面等，不該插等待卡',
    );

    const hopToE2 = row1.blocks.find((b) => b.id === 'entry-e2')!;
    // 甲：既有入廠卡整張往前挪到跑完就走，只涵蓋自己的行駛秒數（30 秒）
    assert.ok(hopToE2.plannedStartMinute < 63, '應該提早出發，不是等到 90 分鐘');
    assert.ok(hopToE2.plannedEndMinute < 64, '30 秒的行駛，不該拉到 90 分鐘那麼長');

    // 整備跟著提早開始（車已經在 E2 裡面了，等待就是在裡面等）
    const charge = row1.blocks.find((b) => b.id === 'charge-e2')!;
    assert.ok(charge.plannedStartMinute < 64 && charge.plannedStartMinute > 62, '整備應該跟著提早開始');
    assert.notEqual(charge.plannedStartMinute, 90);

    assert.equal(result.parked, 1);
  });
});
