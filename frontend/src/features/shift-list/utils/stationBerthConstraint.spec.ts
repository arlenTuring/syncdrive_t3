import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import {
  enforceStationBerthConstraints,
  resolveBerthClearDelaySeconds,
  STATION_BERTH_WAIT_MAX_DELAY_SECONDS,
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

  it('switches to same-origin alt when delay would exceed max', () => {
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

  it('does not pick NTB after TN when origin station differs from TN terminal', () => {
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

  it('when priority berth blocked, picks same-origin topology alt; next hop follows chosen terminal', () => {
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

    // 他車佔死 P1；開站選 TNB（同起點無衝突），下一腳依 TNB 終點自然接到 NTB
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
    assert.equal(byId.get('tn')!.routeCode, 'TNB', 'same-origin alt when TN berth blocked');
    assert.equal(
      byId.get('nt')!.routeCode,
      'NTB',
      'next hop follows TNB terminal (not a predeclared backup-pair swap)',
    );
  });

  it('never picks a hop that breaks station continuity from previous', () => {
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
    // TN 清得開時不得為了站位去接異點 NTB；保持 TN→NT
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'tn',
            timelineRow: 1,
            plannedStartMinute: 100,
            plannedEndMinute: 103,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
          block({
            id: 'nt',
            timelineRow: 1,
            plannedStartMinute: 103.5,
            plannedEndMinute: 106.5,
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
    assert.equal(byId.get('tn')!.routeCode, 'TN');
    assert.equal(byId.get('nt')!.routeCode, 'NT');
    assert.equal(repaired.backupSwitchedCount, 0);
  });

  it('delays for berth even when same-row next trip is tightly packed', () => {
    const tn = route({
      instanceId: 'sel-tn',
      routeId: 'tn',
      routeCode: 'TN',
      stationIds: ['T3U', 'P1'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 50, dwellRequired: true },
        { stationId: 'P1', stationName: 'P1', dwellSeconds: 40 },
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
    // row1 佔 T3U；row2 想幾乎同時進站，但後面馬上排了下一班（以前會把延後上限夾成 0）
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'hold',
            timelineRow: 1,
            plannedStartMinute: 100,
            plannedEndMinute: 100 + 3,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'contested',
            timelineRow: 2,
            plannedStartMinute: 100 + 10 / 60,
            plannedEndMinute: 100 + 10 / 60 + 3,
            routeId: 'tn',
            routeInstanceId: 'sel-tn',
            routeCode: 'TN',
          }),
          block({
            id: 'next',
            timelineRow: 2,
            plannedStartMinute: 100 + 10 / 60 + 3,
            plannedEndMinute: 100 + 10 / 60 + 6,
            routeId: 'nt',
            routeInstanceId: 'sel-nt',
            routeCode: 'NT',
          }),
        ],
      },
    ];
    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn, nt],
      maxDelaySeconds: 120,
      minimumRecoveryTimeSeconds: 0,
      successorPolicy: graphPolicy([tn, nt]),
    });
    const collisions = findStationBerthCollisions(
      collectStationBerthOccupancies(repaired.timelines, [tn, nt]),
      [tn, nt],
    );
    assert.equal(collisions.length, 0, 'tight next trip must not block berth delay');
    const contested = repaired.timelines
      .flatMap((t) => t.blocks)
      .find((b) => b.id === 'contested')!;
    const next = repaired.timelines.flatMap((t) => t.blocks).find((b) => b.id === 'next')!;
    assert.ok(
      contested.plannedEndMinute <= next.plannedStartMinute + 1e-9,
      'same-row next must be pushed after berth delay',
    );
  });

  it('delays origin berth collision even when charging follows on the same row', () => {
    const st = route({
      instanceId: 'sel-st',
      routeId: 'st',
      routeCode: 'ST',
      stationIds: ['T3U', 'S2'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'S2', stationName: 'S2', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'S2',
          avgTravelTimeSeconds: 160,
          minTravelTimeSeconds: 150,
        },
      ],
      avgTravelTimeSeconds: 160,
      minTravelTimeSeconds: 150,
    });
    // 兩台車同一秒搶 T3上行 10 秒門檻；後車同列後面還有充電（舊邏輯會把延後上限夾死）
    const timelines = [
      {
        row: 4,
        blocks: [
          block({
            id: 'tn-a',
            timelineRow: 4,
            plannedStartMinute: 18 * 60 + 57,
            plannedEndMinute: 18 * 60 + 57 + 3,
            routeId: 'st',
            routeInstanceId: 'sel-st',
            routeCode: 'ST',
          }),
          {
            id: 'chg-a',
            timelineRow: 4,
            taskType: 'charging' as const,
            label: '充電',
            source: 'template_bar' as const,
            plannedStartMinute: 18 * 60 + 57 + 3.1,
            plannedEndMinute: 19 * 60 + 30,
            travelSeconds: 0,
            dwellSeconds: 0,
            anchorStartMinute: 18 * 60 + 57 + 3.1,
          },
        ],
      },
      {
        row: 10,
        blocks: [
          block({
            id: 'tn-b',
            timelineRow: 10,
            plannedStartMinute: 18 * 60 + 57,
            plannedEndMinute: 18 * 60 + 57 + 3,
            routeId: 'st',
            routeInstanceId: 'sel-st',
            routeCode: 'ST',
          }),
          {
            id: 'chg-b',
            timelineRow: 10,
            taskType: 'charging' as const,
            label: '充電',
            source: 'template_bar' as const,
            plannedStartMinute: 18 * 60 + 57 + 3.1,
            plannedEndMinute: 19 * 60 + 30,
            travelSeconds: 0,
            dwellSeconds: 0,
            anchorStartMinute: 18 * 60 + 57 + 3.1,
          },
        ],
      },
    ];
    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [st],
      maxDelaySeconds: 120,
      minimumRecoveryTimeSeconds: 0,
    });
    const collisions = findStationBerthCollisions(
      collectStationBerthOccupancies(repaired.timelines, [st]),
      [st],
    );
    assert.equal(collisions.length, 0, 'must delay even if charging is tightly after');
  });

  it('after topology reassign, pushes next same-row trip so timelines do not overlap', () => {
    const tn = route({
      instanceId: 'sel-tn',
      routeId: 'tn',
      routeCode: 'TN',
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
      executionOrder: 1,
    });
    const nt = route({
      instanceId: 'sel-nt',
      routeId: 'nt',
      routeCode: 'NT',
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
      executionOrder: 2,
    });
    const tnb = route({
      instanceId: 'sel-tnb',
      routeId: 'tnb',
      routeCode: 'TNB',
      backupForInstanceId: 'sel-tn',
      stationIds: ['T3U', 'P2'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3U', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'P2', stationName: 'P2', dwellSeconds: 100 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'P2',
          avgTravelTimeSeconds: 80,
          minTravelTimeSeconds: 70,
        },
      ],
      avgTravelTimeSeconds: 80,
      minTravelTimeSeconds: 70,
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
            id: 'nt',
            timelineRow: 1,
            plannedStartMinute: 100.5 + 2,
            plannedEndMinute: 100.5 + 5,
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
      minimumRecoveryTimeSeconds: 0,
      successorPolicy: graphPolicy([tn, nt]),
    });
    const byId = new Map(
      repaired.timelines.flatMap((t) => t.blocks).map((b) => [b.id, b] as const),
    );
    const first = byId.get('tn')!;
    const second = byId.get('nt')!;
    assert.ok(
      first.plannedEndMinute <= second.plannedStartMinute + 1e-9,
      `expected no overlap: end ${first.plannedEndMinute} vs start ${second.plannedStartMinute}`,
    );
  });

  it('fixture TN1120/ST1300: same-second dual-row origin overlap is delayed clear', () => {
    const tn = route({
      routeId: 'tn',
      routeCode: 'TN',
      stationIds: ['T3U', 'N2W'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'N2W', stationName: 'N2W下行出發', dwellSeconds: 10 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'N2W',
          avgTravelTimeSeconds: 160,
          minTravelTimeSeconds: 160,
        },
      ],
      avgTravelTimeSeconds: 160,
      minTravelTimeSeconds: 160,
    });
    // 兩列同一秒發車（11:20:00 量級）：與報表 TN1120 時間線 3/4 同秒重疊同構
    const startMin = 11 * 60 + 20;
    const durations = 170 / 60;
    const timelines = [
      {
        row: 3,
        blocks: [
          block({
            id: 'row3',
            timelineRow: 3,
            plannedStartMinute: startMin,
            plannedEndMinute: startMin + durations,
            routeId: 'tn',
            routeCode: 'TN',
            travelSeconds: 160,
            dwellSeconds: 10,
          }),
        ],
      },
      {
        row: 4,
        blocks: [
          block({
            id: 'row4',
            timelineRow: 4,
            plannedStartMinute: startMin,
            plannedEndMinute: startMin + durations,
            routeId: 'tn',
            routeCode: 'TN',
            travelSeconds: 160,
            dwellSeconds: 10,
          }),
        ],
      },
    ];

    const before = findStationBerthCollisions(
      collectStationBerthOccupancies(timelines, [tn]),
      [tn],
    );
    assert.ok(before.length > 0, 'fixture must start with a collision');

    const repaired = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      maxDelaySeconds: 120,
    });
    const after = findStationBerthCollisions(
      collectStationBerthOccupancies(repaired.timelines, [tn]),
      [tn],
    );
    assert.equal(after.length, 0);
    const row4 = repaired.timelines
      .flatMap((t) => t.blocks)
      .find((b) => b.id === 'row4')!;
    assert.ok(row4.plannedStartMinute > startMin);
  });

  it('fixture: densify/yield-style re-overlap is cleared by final WAIT pass', () => {
    const tn = route({
      routeId: 'tn',
      routeCode: 'TN',
      stationIds: ['T3U', 'N2W'],
      stationDwells: [
        { stationId: 'T3U', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'N2W', stationName: 'N2W下行出發', dwellSeconds: 10 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'T3U',
          toStationId: 'N2W',
          avgTravelTimeSeconds: 160,
          minTravelTimeSeconds: 160,
        },
      ],
      avgTravelTimeSeconds: 160,
      minTravelTimeSeconds: 160,
    });
    const startMin = 13 * 60;
    const durations = 170 / 60;
    let timelines = [
      {
        row: 5,
        blocks: [
          block({
            id: 'r5',
            timelineRow: 5,
            plannedStartMinute: startMin,
            plannedEndMinute: startMin + durations,
            routeId: 'tn',
            routeCode: 'TN',
            travelSeconds: 160,
            dwellSeconds: 10,
          }),
        ],
      },
      {
        row: 6,
        blocks: [
          block({
            id: 'r6',
            timelineRow: 6,
            plannedStartMinute: startMin,
            plannedEndMinute: startMin + durations,
            routeId: 'tn',
            routeCode: 'TN',
            travelSeconds: 160,
            dwellSeconds: 10,
          }),
        ],
      },
    ];

    timelines = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      maxDelaySeconds: 120,
    }).timelines;
    assert.equal(
      findStationBerthCollisions(collectStationBerthOccupancies(timelines, [tn]), [tn])
        .length,
      0,
    );

    // 模擬後處理把兩班又推回同秒（densify／yield／push 的副作用）
    for (const timeline of timelines) {
      for (const b of timeline.blocks) {
        b.plannedStartMinute = startMin;
        b.plannedEndMinute = startMin + durations;
      }
    }
    assert.ok(
      findStationBerthCollisions(collectStationBerthOccupancies(timelines, [tn]), [tn])
        .length > 0,
    );

    timelines = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      maxDelaySeconds: STATION_BERTH_WAIT_MAX_DELAY_SECONDS,
    }).timelines;
    assert.equal(
      findStationBerthCollisions(collectStationBerthOccupancies(timelines, [tn]), [tn])
        .length,
      0,
      'final WAIT berth pass must clear reintroduced same-second overlap',
    );
  });
});

describe('碰撞保護時間（生成期求解）', () => {
  const tn = route({ routeId: 'tn', routeCode: 'TN' });

  /**
   * 兩台不同車。路線 A（不停靠）→ P1（停 50 秒），行駛 120 秒。
   * 前車 60:00 發車、62:00 到 P1、62:50 離開；後車 61:20 發車、63:20 到 P1。
   * 兩者只差 30 秒——區間沒重疊，但不夠 2×30＝60 秒。
   */
  function tightPair() {
    return [
      {
        row: 1,
        blocks: [
          block({
            id: 'earlier',
            timelineRow: 1,
            plannedStartMinute: 60,
            plannedEndMinute: 60 + 170 / 60,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'later',
            timelineRow: 2,
            plannedStartMinute: 60 + 80 / 60,
            plannedEndMinute: 60 + 80 / 60 + 170 / 60,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
    ];
  }

  function laterStartSecond(timelines: ReturnType<typeof tightPair>): number {
    const later = timelines
      .flatMap((timeline) => timeline.blocks)
      .find((candidate) => candidate.id === 'later')!;
    return Math.round(later.plannedStartMinute * 60);
  }

  it('關閉時不動——區間本來就沒重疊', () => {
    const timelines = tightPair();
    const before = laterStartSecond(timelines);
    const solved = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      maxDelaySeconds: 300,
    });
    assert.equal(solved.delayedCount, 0);
    assert.equal(laterStartSecond(solved.timelines), before);
  });

  it('開啟時把後車延後到滿足 2×碰撞保護時間', () => {
    const timelines = tightPair();
    const before = laterStartSecond(timelines);
    const solved = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      collisionProtectionSeconds: 30,
      maxDelaySeconds: 300,
    });
    assert.equal(solved.delayedCount, 1);
    // 原本只隔 30 秒，補到 60 秒＝再往後 30 秒
    assert.equal(laterStartSecond(solved.timelines) - before, 30);

    const after = findStationBerthCollisions(
      collectStationBerthOccupancies(solved.timelines, [tn], {
        collisionProtectionSeconds: 30,
      }),
      [tn],
    );
    assert.equal(after.length, 0, '延後後不應再有保護不足');
  });
  it('同一台車自己折返不受碰撞保護——不會被自己的前一趟擋住', () => {
    // 同一列（同一台車）：60:00 出發，62:00 到 P1，62:50 靠站結束，
    // 63:20 從 P1 開下一趟回程——只隔 30 秒，但這是同一台車在折返站交接，
    // 不可能自己撞自己，不該被要求隔 2×30＝60 秒。
    const tnBack = route({
      routeId: 'tn-back',
      routeCode: 'TNB',
      executionOrder: 2,
      stationIds: ['P1', 'A'],
      stationDwells: [
        { stationId: 'P1', stationName: 'P1停靠點', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'A', stationName: 'A', dwellSeconds: 50 },
      ],
      stationLegTravels: [
        {
          fromStationId: 'P1',
          toStationId: 'A',
          avgTravelTimeSeconds: 120,
          minTravelTimeSeconds: 100,
        },
      ],
    });
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'outbound',
            timelineRow: 1,
            plannedStartMinute: 60,
            plannedEndMinute: 60 + 170 / 60,
            routeId: 'tn',
            routeCode: 'TN',
          }),
          block({
            id: 'inbound',
            timelineRow: 1,
            plannedStartMinute: 60 + 200 / 60,
            plannedEndMinute: 60 + 200 / 60 + 170 / 60,
            routeId: 'tn-back',
            routeCode: 'TNB',
            routeInstanceId: 'tn-back',
          }),
        ],
      },
    ];
    const solved = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn, tnBack],
      collisionProtectionSeconds: 30,
      maxDelaySeconds: 300,
    });
    assert.equal(solved.delayedCount, 0, '同一台車折返不該被碰撞保護延後');
    const inbound = solved.timelines
      .flatMap((timeline) => timeline.blocks)
      .find((candidate) => candidate.id === 'inbound')!;
    assert.equal(Math.round(inbound.plannedStartMinute * 60), 60 * 60 + 200);
  });

  it('求解器不得因「別列車在末站滯留」而延後班次——那會毀掉班距', () => {
    // row1 的車 62:50 靠站結束，但下一個任務要到 70:00 才開始，中間滯留 7 分鐘。
    // row2 的車 64:00 到 P1——已經超過 row1 自然離站 62:50 + 2×30 秒保護，
    // 依「排點只看 2×保護時間」的規則不該被延後。
    //
    // 若把滯留佔用也當成排點約束，row2 會被推到 71:00 之後；densify 因此拉不動
    // 任何班次，實測會讓 600 秒規則班距崩成 00:30→00:52→01:02→01:27。
    // 滯留改由最終驗證回報、由整備後調度班次與站位讓渡實際處理。
    const timelines = [
      {
        row: 1,
        blocks: [
          block({
            id: 'idler',
            timelineRow: 1,
            plannedStartMinute: 60,
            plannedEndMinute: 60 + 170 / 60,
            routeId: 'tn',
            routeCode: 'TN',
          }),
          {
            id: 'idler-next',
            timelineRow: 1,
            taskType: 'charging' as const,
            label: '充電',
            source: 'template_bar' as const,
            plannedStartMinute: 70,
            plannedEndMinute: 100,
            anchorStartMinute: 70,
            travelSeconds: 0,
            dwellSeconds: 0,
          } as GeneratedScheduleBlock,
        ],
      },
      {
        row: 2,
        blocks: [
          block({
            id: 'follower',
            timelineRow: 2,
            plannedStartMinute: 62,
            plannedEndMinute: 62 + 170 / 60,
            routeId: 'tn',
            routeCode: 'TN',
          }),
        ],
      },
    ];

    const solved = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: [tn],
      collisionProtectionSeconds: 30,
      maxDelaySeconds: 1800,
    });

    const follower = solved.timelines
      .flatMap((timeline) => timeline.blocks)
      .find((candidate) => candidate.id === 'follower')!;
    assert.equal(
      Math.round(follower.plannedStartMinute * 60),
      62 * 60,
      '不該因為前車滯留而被延後',
    );
    assert.equal(solved.delayedCount, 0);
  });
});
