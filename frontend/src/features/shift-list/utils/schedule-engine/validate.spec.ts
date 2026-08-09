import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import type { RouteSuccessorPolicy } from './routeSuccessorPolicy';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './types';
import {
  validateRouteSuccessorContinuity,
  validateRouteSwitchBuffers,
  validateStationTimingsWithinBlocks,
  validateTimelineOverlaps,
} from './validate';

function expect<T>(actual: T) {
  return {
    toEqual(expected: unknown) {
      assert.deepEqual(actual, expected);
    },
    toContain(expected: unknown) {
      assert.ok(
        Array.isArray(actual) && actual.includes(expected),
        `Expected ${JSON.stringify(actual)} to contain ${String(expected)}`,
      );
    },
    toMatchObject(expected: Record<string, unknown>) {
      assert.ok(actual && typeof actual === 'object');
      const picked = Object.fromEntries(
        Object.keys(expected).map((key) => [
          key,
          (actual as Record<string, unknown>)[key],
        ]),
      );
      assert.deepEqual(picked, expected);
    },
  };
}

function route(
  instanceId: string,
  routeId: string,
  routeCode: string,
  origin: string,
  terminal: string,
): ShiftScheduleSelectedRoute {
  return {
    instanceId,
    routeId,
    routeName: routeCode,
    routeCode,
    groupId: 'g',
    groupName: 'g',
    executionOrder: 1,
    avgTravelTimeSeconds: 60,
    minTravelTimeSeconds: 60,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
    stationIds: [origin, terminal],
    stationDwells: [origin, terminal].map((stationId) => ({
      stationId,
      stationName: stationId,
      dwellSeconds: 0,
      dwellMode: 'manual' as const,
      dwellRequired: true,
    })),
    stationLegTravels: [],
    stationDwellsConfirmed: true,
    backupForInstanceId: null,
    backupForRouteId: null,
  };
}

function block(
  id: string,
  selected: ShiftScheduleSelectedRoute,
  start: number,
): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: 1,
    taskType: 'passenger',
    label: selected.routeCode,
    routeId: selected.routeId,
    routeInstanceId: selected.instanceId,
    routeName: selected.routeName,
    routeCode: selected.routeCode,
    anchorStartMinute: start,
    plannedStartMinute: start,
    plannedEndMinute: start + 1,
    travelSeconds: 60,
    dwellSeconds: 0,
    source: 'template_bar',
  };
}

function plan(blocks: GeneratedScheduleBlock[]): GeneratedSchedulePlan['timelines'] {
  return [{ row: 1, blocks }];
}

function graphPolicy(
  routes: ShiftScheduleSelectedRoute[],
  successors: Array<[string, string]>,
): RouteSuccessorPolicy {
  return {
    algorithm: 'relation-graph-through-anchors-v1',
    valid: true,
    routesByInstanceId: new Map(routes.map((item) => [item.instanceId!, item])),
    rotationRoutes: routes,
    prioritySuccessors: new Map(
      successors.map(([from, to]) => [from, [to]]),
    ),
    secondarySuccessors: new Map(),
    startInstanceIds: [routes[0]!.instanceId!],
    endInstanceIds: new Set(),
    canonicalCycleInstanceIds: routes.map((item) => item.instanceId!),
    throughCycles: [],
  };
}

describe('validateRouteSuccessorContinuity', () => {
  for (const [fromCode, terminal, toCode, origin] of [
    ['TNB', 'P2', 'NT', 'P1'],
    ['TSB', 'P3', 'TS', 'T3'],
  ]) {
    it(`rejects station discontinuity ${fromCode}(${terminal}) -> ${toCode}(${origin})`, () => {
      const from = route('from', 'from-route', fromCode, 'START', terminal);
      const to = route('to', 'to-route', toCode, origin, 'END');
      const errors: FeasibilityIssue[] = [];

      validateRouteSuccessorContinuity(
        plan([block('b1', from, 0), block('b2', to, 2)]),
        [from, to],
        errors,
        graphPolicy([from, to], [['from', 'to']]),
      );

      expect(errors.map((issue) => issue.code)).toContain(
        'ROUTE_STATION_DISCONTINUITY',
      );
    });
  }

  it('validates graph successor by instanceId rather than routeId', () => {
    const first = route('same-1', 'same-route', 'R1', 'P1', 'P2');
    const expected = route('same-2', 'same-route', 'R2', 'P2', 'P3');
    const actual = route('other', 'other-route', 'R3', 'P2', 'P4');
    const errors: FeasibilityIssue[] = [];

    validateRouteSuccessorContinuity(
      plan([block('b1', first, 0), block('b2', actual, 2)]),
      [first, expected, actual],
      errors,
      graphPolicy(
        [first, expected, actual],
        [['same-1', 'same-2']],
      ),
    );

    expect(errors.find((issue) => issue.code === 'ROUTE_SUCCESSOR_MISMATCH')?.detail)
      .toMatchObject({
        fromInstanceId: 'same-1',
        expectedInstanceId: 'same-2',
        actualInstanceId: 'other',
      });
  });

  it('reports ambiguity when a legacy block has only a duplicated routeId', () => {
    const first = route('same-1', 'same-route', 'R1', 'P1', 'P2');
    const second = route('same-2', 'same-route', 'R2', 'P2', 'P3');
    const legacy = block('legacy', first, 0);
    delete legacy.routeInstanceId;
    const errors: FeasibilityIssue[] = [];

    validateRouteSuccessorContinuity(
      plan([legacy, block('next', second, 2)]),
      [first, second],
      errors,
      graphPolicy([first, second], [['same-1', 'same-2']]),
    );

    expect(errors.map((issue) => issue.code)).toContain(
      'ROUTE_INSTANCE_AMBIGUOUS',
    );
  });

  it('skips successor checks when charging/servicing sits between passenger trips', () => {
    const st = route('st', 'route-st', 'ST', 'P4', 'T3');
    const tn = route('tn', 'route-tn', 'TN', 'T3', 'N');
    const nt = route('nt', 'route-nt', 'NT', 'N', 'T3');
    const earlier = block('b-st', st, 0);
    earlier.plannedEndMinute = 1;
    const later = block('b-nt', nt, 30);
    const charging: GeneratedScheduleBlock = {
      id: 'chg',
      timelineRow: 1,
      taskType: 'charging',
      label: '充電',
      anchorStartMinute: 1,
      plannedStartMinute: 1,
      plannedEndMinute: 30,
      travelSeconds: 0,
      dwellSeconds: 0,
      source: 'template_bar',
    };
    const errors: FeasibilityIssue[] = [];

    validateRouteSuccessorContinuity(
      [{ row: 1, blocks: [earlier, charging, later] }],
      [st, tn, nt],
      errors,
      graphPolicy([st, tn, nt], [['st', 'tn'], ['tn', 'nt'], ['nt', 'st']]),
    );

    assert.equal(
      errors.filter((issue) => issue.code === 'ROUTE_SUCCESSOR_MISMATCH').length,
      0,
    );
    assert.equal(
      errors.filter((issue) => issue.code === 'ROUTE_STATION_DISCONTINUITY').length,
      0,
    );
  });

  it('raises a fatal issue for an invalid configured graph', () => {
    const selected = route('r1', 'route-1', 'R1', 'P1', 'P2');
    const errors: FeasibilityIssue[] = [];
    const policy: RouteSuccessorPolicy = {
      ...graphPolicy([selected], []),
      algorithm: 'invalid-relation-graph-v1',
      valid: false,
      issue: 'THROUGH_VERIFICATION_INVALID',
      rotationRoutes: [],
    };

    validateRouteSuccessorContinuity([], [selected], errors, policy);

    expect(errors.map((issue) => issue.code)).toEqual([
      'ROUTE_SUCCESSOR_POLICY_INVALID',
    ]);
  });

  it('uses supplied rotation order instead of executionOrder for recovery', () => {
    const first = route('first', 'route-1', 'R1', 'P1', 'P2');
    const second = route('second', 'route-2', 'R2', 'P2', 'P3');
    first.executionOrder = 2;
    second.executionOrder = 1;
    const firstBlock = block('b1', first, 0);
    firstBlock.plannedEndMinute = 1;
    const secondBlock = block('b2', second, 1);
    const errors: FeasibilityIssue[] = [];

    validateRouteSwitchBuffers(
      plan([firstBlock, secondBlock]),
      new Map([
        [first.routeId, first],
        [second.routeId, second],
      ]),
      errors,
      60,
      [first, second],
    );

    expect(errors).toEqual([]);
  });
});

describe('validateStationTimingsWithinBlocks', () => {
  it('reports when minimum leg travel cannot fit inside block end', () => {
    const selected = route('timing', 'timing-route', 'TIME', 'P1', 'P2');
    const tooShort = block('short', selected, 0);
    tooShort.plannedEndMinute = 0.5;
    const errors: FeasibilityIssue[] = [];

    validateStationTimingsWithinBlocks(plan([tooShort]), [selected], errors);

    expect(errors.map((issue) => issue.code)).toContain(
      'STATION_TIMING_INFEASIBLE',
    );
  });
});

describe('validateTimelineOverlaps', () => {
  it('0 秒的示意卡（開始＝結束）落在下一段的起點上，不算重疊', () => {
    // 整備間轉場同一區域時是 0 秒示意轉移，常常剛好落在下一段本來就佔用的
    // 那一刻（例如前段整備跟後段整備原本零間隔銜接）——這不是真的撞了。
    const errors: FeasibilityIssue[] = [];
    const blocks: GeneratedScheduleBlock[] = [
      {
        id: 'maint-1',
        timelineRow: 1,
        taskType: 'servicing',
        label: '保養',
        anchorStartMinute: 0,
        plannedStartMinute: 0,
        plannedEndMinute: 570,
        travelSeconds: 0,
        dwellSeconds: 0,
        source: 'template_bar',
      },
      {
        id: 'zero-out',
        timelineRow: 1,
        taskType: 'dispatch',
        label: '整備出廠 · M1 → H1',
        anchorStartMinute: 570,
        plannedStartMinute: 570,
        plannedEndMinute: 570,
        travelSeconds: 0,
        dwellSeconds: 0,
        source: 'yard_exit_move',
      },
      {
        id: 'zero-in',
        timelineRow: 1,
        taskType: 'dispatch',
        label: '整備入廠 · M1 → H1',
        anchorStartMinute: 570,
        plannedStartMinute: 570,
        plannedEndMinute: 570,
        travelSeconds: 0,
        dwellSeconds: 0,
        source: 'yard_entry_move',
      },
      {
        id: 'pretrip-1',
        timelineRow: 1,
        taskType: 'inspection',
        label: '行前',
        anchorStartMinute: 570,
        plannedStartMinute: 570,
        plannedEndMinute: 600,
        travelSeconds: 0,
        dwellSeconds: 0,
        source: 'template_bar',
      },
    ];

    validateTimelineOverlaps(plan(blocks), errors);

    expect(errors).toEqual([]);
  });

  it('真的有時長的兩段重疊時仍要照常回報', () => {
    const errors: FeasibilityIssue[] = [];
    const selected = route('overlap', 'overlap-route', 'OV', 'P1', 'P2');
    const first = block('first', selected, 0);
    first.plannedEndMinute = 10;
    const second = block('second', selected, 5);
    second.plannedEndMinute = 15;

    validateTimelineOverlaps(plan([first, second]), errors);

    expect(errors.map((issue) => issue.code)).toContain('TIMELINE_OVERLAP');
  });
});
