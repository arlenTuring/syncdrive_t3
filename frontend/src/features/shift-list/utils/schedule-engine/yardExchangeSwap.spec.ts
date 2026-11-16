import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import type { PlanEvaluationContext } from './evaluatePlan';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';
import { avoidYardExchangeSwap } from './yardExchangeSwap';

/**
 * 對向交換：離線的車剛到月台要進整備區，上線的車從同一個整備區出來要到同一個月台。
 *
 * 路網：月台 PA、PB 都接到入口點 G，G 再接整備位置 Y1、Y2（每段 50 秒，雙向）。
 * 路線：「PA→PD」與備用的「PB→PD」同終點、下游相同；「PD→PA」回到 PA。
 * 站名、路線名都是測試自己取的，程式裡不認任何站名。
 */

const both = (id: string, a: string, b: string) => [
  { id: `${id}-f`, fromNodeId: a, toNodeId: b, minTravelTimeSeconds: 50, avgTravelTimeSeconds: 50, distanceMeters: null },
  { id: `${id}-r`, fromNodeId: b, toNodeId: a, minTravelTimeSeconds: 50, avgTravelTimeSeconds: 50, distanceMeters: null },
];

const topology = {
  version: 1,
  nodes: [
    { id: 'n-pa', kind: 'docking', label: 'PA', stationId: 'pa' },
    { id: 'n-pb', kind: 'docking', label: 'PB', stationId: 'pb' },
    { id: 'n-pd', kind: 'docking', label: 'PD', stationId: 'pd' },
    { id: 'g', kind: 'waypoint', label: 'G' },
    { id: 'y1', kind: 'facility', label: 'Y1' },
    { id: 'y2', kind: 'facility', label: 'Y2' },
  ],
  edges: [...both('pa-g', 'n-pa', 'g'), ...both('pb-g', 'n-pb', 'g'), ...both('g-y1', 'g', 'y1'), ...both('g-y2', 'g', 'y2')],
} as unknown as PointTopology;

function route(instanceId: string, from: string, to: string): ShiftScheduleSelectedRoute {
  return {
    instanceId,
    routeId: `route-${instanceId}`,
    routeName: `${from.toUpperCase()}>${to.toUpperCase()}`,
    routeCode: instanceId.toUpperCase(),
    groupId: 'g',
    groupName: 'g',
    executionOrder: 1,
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 100,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationIds: [from, to],
    stationDwells: [
      { stationId: from, stationName: from.toUpperCase(), dwellSeconds: 0, dwellRequired: false },
      { stationId: to, stationName: to.toUpperCase(), dwellSeconds: 40 },
    ],
    stationLegTravels: [{ fromStationId: from, toStationId: to, avgTravelTimeSeconds: 120, minTravelTimeSeconds: 100 }],
    stationDwellsConfirmed: true,
    backupForInstanceId: null,
    backupForRouteId: null,
  } as ShiftScheduleSelectedRoute;
}

const routes = [route('out-a', 'pa', 'pd'), route('out-b', 'pb', 'pd'), route('in-a', 'pd', 'pa')];

const ctx = {
  selectedRoutes: routes,
  routeById: new Map(routes.map((item) => [item.routeId, item])),
  passengerRoutes: routes,
  successorPolicy: {
    valid: true,
    routesByInstanceId: new Map(routes.map((item) => [item.instanceId, item])),
    prioritySuccessors: new Map([['out-a', ['in-a']], ['out-b', ['in-a']], ['in-a', ['out-a']]]),
  },
  minimumRecoveryTimeSeconds: 30,
  collisionProtectionSeconds: 30,
  intervals: [],
  attributes: [],
  scheduleRowCount: 3,
  topology,
} as unknown as PlanEvaluationContext;

function trip(row: number, id: string, instanceId: string, startSecond: number): GeneratedScheduleBlock {
  const selected = routes.find((item) => item.instanceId === instanceId)!;
  return {
    id,
    timelineRow: row,
    taskType: 'passenger',
    label: '正線',
    source: 'template_bar',
    routeInstanceId: instanceId,
    routeId: selected.routeId,
    routeName: selected.routeName,
    routeCode: selected.routeCode,
    travelSeconds: 120,
    dwellSeconds: 40,
    anchorStartMinute: startSecond / 60,
    plannedStartMinute: startSecond / 60,
    plannedEndMinute: (startSecond + 180) / 60,
  } as GeneratedScheduleBlock;
}

function yard(row: number, id: string, taskType: string, nodeId: string, startSecond: number, endSecond: number): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: row,
    taskType,
    label: taskType,
    source: 'template_bar',
    travelSeconds: 0,
    dwellSeconds: 0,
    anchorStartMinute: startSecond / 60,
    plannedStartMinute: startSecond / 60,
    plannedEndMinute: endSecond / 60,
    yardFacilityNodeId: nodeId,
  } as GeneratedScheduleBlock;
}

/**
 * 時間線 1：載客到 PA（arriveSecond 到站），接著進 Y1 充電（離線）。
 * 時間線 2：在 Y2 待命，firstStartSecond 從 PA 發第一班（上線）。
 */
function plan(arriveSecond: number, firstStartSecond: number, extra: GeneratedSchedulePlan['timelines'] = []): GeneratedSchedulePlan['timelines'] {
  return [
    { row: 1, blocks: [trip(1, 'a-last', 'in-a', arriveSecond - 180), yard(1, 'a-charge', 'charging', 'y1', arriveSecond + 120, arriveSecond + 3600)] },
    { row: 2, blocks: [yard(2, 'b-standby', 'standby', 'y2', 0, firstStartSecond - 200), trip(2, 'b-first', 'out-a', firstStartSecond)] },
    ...extra,
  ];
}

const firstOf = (timelines: GeneratedSchedulePlan['timelines']) =>
  timelines.find((timeline) => timeline.row === 2)!.blocks.find((block) => block.id === 'b-first')!;

describe('不讓上線的車跟離線的車互相要去對方的位置', () => {
  it('離線車到站後太快就要從同一個月台發車：上線車改到另一個月台，時刻不變', () => {
    // 需要 30（停留）＋ 50 ＋ 30（碰撞保護）＋ 50 ＝ 160 秒，只隔 110 秒
    const warnings: FeasibilityIssue[] = [];
    const before = plan(3600, 3710);
    const result = avoidYardExchangeSwap({ timelines: before, topology, ctx, warnings });
    assert.deepEqual([result.swaps, result.rerouted], [1, 1]);
    const first = firstOf(result.timelines);
    assert.equal(first.routeInstanceId, 'out-b');
    assert.equal(first.plannedStartMinute, 3710 / 60);
    assert.equal(first.plannedEndMinute, (3710 + 180) / 60);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.code, 'ROUTE_ALIGNED_TO_VEHICLE_LOCATION');
    assert.equal((warnings[0]!.detail as { swapWithTimelineRow: number }).swapWithTimelineRow, 1);
    // 原本的班表沒被改到
    assert.equal(firstOf(before).routeInstanceId, 'out-a');
  });

  it('隔得夠久（離線車來得及先走完共用的路）就不動', () => {
    const warnings: FeasibilityIssue[] = [];
    const result = avoidYardExchangeSwap({ timelines: plan(3600, 3760), topology, ctx, warnings });
    assert.deepEqual([result.swaps, result.rerouted], [0, 0]);
    assert.equal(firstOf(result.timelines).routeInstanceId, 'out-a');
    assert.deepEqual(warnings, []);
  });

  it('另一個月台當時有別的車：不換，留給後面的搜尋處理', () => {
    const warnings: FeasibilityIssue[] = [];
    // 時間線 3 同一時間從 PB 發車
    const busy = [{ row: 3, blocks: [trip(3, 'c-trip', 'out-b', 3700)] }];
    const result = avoidYardExchangeSwap({ timelines: plan(3600, 3710, busy), topology, ctx, warnings });
    assert.deepEqual([result.swaps, result.rerouted], [1, 0]);
    assert.equal(firstOf(result.timelines).routeInstanceId, 'out-a');
    assert.deepEqual(warnings, []);
  });

  it('離線車要去的整備區不經過同一段路：不算對向交換', () => {
    // 把離線車的充電位改成跟月台直接相連、不經過入口點 G 的位置
    const separate = {
      ...topology,
      nodes: [...topology.nodes, { id: 'y9', kind: 'facility', label: 'Y9' }],
      edges: [...topology.edges, ...both('pa-y9', 'n-pa', 'y9')],
    } as unknown as PointTopology;
    const timelines = plan(3600, 3710).map((timeline) => ({
      ...timeline,
      blocks: timeline.blocks.map((block) => (block.id === 'a-charge' ? { ...block, yardFacilityNodeId: 'y9' } : block)),
    }));
    const result = avoidYardExchangeSwap({ timelines, topology: separate, ctx, warnings: [] });
    assert.deepEqual([result.swaps, result.rerouted], [0, 0]);
  });
});
