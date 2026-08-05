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
    // 次要連線不再作為排班走法（未指定偏好時）
    expect(resolveNextInstanceId(policy, 'A', { allowSecondary: true })?.instanceId).toBe('B');
    expect(resolveNextInstanceId(policy, 'A', { allowSecondary: true })?.kind).toBe(
      'priority',
    );
    // B 終站 P2 為折返錨點 → 下一輪回到 A
    expect(resolveNextInstanceId(policy, 'B')?.instanceId).toBe('A');
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
    expect(resolveNextInstanceId(policy, 'A')?.instanceId).toBe('D');
  });
});
