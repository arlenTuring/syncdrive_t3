import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import {
  enforceStationBerthConstraints,
  resolveBerthClearDelaySeconds,
  type BerthWindowSec,
} from './stationBerthConstraint';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
} from './stationBerthOccupancy';
import {
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  type RouteSuccessorPolicy,
} from './schedule-engine/routeSuccessorPolicy';

function graphPolicy(
  rotation: ShiftScheduleSelectedRoute[],
): RouteSuccessorPolicy {
  const routesByInstanceId = new Map(
    rotation.map((r) => [r.instanceId ?? r.routeId, r] as const),
  );
  const prioritySuccessors = new Map<string, string[]>();
  for (let i = 0; i < rotation.length - 1; i += 1) {
    const from = rotation[i]!.instanceId ?? rotation[i]!.routeId;
    const to = rotation[i + 1]!.instanceId ?? rotation[i + 1]!.routeId;
    prioritySuccessors.set(from, [to]);
  }
  const first = rotation[0]!.instanceId ?? rotation[0]!.routeId;
  const last = rotation[rotation.length - 1]!.instanceId ?? rotation[rotation.length - 1]!.routeId;
  return {
    algorithm: ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
    valid: true,
    routesByInstanceId,
    rotationRoutes: rotation,
    prioritySuccessors,
    secondarySuccessors: new Map(),
    startInstanceIds: [first],
    endInstanceIds: new Set([last]),
    canonicalCycleInstanceIds: rotation.map((r) => r.instanceId ?? r.routeId),
    throughCycles: [],
  };
}

function route(partial: Partial<ShiftScheduleSelectedRoute> & {
  routeId: string;
  routeCode: string;
}): ShiftScheduleSelectedRoute {
  return {
    instanceId: partial.instanceId ?? partial.routeId,
    routeId: partial.routeId,
    routeName: partial.routeName ?? partial.routeCode,
    routeCode: partial.routeCode,
    groupId: 'g',
    groupName: 'g',
    executionOrder: partial.executionOrder ?? 1,
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 100,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationIds: partial.stationIds ?? ['A', 'P1'],
    stationDwells: partial.stationDwells ?? [
      { stationId: 'A', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'P1', stationName: 'P1停靠點', dwellSeconds: 50 },
    ],
    stationLegTravels: partial.stationLegTravels ?? [
      {
        fromStationId: 'A',
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
    dwellSeconds: 50,
    anchorStartMinute: partial.plannedStartMinute,
    routeId: partial.routeId ?? 'tn',
    routeCode: partial.routeCode ?? 'TN',
    routeName: partial.routeName ?? 'TN',
    routeInstanceId: partial.routeInstanceId ?? partial.routeId ?? 'tn',
    ...partial,
  } as GeneratedScheduleBlock;
}

describe('stationBerthConstraint', () => {
  it('computes delay so later arrival clears earlier release', () => {
    const booked: BerthWindowSec[] = [
      { stationId: 'P1', stationName: 'P1', startSecond: 100, endSecond: 150 },
    ];
    const proposed: BerthWindowSec[] = [
      { stationId: 'P1', stationName: 'P1', startSecond: 130, endSecond: 180 },
    ];
    assert.equal(resolveBerthClearDelaySeconds(proposed, booked), 20);
  });

  it('delays later trip so terminal berth no longer overlaps', () => {
    const tn = route({ routeId: 'tn', routeCode: 'TN' });
    const timelines = [
      {
        row: 7,
        blocks: [
          block({
            id: 'earlier',
            timelineRow: 7,
            plannedStartMinute: 18 * 60 + 53,
            // 占用約到站 P1 靠站重疊區
            plannedEndMinute: 18 * 60 + 53 + 3,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 10,
        blocks: [
          block({
            id: 'later',
            timelineRow: 10,
            plannedStartMinute: 18 * 60 + 53.5,
            plannedEndMinute: 18 * 60 + 53.5 + 3,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
    ];

    const before = findStationBerthCollisions(
      collectStationBerthOccupancies(timelines, [tn]),
      [tn],
    );
    assert.ok(before.length > 0, 'fixture must collide before repair');

    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      maxDelaySeconds: 120,
    });
    assert.ok(repaired.delayedCount >= 1);

    const after = findStationBerthCollisions(
      collectStationBerthOccupancies(repaired.timelines, [tn]),
      [tn],
    );
    assert.equal(after.length, 0, 'delay should clear berth overlap');
  });

  it('switches to backup when delay would exceed max and turnaround stays continuous', () => {
    const primary = route({
      instanceId: 'sel-primary',
      routeId: 'main',
      routeCode: 'MAIN',
      routeName: '主線',
      stationIds: ['A', 'P1'],
      stationDwells: [
        { stationId: 'A', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P1', stationName: 'P1', dwellSeconds: 90 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'A',
          toStationId: 'P1',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    // 備用改停 P2，但仍從 A 出發、仍接到下一趟 B→… 的連續點？此例無後續正線
    const backup = route({
      instanceId: 'sel-backup',
      routeId: 'bak',
      routeCode: 'BAK',
      routeName: '備用停靠',
      backupForInstanceId: 'sel-primary',
      executionOrder: 1,
      stationIds: ['A', 'P2'],
      stationDwells: [
        { stationId: 'A', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P2', stationName: 'P2備援', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'A',
          toStationId: 'P2',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });

    // 前車長佔 P1；後車若仍走主線需延後很多；無同列下一正線 → 可安全改派備用
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'hold-p1',
            timelineRow: 1,
            plannedStartMinute: 100,
            plannedEndMinute: 100 + 3,
            routeId: 'main',
            routeInstanceId: 'sel-primary',
            routeCode: 'MAIN',
            routeName: '主線',
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'contested',
            timelineRow: 2,
            plannedStartMinute: 100.5,
            plannedEndMinute: 100.5 + 3,
            routeId: 'main',
            routeInstanceId: 'sel-primary',
            routeCode: 'MAIN',
            routeName: '主線',
          }),
        ],
      },
    ];

    const warnings: NonNullable<
      Parameters<typeof enforceStationBerthConstraints>[0]['warnings']
    > = [];
    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [primary, backup],
      maxDelaySeconds: 10,
      warnings,
    });

    const contested = repaired.timelines
      .flatMap((t) => t.blocks)
      .find((b) => b.id === 'contested');
    assert.ok(contested);
    assert.equal(contested!.routeId, 'bak', 'should switch to backup berth route');
    assert.ok(repaired.backupSwitchedCount >= 1);

    const collisions = findStationBerthCollisions(
      collectStationBerthOccupancies(repaired.timelines, [primary, backup]),
      [primary, backup],
    );
    assert.equal(collisions.length, 0);
  });

  it('does not swap to backup that breaks TN→NT turnaround continuity', () => {
    const tn = route({
      instanceId: 'sel-tn',
      routeId: 'tn',
      routeCode: 'TN',
      routeName: 'T3上行 > N2W上行',
      stationIds: ['T3U', 'N2W下行出發'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'N2W下行出發', stationName: 'N2W下行出發', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'N2W下行出發',
          avgTravelTimeSeconds: 180,
          minTravelTimeSeconds: 160,
        },
      ],
      avgTravelTimeSeconds: 180,
      minTravelTimeSeconds: 160,
      executionOrder: 1,
    });
    const nt = route({
      instanceId: 'sel-nt',
      routeId: 'nt',
      routeCode: 'NT',
      routeName: 'N2W上行 > T3下行',
      stationIds: ['N2W下行出發', 'T3D'],
      stationDwells: [
        { stationId: 'N2W下行出發', stationName: 'N2W下行出發', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3D', stationName: 'T3下行', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'N2W下行出發',
          toStationId: 'T3D',
          avgTravelTimeSeconds: 180,
          minTravelTimeSeconds: 160,
        },
      ],
      avgTravelTimeSeconds: 180,
      minTravelTimeSeconds: 160,
      executionOrder: 2,
    });
    const ntb = route({
      instanceId: 'sel-ntb',
      routeId: 'ntb',
      routeCode: 'NTB',
      routeName: '[備用]N2W下行 > T3下行',
      backupForInstanceId: 'sel-nt',
      stationIds: ['備用N2W下行', 'T3D'],
      stationDwells: [
        { stationId: '備用N2W下行', stationName: '[備用]N2W下行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3D', stationName: 'T3下行', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: '備用N2W下行',
          toStationId: 'T3D',
          avgTravelTimeSeconds: 180,
          minTravelTimeSeconds: 160,
        },
      ],
      avgTravelTimeSeconds: 180,
      minTravelTimeSeconds: 160,
    });

    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'tn',
            timelineRow: 1,
            plannedStartMinute: 61,
            plannedEndMinute: 61 + 4,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
          block({
            id: 'nt',
            timelineRow: 1,
            plannedStartMinute: 61 + 4.5,
            plannedEndMinute: 61 + 8.5,
            routeId: 'nt',
            routeInstanceId: 'sel-nt',
            routeCode: 'NT',
          }),
        ],
      },
    ];

    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn, nt, ntb],
      maxDelaySeconds: 0,
    });
    const ntBlock = repaired.timelines[0]!.blocks.find((b) => b.id === 'nt')!;
    assert.equal(
      ntBlock.routeId,
      'nt',
      'must not replace NT with NTB when origin station differs from TN terminal',
    );
    assert.equal(repaired.backupSwitchedCount, 0);
  });

  it('when spare needed, co-swaps TN→TNB and NT→NTB (never TN→NTB)', () => {
    const tn = route({
      instanceId: 'sel-tn',
      routeId: 'tn',
      routeCode: 'TN',
      routeName: 'T3上行 > N2W上行',
      stationIds: ['T3U', 'P1'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P1', stationName: 'N2W上行停靠', dwellSeconds: 90 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'P1',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
      executionOrder: 1,
    });
    const nt = route({
      instanceId: 'sel-nt',
      routeId: 'nt',
      routeCode: 'NT',
      routeName: 'N2W下行 > T3下行',
      stationIds: ['P1', 'T3D'],
      stationDwells: [
        { stationId: 'P1', stationName: 'N2W下行出發', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3D', stationName: 'T3下行', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'P1',
          toStationId: 'T3D',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
      executionOrder: 2,
    });
    const tnb = route({
      instanceId: 'sel-tnb',
      routeId: 'tnb',
      routeCode: 'TNB',
      routeName: 'T3上行 > [備用]N2W上行停靠',
      backupForInstanceId: 'sel-tn',
      stationIds: ['T3U', 'P2'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P2', stationName: '[備用]N2W上行停靠', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'P2',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    const ntb = route({
      instanceId: 'sel-ntb',
      routeId: 'ntb',
      routeCode: 'NTB',
      routeName: '[備用]N2W下行 > T3下行',
      backupForInstanceId: 'sel-nt',
      stationIds: ['P2', 'T3D'],
      stationDwells: [
        { stationId: 'P2', stationName: '[備用]N2W下行出發', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3D', stationName: 'T3下行', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'P2',
          toStationId: 'T3D',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });

    // 他車佔死 P1，TN 無法延；必須成對改 TNB→NTB
    const timelines = [
      {
        row: 9,
        blocks: [
          block({
            id: 'blocker',
            timelineRow: 9,
            plannedStartMinute: 100,
            plannedEndMinute: 100 + 4,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 1,
        blocks: [
          block({
            id: 'tn',
            timelineRow: 1,
            plannedStartMinute: 100.5,
            plannedEndMinute: 100.5 + 3,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
          block({
            id: 'nt',
            timelineRow: 1,
            plannedStartMinute: 100.5 + 3.5,
            plannedEndMinute: 100.5 + 6.5,
            routeId: 'nt',
            routeInstanceId: 'sel-nt',
            routeCode: 'NT',
          }),
        ],
      },
    ];

    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn, nt, tnb, ntb],
      maxDelaySeconds: 10,
      successorPolicy: graphPolicy([tn, nt]),
    });
    const byId = new Map(
      repaired.timelines.flatMap((t) => t.blocks).map((b) => [b.id, b] as const),
    );
    assert.equal(byId.get('tn')!.routeCode, 'TNB', 'outbound spare must be TNB not TN');
    assert.equal(byId.get('nt')!.routeCode, 'NTB', 'return spare must be NTB with TNB');
    assert.notEqual(byId.get('tn')!.routeCode, 'TN');
  });

  it('refuses backup pair when timeline next is not graph successor', () => {
    const tn = route({
      instanceId: 'sel-tn',
      routeId: 'tn',
      routeCode: 'TN',
      executionOrder: 1,
      stationIds: ['T3U', 'P1'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3U', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P1', stationName: 'P1', dwellSeconds: 90 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'P1',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    const nt = route({
      instanceId: 'sel-nt',
      routeId: 'nt',
      routeCode: 'NT',
      executionOrder: 2,
      stationIds: ['P1', 'T3D'],
      stationDwells: [
        { stationId: 'P1', stationName: 'P1', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3D', stationName: 'T3D', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'P1',
          toStationId: 'T3D',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    const ts = route({
      instanceId: 'sel-ts',
      routeId: 'ts',
      routeCode: 'TS',
      executionOrder: 3,
      stationIds: ['P1', 'S2'],
      stationDwells: [
        { stationId: 'P1', stationName: 'P1', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'S2', stationName: 'S2', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'P1',
          toStationId: 'S2',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    const tnb = route({
      instanceId: 'sel-tnb',
      routeId: 'tnb',
      routeCode: 'TNB',
      backupForInstanceId: 'sel-tn',
      stationIds: ['T3U', 'P2'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3U', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P2', stationName: 'P2', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'P2',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    const ntb = route({
      instanceId: 'sel-ntb',
      routeId: 'ntb',
      routeCode: 'NTB',
      backupForInstanceId: 'sel-nt',
      stationIds: ['P2', 'T3D'],
      stationDwells: [
        { stationId: 'P2', stationName: 'P2', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3D', stationName: 'T3D', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'P2',
          toStationId: 'T3D',
          avgTravelTimeSeconds: 60,
          minTravelTimeSeconds: 50,
        },
      ],
      avgTravelTimeSeconds: 60,
      minTravelTimeSeconds: 50,
    });
    // 圖上 TN→NT，但時間線下一趟卻是 TS → 不得成對改派
    const timelines = [
      {
        row: 9,
        blocks: [
          block({
            id: 'blocker',
            timelineRow: 9,
            plannedStartMinute: 100,
            plannedEndMinute: 104,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 1,
        blocks: [
          block({
            id: 'tn',
            timelineRow: 1,
            plannedStartMinute: 100.5,
            plannedEndMinute: 103.5,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
          block({
            id: 'ts',
            timelineRow: 1,
            plannedStartMinute: 104,
            plannedEndMinute: 107,
            routeId: 'ts',
            routeInstanceId: 'sel-ts',
            routeCode: 'TS',
          }),
        ],
      },
    ];
    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn, nt, ts, tnb, ntb],
      maxDelaySeconds: 10,
      successorPolicy: graphPolicy([tn, nt]),
    });
    assert.equal(
      repaired.timelines.flatMap((t) => t.blocks).find((b) => b.id === 'tn')!.routeCode,
      'TN',
      'must not spare-swap when next leg is not graph successor',
    );
  });
});
