import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveLeaveMarginSeconds,
  resolveOverrunHoldSeconds,
  resolveRouteClearanceInsertGapSeconds,
  resolveStationClearanceEarliestInsertSecond,
  resolveStationExitDwellSeconds,
} from './stationClearanceInsert';

describe('resolveStationClearanceEarliestInsertSecond', () => {
  it('does not use service headway; earliest = prior depart + buffered leave margin', () => {
    // 前車 01:00:00 離開衝突站；離開餘裕 40s；緩衝 10% → 44s → snap↑ 01:00:50
    const result = resolveStationClearanceEarliestInsertSecond({
      previousDepartureSecond: 3600,
      leaveMarginSeconds: 40,
      overrunHoldSeconds: 0,
      bufferPercent: 10,
    });
    assert.equal(result.earliestInsertSecond, 3600 + 50);
    assert.equal(result.effectiveGapSeconds, 50);
    assert.ok(result.effectiveGapSeconds < 180, 'must be tighter than typical service headway');
  });

  it('includes overrun hold when previous trip may linger', () => {
    const result = resolveStationClearanceEarliestInsertSecond({
      previousDepartureSecond: 3600,
      leaveMarginSeconds: 30,
      overrunHoldSeconds: 20,
      bufferPercent: 10,
    });
    // base 50 * 1.1 = 55 → snap↑ 60
    assert.equal(result.earliestInsertSecond, 3660);
  });
});

describe('leave margin from station dwell/exit', () => {
  it('uses conflict station dwell with 靠站緩衝', () => {
    assert.equal(
      resolveStationExitDwellSeconds(
        { stationId: 'T3', stationName: 'T3', dwellSeconds: 40 },
        5,
      ),
      45,
    );
    assert.equal(
      resolveLeaveMarginSeconds({
        stationDwells: [
          { stationId: 'T3', stationName: 'T3', dwellSeconds: 40 },
          { stationId: 'N2', stationName: 'N2', dwellSeconds: 20 },
        ],
        dwellSlackSeconds: 5,
        conflictStationId: 'T3',
      }),
      45,
    );
  });

  it('falls back to first non-zero dwell when origin is empty', () => {
    assert.equal(
      resolveLeaveMarginSeconds({
        stationDwells: [
          { stationId: 'T3', stationName: 'T3', dwellSeconds: 0 },
          { stationId: 'N2', stationName: 'N2', dwellSeconds: 25 },
        ],
        dwellSlackSeconds: 0,
      }),
      25,
    );
  });

  it('route clearance gap is dwell-based, not service headway', () => {
    const gap = resolveRouteClearanceInsertGapSeconds(
      {
        stationIds: ['T3', 'N2W'],
        stationDwells: [
          { stationId: 'T3', stationName: 'T3', dwellSeconds: 30 },
          { stationId: 'N2W', stationName: 'N2W', dwellSeconds: 20 },
        ],
        dwellSlackSeconds: 0,
        avgTravelTimeSeconds: 200,
        minTravelTimeSeconds: 180,
      },
      { avgTravelTimeSeconds: 200, minTravelTimeSeconds: 180 },
    );
    // leave 30 + overrun 20 = 50 * 1.1 = 55 → snap↑ 60
    assert.equal(gap, 60);
    assert.ok(gap < 300, 'must not gate on operational headway');
  });
});

describe('overrun hold', () => {
  it('overrun is avg-min snap', () => {
    assert.equal(resolveOverrunHoldSeconds({ avgSeconds: 100, minSeconds: 80 }), 20);
    assert.equal(resolveOverrunHoldSeconds({ avgSeconds: 80, minSeconds: 100 }), 0);
  });
});
