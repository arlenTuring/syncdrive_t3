import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCapacityTrendFromPlan,
  buildDirectionByRouteId,
  formatCapacityGapHint,
  resolveCapacityAxisMax,
  resolveDepartureStreamKey,
} from './buildCapacityTrend';
import { computeCapacityPphpd } from '../../time-templates/types/editor';
import type { GeneratedScheduleBlock, GeneratedSchedulePlan } from './shiftScheduleEngine.types';
import type { ShiftScheduleSelectedRoute } from '../types/create';

function passengerBlock(
  partial: Partial<GeneratedScheduleBlock> & Pick<GeneratedScheduleBlock, 'id' | 'anchorStartMinute'>,
): GeneratedScheduleBlock {
  const start = partial.plannedStartMinute ?? partial.anchorStartMinute;
  return {
    timelineRow: 1,
    taskType: 'passenger',
    label: '正線',
    plannedStartMinute: start,
    plannedEndMinute: start + 20 / 60,
    travelSeconds: 1080,
    dwellSeconds: 180,
    source: 'template_bar',
    ...partial,
  };
}

const downRoute: ShiftScheduleSelectedRoute = {
  routeId: 'route-down',
  routeName: '環狀線下行',
  routeCode: null,
  groupId: 'g1',
  groupName: '主線',
  stationIds: [],
  stationDwells: [],
  stationDwellsConfirmed: true,
  stationLegTravels: [],
  avgTravelTimeSeconds: 1080,
  minTravelTimeSeconds: 900,
  executionOrder: 1,
  switchBufferAfterSeconds: 60,
  dwellSlackSeconds: 0,
};

const upRoute: ShiftScheduleSelectedRoute = {
  ...downRoute,
  routeId: 'route-up',
  routeName: '環狀線上行',
  executionOrder: 2,
};

function planWithDepartures(
  starts: number[],
  routeCode: 'U' | 'D' = 'U',
): GeneratedSchedulePlan {
  return {
    generatedAt: new Date().toISOString(),
    scheduleRowCount: 2,
    timelines: [
      {
        row: 1,
        blocks: starts.map((start, index) =>
          passengerBlock({
            id: `b${index}`,
            anchorStartMinute: start,
            plannedStartMinute: start,
            routeCode,
            routeName: routeCode === 'U' ? '上行路線' : '下行路線',
          }),
        ),
      },
    ],
    routeAssignmentAlgorithm: 'constraint-greedy-v1',
  };
}

describe('buildDirectionByRouteId', () => {
  it('maps execution order 1→down, 2→up when names lack 上行/下行', () => {
    const map = buildDirectionByRouteId([downRoute, upRoute]);
    assert.equal(map.get('route-down'), 'down');
    assert.equal(map.get('route-up'), 'up');
  });
});

describe('resolveDepartureStreamKey', () => {
  it('groups upstream and downstream separately', () => {
    assert.equal(
      resolveDepartureStreamKey(passengerBlock({ id: 'u1', anchorStartMinute: 0, routeCode: 'U' })),
      'up',
    );
    assert.equal(
      resolveDepartureStreamKey(passengerBlock({ id: 'd1', anchorStartMinute: 0, routeCode: 'D' })),
      'down',
    );
  });

  it('resolves direction from routeId via selected routes', () => {
    const map = buildDirectionByRouteId([downRoute, upRoute]);
    assert.equal(
      resolveDepartureStreamKey(
        passengerBlock({ id: 'x1', anchorStartMinute: 0, routeId: 'route-down' }),
        map,
      ),
      'down',
    );
  });

  it('returns null instead of timeline fallback', () => {
    assert.equal(
      resolveDepartureStreamKey(passengerBlock({ id: 'x1', anchorStartMinute: 0, timelineRow: 3 })),
      null,
    );
  });
});

describe('buildCapacityTrendFromPlan', () => {
  it('merges four timelines into one downstream stream (no square-wave averaging)', () => {
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 4,
      timelines: [1, 2, 3, 4].map((row, rowIndex) => ({
        row,
        blocks: [
          passengerBlock({
            id: `d-${row}`,
            timelineRow: row,
            anchorStartMinute: 10 + rowIndex * 10,
            plannedStartMinute: 30 + rowIndex * 10,
            routeId: 'route-down',
          }),
        ],
      })),
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [downRoute, upRoute],
      sampleStepMinutes: 1,
    });

    assert.equal(series.departureCount, 4);
    const sample = series.samples.find((item) => item.minute === 30);
    assert.ok(sample);
    assert.equal(sample!.headwayByDirection.down, 600);
    assert.equal(sample!.pphpd, 420);
  });

  it('merges downstream departures across timelines (00:30 row1 + 00:40 row2 = 600s)', () => {
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 2,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'd0030',
              timelineRow: 1,
              anchorStartMinute: 10,
              plannedStartMinute: 30,
              routeId: 'route-down',
            }),
          ],
        },
        {
          row: 2,
          blocks: [
            passengerBlock({
              id: 'd0040',
              timelineRow: 2,
              anchorStartMinute: 50,
              plannedStartMinute: 40,
              routeId: 'route-down',
            }),
          ],
        },
      ],
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [downRoute, upRoute],
      sampleStepMinutes: 1,
    });

    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    assert.equal(at30!.headwayByDirection.down, 600);
    assert.equal(at30!.pphpd, 420);
    assert.equal(at30!.activeDirectionCount, 1);
  });

  it('uses plannedStartMinute not anchorStartMinute for headway', () => {
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 2,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'd1',
              anchorStartMinute: 10,
              plannedStartMinute: 30,
              routeCode: 'D',
            }),
            passengerBlock({
              id: 'd2',
              anchorStartMinute: 50,
              plannedStartMinute: 40,
              routeCode: 'D',
            }),
          ],
        },
      ],
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
    });

    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    assert.equal(at30!.headwayByDirection.down, 600);
    assert.notEqual(at30!.headwayByDirection.down, 1200);
  });

  it('does not treat cross-direction departures as headway', () => {
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 2,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'u0656',
              anchorStartMinute: 416,
              plannedStartMinute: 416,
              routeCode: 'U',
            }),
          ],
        },
        {
          row: 2,
          blocks: [
            passengerBlock({
              id: 'd0700',
              anchorStartMinute: 420,
              plannedStartMinute: 420,
              routeCode: 'D',
            }),
          ],
        },
      ],
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
    });

    const at410 = series.samples.find((sample) => sample.minute === 410);
    assert.ok(at410);
    assert.equal(at410!.pphpd, 0);
    assert.equal(at410!.headwaySeconds, null);
  });

  it('ignores near-zero day-end gaps that would spike pphpd to tens of thousands', () => {
    // 23:57:00 與 23:57:10 同方向連發（補完偽影）→ 10 秒班距會算出 25200 pphpd
    const plan = planWithDepartures([23 * 60 + 40, 23 * 60 + 57, 23 * 60 + 57 + 10 / 60], 'U');

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
    });

    assert.ok(series.maxPphpd < 5000, `maxPphpd 仍過高：${series.maxPphpd}`);
    const late = series.samples.filter((sample) => sample.minute >= 23 * 60 + 50);
    for (const sample of late) {
      assert.ok(
        sample.pphpd < 5000,
        `日界附近 pphpd 異常：minute=${sample.minute} pphpd=${sample.pphpd} headway=${sample.headwaySeconds}`,
      );
    }
  });

  it('buckets alternating headway so peak hours are not a comb chart', () => {
    // 模擬尖峰：同方向班距 180/220 交替 → 每分鐘會跳；分桶 + 平滑後應大幅減少翻轉
    const starts: number[] = [];
    let cursor = 10 * 60;
    let toggle = false;
    while (cursor < 14 * 60) {
      starts.push(cursor);
      cursor += (toggle ? 220 : 180) / 60;
      toggle = !toggle;
    }
    const plan = planWithDepartures(starts, 'D');
    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
    });
    const peak = series.samples.filter((s) => s.minute >= 10 * 60 && s.minute < 14 * 60);
    let flips = 0;
    for (let i = 1; i < peak.length; i += 1) {
      if (Math.abs(peak[i]!.pphpd - peak[i - 1]!.pphpd) > 80) flips += 1;
    }
    assert.ok(peak.length <= 30, `分桶後點數應明顯減少：${peak.length}`);
    assert.ok(flips < 4, `分桶後仍過度抖動：flips=${flips}`);
    // 應落在 180／220 對應運能之間（70×3600/180=1400、70×3600/220≈1145）
    for (const sample of peak) {
      if (sample.pphpd === 0) continue;
      assert.ok(
        sample.pphpd >= 1100 && sample.pphpd <= 1450,
        `尖峰 pphpd 異常：minute=${sample.minute} pphpd=${sample.pphpd}`,
      );
    }
  });

  it('keeps displayed headway consistent with smoothed pphpd', () => {
    const starts: number[] = [];
    let cursor = 10 * 60;
    let toggle = false;
    while (cursor < 12 * 60) {
      starts.push(cursor);
      cursor += (toggle ? 220 : 180) / 60;
      toggle = !toggle;
    }
    const series = buildCapacityTrendFromPlan({
      plan: planWithDepartures(starts, 'D'),
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
    });

    for (const sample of series.samples) {
      if (sample.pphpd <= 0 || sample.headwaySeconds == null) continue;
      const expected = computeCapacityPphpd(70, sample.headwaySeconds);
      assert.ok(
        Math.abs(expected - sample.pphpd) <= 2,
        `班距與運能不一致：minute=${sample.minute} headway=${sample.headwaySeconds} → ${expected} vs pphpd=${sample.pphpd}`,
      );
      const downHeadway = sample.headwayByDirection.down;
      if (downHeadway != null) {
        const dirExpected = computeCapacityPphpd(70, downHeadway);
        const dirPphpd = sample.pphpdByDirection.down;
        assert.ok(dirPphpd != null);
        assert.ok(
          Math.abs(dirExpected - dirPphpd!) <= 2,
          `下行班距與運能不一致：${downHeadway}s → ${dirExpected} vs ${dirPphpd}`,
        );
      }
    }
  });
});

describe('formatCapacityGapHint', () => {
  it('explains shortfall when actual headway is longer than target', () => {
    const hint = formatCapacityGapHint({
      actualPphpd: 1155,
      targetPphpd: 1400,
      actualHeadwaySeconds: 218,
      targetHeadwaySeconds: 180,
    });
    assert.ok(hint);
    assert.match(hint!, /218/);
    assert.match(hint!, /180/);
    assert.match(hint!, /時間線/);
  });

  it('stays quiet when near target', () => {
    assert.equal(
      formatCapacityGapHint({
        actualPphpd: 1380,
        targetPphpd: 1400,
        actualHeadwaySeconds: 182,
        targetHeadwaySeconds: 180,
      }),
      null,
    );
  });
});

describe('resolveCapacityAxisMax', () => {
  it('rounds up to 200 ticks covering actual and target', () => {
    assert.equal(
      resolveCapacityAxisMax(1100, [{ id: 'a', name: '尖峰', color: '#f00', headwaySeconds: 180, capacityPphpd: 1200, isDraft: false }]),
      1200,
    );
  });

  it('does not let a pathological actual max blow the axis', () => {
    const axis = resolveCapacityAxisMax(25200, [
      {
        id: 'a1',
        name: '尖峰H',
        color: '#f00',
        headwaySeconds: 180,
        capacityPphpd: 1400,
        isDraft: false,
      },
    ]);
    assert.ok(axis <= 2400, `軸高仍被撐爆：${axis}`);
    assert.ok(axis >= 1400);
  });
});
