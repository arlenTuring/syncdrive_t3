import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  buildThroughVerificationFingerprint,
  type ShiftRouteThroughAnchorsDraft,
} from '../routeRelationThroughCycles';
import type { ShiftRouteRelationGraph } from '../routeRelationGraph';
import {
  buildRouteSuccessorPolicy,
  resolveNextInstanceId,
  resolveStartInstanceId,
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH,
  ROUTE_SUCCESSOR_ALGORITHM_RING,
  routeAssignmentAlgorithmId,
} from './routeSuccessorPolicy';

function expect<T>(actual: T) {
  return {
    toBe(expected: unknown) {
      assert.equal(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepEqual(actual, expected);
    },
    toBeNull() {
      assert.equal(actual, null);
    },
  };
}

function makeRoute(
  partial: Partial<ShiftScheduleSelectedRoute> & {
    instanceId: string;
    routeId: string;
    stationIds: string[];
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
    stationDwells: partial.stationIds.map((stationId) => ({
      stationId,
      stationName: stationId,
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

describe('buildRouteSuccessorPolicy', () => {
  const routes = [
    makeRoute({
      instanceId: 'A',
      routeId: 'A',
      stationIds: ['P1', 'S2'],
      executionOrder: 1,
    }),
    makeRoute({
      instanceId: 'B',
      routeId: 'B',
      stationIds: ['S2', 'P2'],
      executionOrder: 2,
    }),
    makeRoute({
      instanceId: 'D',
      routeId: 'D',
      stationIds: ['S2', 'P1'],
      executionOrder: 3,
    }),
  ];

  const graph: ShiftRouteRelationGraph = {
    nodes: [
      { instanceId: 'A', x: 0, y: 0 },
      { instanceId: 'B', x: 1, y: 0 },
      { instanceId: 'D', x: 0, y: 1 },
    ],
    links: [
      {
        id: 'A-B',
        fromInstanceId: 'A',
        toInstanceId: 'B',
        nextKind: 'priority',
      },
      {
        id: 'A-D',
        fromInstanceId: 'A',
        toInstanceId: 'D',
        nextKind: 'secondary',
      },
    ],
  };

  it('rejects a configured graph whose through verification is not current', () => {
    const policy = buildRouteSuccessorPolicy({
      routes,
      graph,
      throughAnchors: {
        startStationIds: ['P1'],
        endStationIds: ['P1', 'P2'],
        startInstanceIds: [],
        endInstanceIds: [],
        verifiedFingerprint: null,
        verifiedPathCount: 0,
        preferredThroughCycleId: null,
        listedThroughCycles: [],
        listedFingerprint: null,
      },
      minimumRecoveryTimeSeconds: 30,
    });
    expect(policy.algorithm).toBe(ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH);
    expect(policy.valid).toBe(false);
    expect(policy.issue).toBe('THROUGH_VERIFICATION_INVALID');
    expect(policy.rotationRoutes).toEqual([]);
    expect(resolveNextInstanceId(policy, 'A')).toBeNull();
    expect(routeAssignmentAlgorithmId(policy)).toBe(
      'route-assignment-invalid-relation-graph-v1',
    );
  });

  it('keeps execution-order ring compatibility only when no graph exists', () => {
    const policy = buildRouteSuccessorPolicy({
      routes,
      graph: { nodes: [], links: [] },
      minimumRecoveryTimeSeconds: 30,
    });

    expect(policy.algorithm).toBe(ROUTE_SUCCESSOR_ALGORITHM_RING);
    expect(policy.valid).toBe(true);
    expect(policy.rotationRoutes.map((r) => r.routeId)).toEqual(['A', 'B', 'D']);
    expect(routeAssignmentAlgorithmId(policy)).toBe('constraint-greedy-v1');
  });

  it('uses canonical through cycle when verification is current', () => {
    const anchors: ShiftRouteThroughAnchorsDraft = {
      startStationIds: ['P1'],
      endStationIds: ['P1', 'P2'],
      startInstanceIds: [],
      endInstanceIds: [],
      verifiedFingerprint: null,
      verifiedPathCount: 0,
      preferredThroughCycleId: null,
      listedThroughCycles: [],
      listedFingerprint: null,
    };
    anchors.verifiedFingerprint = buildThroughVerificationFingerprint({
      startStationIds: anchors.startStationIds,
      endStationIds: anchors.endStationIds,
      routes,
      graph,
      minimumRecoveryTimeSeconds: 30,
    });
    anchors.verifiedPathCount = 1;

    const policy = buildRouteSuccessorPolicy({
      routes,
      graph,
      throughAnchors: anchors,
      minimumRecoveryTimeSeconds: 30,
    });

    expect(policy.algorithm).toBe(ROUTE_SUCCESSOR_ALGORITHM_GRAPH);
    // 未指定偏好時鎖定全優先 A→B；含次要的 A→D 仍列在診斷用 throughCycles
    expect(policy.canonicalCycleInstanceIds).toEqual(['A', 'B']);
    expect(policy.rotationRoutes.map((r) => r.routeId)).toEqual(['A', 'B']);
    expect(policy.throughCycles.some((c) => c.secondaryCount === 0)).toBe(true);
    expect(resolveStartInstanceId(policy)).toBe('A');
    expect(resolveNextInstanceId(policy, 'A')?.instanceId).toBe('B');
    // 次要連線在 allowSecondary 時可用
    expect(resolveNextInstanceId(policy, 'A', { allowSecondary: true })?.instanceId).toBe('B');
    expect(resolveNextInstanceId(policy, 'A', { allowSecondary: true })?.kind).toBe(
      'priority',
    );
    // B 無出邊：不得發明繞回 A
    expect(resolveNextInstanceId(policy, 'B')).toBeNull();
    expect(routeAssignmentAlgorithmId(policy)).toBe(
      'route-assignment-relation-graph-v1',
    );
  });

  it('honors preferredThroughCycleId even when the path uses secondary links', () => {
    const anchors: ShiftRouteThroughAnchorsDraft = {
      startStationIds: ['P1'],
      endStationIds: ['P1', 'P2'],
      startInstanceIds: [],
      endInstanceIds: [],
      verifiedFingerprint: null,
      verifiedPathCount: 0,
      preferredThroughCycleId: null,
      listedThroughCycles: [],
      listedFingerprint: null,
    };
    anchors.verifiedFingerprint = buildThroughVerificationFingerprint({
      startStationIds: anchors.startStationIds,
      endStationIds: anchors.endStationIds,
      routes,
      graph,
      minimumRecoveryTimeSeconds: 30,
    });
    anchors.verifiedPathCount = 2;
    const probing = buildRouteSuccessorPolicy({
      routes,
      graph,
      throughAnchors: anchors,
      minimumRecoveryTimeSeconds: 30,
    });
    const secondary = probing.throughCycles.find((cycle) => cycle.secondaryCount > 0);
    expect(secondary == null).toBe(false);
    anchors.preferredThroughCycleId = secondary!.id;

    const policy = buildRouteSuccessorPolicy({
      routes,
      graph,
      throughAnchors: anchors,
      minimumRecoveryTimeSeconds: 30,
    });

    expect(policy.algorithm).toBe(ROUTE_SUCCESSOR_ALGORITHM_GRAPH);
    expect(policy.canonicalCycleInstanceIds).toEqual(secondary!.instanceIds);
    // 偏好路徑 A→D 的邊為次要，存在於圖上 → 跟偏好
    expect(resolveNextInstanceId(policy, 'A')?.instanceId).toBe('D');
    expect(resolveNextInstanceId(policy, 'A')?.kind).toBe('secondary');
  });

  it('never invents preferred-cycle wrap when the closing edge is missing', () => {
    const longRoutes = [
      makeRoute({
        instanceId: 'NTB',
        routeId: 'NTB',
        stationIds: ['P10', 'P3'],
        executionOrder: 1,
      }),
      makeRoute({
        instanceId: 'TS',
        routeId: 'TS',
        stationIds: ['P3', 'P4'],
        executionOrder: 2,
      }),
      makeRoute({
        instanceId: 'ST',
        routeId: 'ST',
        stationIds: ['P4', 'P1'],
        executionOrder: 3,
      }),
      makeRoute({
        instanceId: 'TN',
        routeId: 'TN',
        stationIds: ['P1', 'P2'],
        executionOrder: 4,
      }),
      makeRoute({
        instanceId: 'NT',
        routeId: 'NT',
        stationIds: ['P2', 'P3'],
        executionOrder: 5,
      }),
    ];
    const longGraph: ShiftRouteRelationGraph = {
      nodes: longRoutes.map((route, i) => ({
        instanceId: route.instanceId!,
        x: i,
        y: 0,
      })),
      links: [
        {
          id: 'NTB-TS',
          fromInstanceId: 'NTB',
          toInstanceId: 'TS',
          nextKind: 'priority',
        },
        {
          id: 'TS-ST',
          fromInstanceId: 'TS',
          toInstanceId: 'ST',
          nextKind: 'priority',
        },
        {
          id: 'ST-TN',
          fromInstanceId: 'ST',
          toInstanceId: 'TN',
          nextKind: 'priority',
        },
        {
          id: 'TN-NT',
          fromInstanceId: 'TN',
          toInstanceId: 'NT',
          nextKind: 'priority',
        },
        {
          id: 'NT-TS',
          fromInstanceId: 'NT',
          toInstanceId: 'TS',
          nextKind: 'priority',
        },
        // 刻意沒有 TN→NTB
      ],
    };
    const anchors: ShiftRouteThroughAnchorsDraft = {
      startStationIds: [],
      endStationIds: [],
      startInstanceIds: ['NTB', 'NT'],
      endInstanceIds: ['TN'],
      verifiedFingerprint: null,
      verifiedPathCount: 0,
      preferredThroughCycleId: null,
      listedThroughCycles: [],
      listedFingerprint: null,
    };
    anchors.verifiedFingerprint = buildThroughVerificationFingerprint({
      startInstanceIds: anchors.startInstanceIds,
      endInstanceIds: anchors.endInstanceIds,
      routes: longRoutes,
      graph: longGraph,
      minimumRecoveryTimeSeconds: 30,
    });
    anchors.verifiedPathCount = 2;
    const probe = buildRouteSuccessorPolicy({
      routes: longRoutes,
      graph: longGraph,
      throughAnchors: anchors,
      minimumRecoveryTimeSeconds: 30,
    });
    const preferred = probe.throughCycles.find(
      (cycle) => cycle.instanceIds.join('>') === 'NTB>TS>ST>TN',
    );
    expect(preferred == null).toBe(false);
    anchors.preferredThroughCycleId = preferred!.id;

    const policy = buildRouteSuccessorPolicy({
      routes: longRoutes,
      graph: longGraph,
      throughAnchors: anchors,
      minimumRecoveryTimeSeconds: 30,
    });

    expect(policy.canonicalCycleInstanceIds).toEqual(['NTB', 'TS', 'ST', 'TN']);
    // 行前出 T3(=P1) → TN；下一跳必須是圖上 TN→NT，不得硬接 NTB
    expect(resolveStartInstanceId(policy, 'P1')).toBe('TN');
    expect(resolveNextInstanceId(policy, 'TN')?.instanceId).toBe('NT');
    assert.notEqual(resolveNextInstanceId(policy, 'TN')?.instanceId, 'NTB');
  });
});
