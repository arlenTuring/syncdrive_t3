import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  resolveInterTripGapSeconds,
  resolveOccupancyClampedToTravelBounds,
  resolvePassengerRouteOccupancy,
  routesShareTurnaroundStation,
  shouldIncludeRecoveryForRouteSwitch,
} from './physics';

function route(
  id: string,
  order: number,
  avg: number,
  min: number,
  dwellSeconds: number,
  switchBufferAfterSeconds = 0,
): ShiftScheduleSelectedRoute {
  return {
    routeId: id,
    routeName: id,
    routeCode: id,
    groupId: 'g',
    groupName: 'g',
    instanceId: id,
    stationIds: ['A', 'B'],
    stationDwells: [
      { stationId: 'A', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'B', stationName: 'B', dwellSeconds, dwellRequired: true },
    ],
    stationDwellsConfirmed: true,
    executionOrder: order,
    avgTravelTimeSeconds: avg,
    minTravelTimeSeconds: min,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds,
    stationLegTravels: [],
  };
}

describe('resolvePassengerRouteOccupancy', () => {
  it('uses avg as default plan and min as compress floor', () => {
    const occ = resolvePassengerRouteOccupancy(route('r1', 1, 101, 90, 36));
    assert.ok(occ);
    // 均 101+36=137 → snap↓130；快 90+36=126 → snap↑130
    assert.equal(occ.occupancySeconds, 130);
    assert.equal(occ.minOccupancySeconds, 130);
  });

  it('keeps min below avg when travel differs enough', () => {
    const occ = resolvePassengerRouteOccupancy(route('r1', 1, 200, 100, 30));
    assert.ok(occ);
    // 均 230→230；快 130→130
    assert.equal(occ.occupancySeconds, 230);
    assert.equal(occ.minOccupancySeconds, 130);
  });
});

describe('resolveOccupancyClampedToTravelBounds', () => {
  it('clamps target into [快, 均]', () => {
    const routeA = route('r1', 1, 200, 100, 30);
    assert.equal(resolveOccupancyClampedToTravelBounds(routeA, 500), 230);
    assert.equal(resolveOccupancyClampedToTravelBounds(routeA, 50), 130);
    assert.equal(resolveOccupancyClampedToTravelBounds(routeA, 175), 170);
  });
});

describe('shouldIncludeRecoveryForRouteSwitch / resolveInterTripGapSeconds', () => {
  const rotation = [
    route('r1', 1, 100, 90, 30, 0),
    route('r2', 2, 100, 90, 30, 2),
    route('r3', 3, 100, 90, 30, 0),
    route('r4', 4, 100, 90, 30, 0),
  ];

  it('omits recovery on mid-ring succession; keeps switch buffer', () => {
    assert.equal(
      shouldIncludeRecoveryForRouteSwitch({
        previousRoute: rotation[0]!,
        nextRoute: rotation[1]!,
        rotationRoutes: rotation,
      }),
      false,
    );
    assert.equal(
      resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds: 15,
        previousRouteSwitchBufferSeconds: 2,
        isRouteSwitch: true,
        includeRecovery: false,
      }),
      2,
    );
  });

  it('returns 0 gap when successive routes share the turnaround station', () => {
    const inbound = route('st', 1, 100, 90, 40, 2);
    inbound.stationIds = ['a', 't3'];
    inbound.stationDwells = [
      { stationId: 'a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
      { stationId: 't3', stationName: 'T3', dwellSeconds: 40 },
    ];
    const outbound = route('tn', 2, 100, 90, 40, 0);
    outbound.stationIds = ['t3', 'b'];
    outbound.stationDwells = [
      { stationId: 't3', stationName: 'T3', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'b', stationName: 'B', dwellSeconds: 40 },
    ];
    assert.equal(routesShareTurnaroundStation(inbound, outbound), true);
    assert.equal(
      resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds: 30,
        previousRouteSwitchBufferSeconds: 2,
        isRouteSwitch: true,
        includeRecovery: false,
        previousRoute: inbound,
        nextRoute: outbound,
      }),
      0,
    );
  });

  it('includes recovery when wrapping to first route', () => {
    assert.equal(
      shouldIncludeRecoveryForRouteSwitch({
        previousRoute: rotation[3]!,
        nextRoute: rotation[0]!,
        rotationRoutes: rotation,
      }),
      true,
    );
    assert.equal(
      resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds: 15,
        previousRouteSwitchBufferSeconds: 0,
        isRouteSwitch: true,
        includeRecovery: true,
      }),
      15,
    );
  });
});

describe('resolvePassengerRouteOccupancy station-aligned min', () => {
  it('raises min occupancy to cover 10s-aligned per-leg mins (TN-style shortfall)', () => {
    const tnLike: ShiftScheduleSelectedRoute = {
      ...route('TN', 1, 185, 155, 36),
      dwellSlackSeconds: 5,
      stationIds: ['station_4', 'wp_b', 'wp_a', 'station_9', 'fdock:028'],
      stationDwells: [
        { stationId: 'station_4', stationName: 'T3', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'wp_b', stationName: '途經點B', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'wp_a', stationName: '途經點A', dwellSeconds: 0, dwellRequired: false },
        {
          stationId: 'station_9',
          stationName: 'N2W',
          dwellSeconds: 36,
          dwellRequired: true,
          dwellMode: 'seconds',
        },
        {
          stationId: 'fdock:028',
          stationName: 'P1',
          dwellSeconds: 0,
          dwellRequired: true,
          dwellMode: 'line_change',
        },
      ],
      stationLegTravels: [
        {
          fromStationId: 'station_4',
          toStationId: 'wp_b',
          avgTravelTimeSeconds: 165,
          minTravelTimeSeconds: 135,
        },
        {
          fromStationId: 'wp_b',
          toStationId: 'wp_a',
          avgTravelTimeSeconds: 5,
          minTravelTimeSeconds: 5,
        },
        {
          fromStationId: 'wp_a',
          toStationId: 'station_9',
          avgTravelTimeSeconds: 5,
          minTravelTimeSeconds: 5,
        },
        {
          fromStationId: 'station_9',
          toStationId: 'fdock:028',
          avgTravelTimeSeconds: 10,
          minTravelTimeSeconds: 10,
        },
      ],
    };

    const occ = resolvePassengerRouteOccupancy(tnLike);
    assert.ok(occ);
    // 舊算法：min=155+41→200，但逐站對齊後行驶至少 179 → 179+41=220
    assert.ok(
      occ!.minOccupancySeconds >= 220,
      `expected minOccupancy >= 220, got ${occ!.minOccupancySeconds}`,
    );
    assert.ok(occ!.occupancySeconds >= occ!.minOccupancySeconds);
  });
});
