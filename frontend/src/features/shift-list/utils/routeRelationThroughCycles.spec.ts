import { describe, expect, it } from 'vitest';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  buildThroughStationMenuGroups,
  buildThroughVerificationFingerprint,
  collectThroughStationOptions,
  computeRouteThroughPaths,
  isThroughVerificationCurrent,
  resolvePreferredThroughCycle,
} from './routeRelationThroughCycles';
import type { ShiftRouteRelationGraph } from './routeRelationGraph';

function makeRoute(
  partial: Partial<ShiftScheduleSelectedRoute> & {
    instanceId: string;
    routeId: string;
    stationIds: string[];
    stationNames?: string[];
  },
): ShiftScheduleSelectedRoute {
  return {
    routeName: partial.routeName ?? partial.routeId,
    routeCode: partial.routeCode ?? partial.routeId,
    groupId: 'g',
    groupName: 'g',
    executionOrder: partial.executionOrder ?? 1,
    avgTravelTimeSeconds: partial.avgTravelTimeSeconds ?? 100,
    minTravelTimeSeconds: partial.minTravelTimeSeconds ?? 80,
    switchBufferAfterSeconds: partial.switchBufferAfterSeconds ?? 0,
    dwellSlackSeconds: partial.dwellSlackSeconds ?? 0,
    stationDwells: partial.stationIds.map((stationId, index) => ({
      stationId,
      stationName: partial.stationNames?.[index] ?? stationId,
      dwellSeconds: 10,
      dwellMode: 'manual' as const,
      dwellRequired: true,
    })),
    stationLegTravels: [],
    stationDwellsConfirmed: true,
    backupForInstanceId: null,
    backupForRouteId: null,
    ...partial,
  };
}

describe('collectThroughStationOptions grouping', () => {
  it('groups backup up/down and facility docking separately', () => {
    const options = collectThroughStationOptions([
      makeRoute({
        instanceId: 'A',
        routeId: 'A',
        stationIds: ['s1', 's2', 'fdock:p1'],
        stationNames: [
          '[備用]N2W上行停靠',
          '[備用]S2W下行出發',
          'P1停靠點',
        ],
      }),
    ]);
    const groups = buildThroughStationMenuGroups(options);
    expect(groups.map((g) => g.label)).toEqual([
      '備用 · 上行',
      '備用 · 下行',
      '設施停靠點',
    ]);
  });
});

describe('computeRouteThroughPaths', () => {
  const routes = [
    makeRoute({
      instanceId: 'A',
      routeId: 'A',
      routeCode: 'A',
      stationIds: ['P1', 'S2'],
      executionOrder: 1,
    }),
    makeRoute({
      instanceId: 'B',
      routeId: 'B',
      routeCode: 'B',
      stationIds: ['S2', 'S3'],
      executionOrder: 2,
    }),
    makeRoute({
      instanceId: 'C',
      routeId: 'C',
      routeCode: 'C',
      stationIds: ['S3', 'P2'],
      executionOrder: 3,
    }),
    makeRoute({
      instanceId: 'D',
      routeId: 'D',
      routeCode: 'D',
      stationIds: ['S2', 'P2'],
      executionOrder: 4,
    }),
    makeRoute({
      instanceId: 'F',
      routeId: 'F',
      routeCode: 'F',
      stationIds: ['S2', 'P2'],
      executionOrder: 6,
      minTravelTimeSeconds: 90,
      avgTravelTimeSeconds: 110,
    }),
    makeRoute({
      instanceId: 'E',
      routeId: 'E',
      routeCode: 'E',
      stationIds: ['P2', 'P1'],
      executionOrder: 5,
    }),
  ];

  const graph: ShiftRouteRelationGraph = {
    nodes: routes.map((route, index) => ({
      instanceId: route.instanceId,
      x: index * 10,
      y: 0,
    })),
    links: [
      { id: 'A-B', fromInstanceId: 'A', toInstanceId: 'B', nextKind: 'priority' },
      { id: 'B-C', fromInstanceId: 'B', toInstanceId: 'C', nextKind: 'priority' },
      { id: 'A-D', fromInstanceId: 'A', toInstanceId: 'D', nextKind: 'secondary' },
      { id: 'A-F', fromInstanceId: 'A', toInstanceId: 'F', nextKind: 'priority' },
      { id: 'D-E', fromInstanceId: 'D', toInstanceId: 'E', nextKind: 'secondary' },
      { id: 'C-E', fromInstanceId: 'C', toInstanceId: 'E', nextKind: 'priority' },
    ],
  };

  it('keeps shortest paths to first end and does not extend past an end', () => {
    const paths = computeRouteThroughPaths({
      startStationIds: ['P1', 'P2'],
      endStationIds: ['P1', 'P2'],
      routes,
      graph,
      minimumRecoveryTimeSeconds: 0,
    });

    const labels = paths.map((p) => p.labels.join('→'));
    expect(labels).toContain('A→D');
    expect(labels).toContain('A→F');
    expect(labels).not.toContain('A→B→C');
    expect(labels).not.toContain('A→D→E');
    expect(labels).toContain('E');
  });

  it('sorts secondary-containing above all-priority', () => {
    const paths = computeRouteThroughPaths({
      startStationIds: ['P1'],
      endStationIds: ['P2'],
      routes,
      graph,
    });
    expect(paths.map((p) => p.labels.join('→')).sort()).toEqual(['A→D', 'A→F'].sort());
    expect(paths[0]?.secondaryCount).toBeGreaterThan(0);
    expect(paths[paths.length - 1]?.secondaryCount).toBe(0);
  });
});

describe('through verification fingerprint gate', () => {
  const routes = [
    makeRoute({
      instanceId: 'A',
      routeId: 'A',
      stationIds: ['P1', 'P2'],
      executionOrder: 1,
    }),
  ];
  const graph: ShiftRouteRelationGraph = {
    nodes: [{ instanceId: 'A', x: 0, y: 0 }],
    links: [],
  };

  it('requires matching fingerprint and positive path count', () => {
    const fingerprint = buildThroughVerificationFingerprint({
      startStationIds: ['P1'],
      endStationIds: ['P2'],
      routes,
      graph,
      minimumRecoveryTimeSeconds: 30,
    });
    expect(
      isThroughVerificationCurrent({
        anchors: {
          startStationIds: ['P1'],
          endStationIds: ['P2'],
          startInstanceIds: [],
          endInstanceIds: [],
          verifiedFingerprint: fingerprint,
          verifiedPathCount: 1,
          preferredThroughCycleId: null,
          listedThroughCycles: [],
          listedFingerprint: null,
        },
        routes,
        graph,
        minimumRecoveryTimeSeconds: 30,
      }),
    ).toBe(true);
    expect(
      isThroughVerificationCurrent({
        anchors: {
          startStationIds: ['P1'],
          endStationIds: ['P2'],
          startInstanceIds: [],
          endInstanceIds: [],
          verifiedFingerprint: fingerprint,
          verifiedPathCount: 1,
          preferredThroughCycleId: null,
          listedThroughCycles: [],
          listedFingerprint: null,
        },
        routes,
        graph,
        minimumRecoveryTimeSeconds: 60,
      }),
    ).toBe(false);
    expect(
      isThroughVerificationCurrent({
        anchors: {
          startStationIds: ['P1'],
          endStationIds: ['P2'],
          startInstanceIds: [],
          endInstanceIds: [],
          verifiedFingerprint: fingerprint,
          verifiedPathCount: 0,
          preferredThroughCycleId: null,
          listedThroughCycles: [],
          listedFingerprint: null,
        },
        routes,
        graph,
        minimumRecoveryTimeSeconds: 30,
      }),
    ).toBe(false);
  });
});

describe('resolvePreferredThroughCycle', () => {
  const cycles = [
    {
      id: 'slow-priority',
      instanceIds: ['A', 'B'],
      labels: ['A', 'B'],
      startStationId: 's1',
      startStationName: 's1',
      endStationId: 's2',
      endStationName: 's2',
      hopCount: 2,
      secondaryCount: 0,
      linkKinds: ['priority' as const],
      minTravelSeconds: 100,
      avgTravelSeconds: 110,
      dwellSeconds: 10,
      switchBufferSeconds: 0,
      recoverySeconds: 30,
      minCycleSeconds: 200,
      avgCycleSeconds: 220,
    },
    {
      id: 'fast-secondary',
      instanceIds: ['A', 'D'],
      labels: ['A', 'D'],
      startStationId: 's1',
      startStationName: 's1',
      endStationId: 's3',
      endStationName: 's3',
      hopCount: 2,
      secondaryCount: 1,
      linkKinds: ['secondary' as const],
      minTravelSeconds: 80,
      avgTravelSeconds: 90,
      dwellSeconds: 10,
      switchBufferSeconds: 0,
      recoverySeconds: 30,
      minCycleSeconds: 150,
      avgCycleSeconds: 160,
    },
  ];

  it('defaults to fastest full-priority cycle', () => {
    expect(resolvePreferredThroughCycle(cycles, null)?.id).toBe('slow-priority');
  });

  it('honors explicit preferred id including secondary', () => {
    expect(resolvePreferredThroughCycle(cycles, 'fast-secondary')?.id).toBe(
      'fast-secondary',
    );
  });
});
