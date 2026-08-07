import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCapacityTrendFromPlan,
  formatCapacityGapHint,
  resolveCapacityAxisMax,
  resolveCapacityGroupStreamKey,
  resolveCapacityStreamKey,
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
  routeCode: 'DN',
  groupId: 'g-down',
  groupName: '下行群組',
  stationIds: ['A', 'B', 'C'],
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
  routeCode: 'UP',
  groupId: 'g-up',
  groupName: '上行群組',
  stationIds: ['C', 'B', 'A'],
  executionOrder: 2,
};

const downVariantA: ShiftScheduleSelectedRoute = {
  ...downRoute,
  routeId: 'route-down-a',
  routeName: '下行 A',
  routeCode: 'DA',
  groupId: 'g-down',
  groupName: '下行群組',
  executionOrder: 1,
};

const downVariantB: ShiftScheduleSelectedRoute = {
  ...downRoute,
  routeId: 'route-down-b',
  routeName: '下行 B',
  routeCode: 'DB',
  groupId: 'g-down',
  groupName: '下行群組',
  executionOrder: 2,
};

function planWithDepartures(
  starts: number[],
  routeId: string,
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
            routeId,
          }),
        ),
      },
    ],
    routeAssignmentAlgorithm: 'constraint-greedy-v1',
  };
}

describe('resolveCapacityStreamKey', () => {
  it('uses routeId as the stream key', () => {
    assert.equal(
      resolveCapacityStreamKey(
        passengerBlock({ id: 'a', anchorStartMinute: 0, routeId: 'route-down' }),
      ),
      'route-down',
    );
  });

  it('falls back to route code then name', () => {
    assert.equal(
      resolveCapacityStreamKey(
        passengerBlock({ id: 'a', anchorStartMinute: 0, routeCode: 'DN' }),
      ),
      'code:DN',
    );
    assert.equal(
      resolveCapacityStreamKey(
        passengerBlock({ id: 'b', anchorStartMinute: 0, routeName: '環狀線下行' }),
      ),
      'name:環狀線下行',
    );
  });
});

describe('buildCapacityTrendFromPlan (route mode)', () => {
  it('merges four timelines into one route stream (no square-wave averaging)', () => {
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
      viewMode: 'route',
    });

    assert.equal(series.departureCount, 4);
    assert.equal(series.streams.length, 1);
    assert.equal(series.streams[0]!.streamKey, 'route-down');
    const sample = series.samples.find((item) => item.minute === 30);
    assert.ok(sample);
    assert.equal(sample!.headwayByStream['route-down'], 600);
    assert.equal(sample!.pphpdByStream['route-down'], 420);
    assert.equal(sample!.pphpd, 420);
  });

  it('merges same-route departures across timelines (00:30 + 00:40 = 600s)', () => {
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
      viewMode: 'route',
    });

    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    assert.equal(at30!.headwayByStream['route-down'], 600);
    assert.equal(at30!.pphpdByStream['route-down'], 420);
    assert.equal(at30!.activeStreamCount, 1);
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
              routeId: 'route-down',
            }),
            passengerBlock({
              id: 'd2',
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
      sampleStepMinutes: 1,
      viewMode: 'route',
    });

    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    assert.equal(at30!.headwayByStream['route-down'], 600);
    assert.notEqual(at30!.headwayByStream['route-down'], 1200);
  });

  it('does not treat cross-route departures as headway', () => {
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
              routeId: 'route-up',
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
      viewMode: 'route',
    });

    const at410 = series.samples.find((sample) => sample.minute === 410);
    assert.ok(at410);
    assert.equal(at410!.pphpd, 0);
    assert.equal(at410!.headwaySeconds, null);
    assert.equal(Object.keys(at410!.pphpdByStream).length, 0);
  });

  it('keeps separate pphpd lines for opposite routes', () => {
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 2,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'd1',
              plannedStartMinute: 30,
              anchorStartMinute: 30,
              routeId: 'route-down',
            }),
            passengerBlock({
              id: 'd2',
              plannedStartMinute: 40,
              anchorStartMinute: 40,
              routeId: 'route-down',
            }),
          ],
        },
        {
          row: 2,
          blocks: [
            passengerBlock({
              id: 'u1',
              plannedStartMinute: 30,
              anchorStartMinute: 30,
              routeId: 'route-up',
            }),
            passengerBlock({
              id: 'u2',
              plannedStartMinute: 33,
              anchorStartMinute: 33,
              routeId: 'route-up',
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
      viewMode: 'route',
    });

    assert.equal(series.streams.length, 2);
    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    assert.equal(at30!.pphpdByStream['route-down'], 420); // 600s
    assert.equal(at30!.pphpdByStream['route-up'], 1400); // 180s
    assert.equal(at30!.activeStreamCount, 2);
  });

  it('ignores near-zero day-end gaps that would spike pphpd to tens of thousands', () => {
    const plan = planWithDepartures(
      [23 * 60 + 40, 23 * 60 + 57, 23 * 60 + 57 + 10 / 60],
      'route-up',
    );

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
      viewMode: 'route',
    });

    assert.ok(series.maxPphpd < 5000, `maxPphpd 仍過高：${series.maxPphpd}`);
    const late = series.samples.filter((sample) => sample.minute >= 23 * 60 + 50);
    for (const sample of late) {
      const streamPphpd = sample.pphpdByStream['route-up'] ?? sample.pphpd;
      assert.ok(
        streamPphpd < 5000,
        `日界附近 pphpd 異常：minute=${sample.minute} pphpd=${streamPphpd}`,
      );
    }
  });

  it('buckets alternating headway so peak hours are not a comb chart', () => {
    const starts: number[] = [];
    let cursor = 10 * 60;
    let toggle = false;
    while (cursor < 14 * 60) {
      starts.push(cursor);
      cursor += (toggle ? 220 : 180) / 60;
      toggle = !toggle;
    }
    const plan = planWithDepartures(starts, 'route-down');
    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
      viewMode: 'route',
    });
    const peak = series.samples.filter((s) => s.minute >= 10 * 60 && s.minute < 14 * 60);
    let flips = 0;
    for (let i = 1; i < peak.length; i += 1) {
      const a = peak[i]!.pphpdByStream['route-down'] ?? 0;
      const b = peak[i - 1]!.pphpdByStream['route-down'] ?? 0;
      if (Math.abs(a - b) > 80) flips += 1;
    }
    assert.ok(peak.length <= 30, `分桶後點數應明顯減少：${peak.length}`);
    assert.ok(flips < 4, `分桶後仍過度抖動：flips=${flips}`);
    for (const sample of peak) {
      const pphpd = sample.pphpdByStream['route-down'] ?? 0;
      if (pphpd === 0) continue;
      assert.ok(
        pphpd >= 1100 && pphpd <= 1450,
        `尖峰 pphpd 異常：minute=${sample.minute} pphpd=${pphpd}`,
      );
    }
  });

  it('rolling window averages berth-style bunching instead of sawtooth spikes', () => {
    // 4 班擠在約 3 分鐘，接著長空檔～17 分；瞬間班距會炸到 ~2800 再掉到 ~250
    const starts: number[] = [];
    let cursor = 10 * 60;
    while (cursor < 14 * 60) {
      starts.push(cursor, cursor + 1, cursor + 2, cursor + 3);
      cursor += 20;
    }
    const series = buildCapacityTrendFromPlan({
      plan: planWithDepartures(starts, 'route-down'),
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
      viewMode: 'route',
    });
    const mid = series.samples.filter((s) => s.minute >= 11 * 60 && s.minute < 13 * 60);
    let flips = 0;
    for (let i = 1; i < mid.length; i += 1) {
      const a = mid[i]!.pphpdByStream['route-down'] ?? 0;
      const b = mid[i - 1]!.pphpdByStream['route-down'] ?? 0;
      if (Math.abs(a - b) > 200) flips += 1;
    }
    assert.ok(flips < 6, `滾動視窗後仍過度鋸齒：flips=${flips}`);
    for (const sample of mid) {
      const pphpd = sample.pphpdByStream['route-down'] ?? 0;
      if (pphpd === 0) continue;
      assert.ok(
        pphpd >= 400 && pphpd <= 1600,
        `群聚班次 pphpd 未均化：minute=${sample.minute} pphpd=${pphpd}`,
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
      plan: planWithDepartures(starts, 'route-down'),
      vehicleCapacity: 70,
      sampleStepMinutes: 1,
      viewMode: 'route',
    });

    for (const sample of series.samples) {
      const streamPphpd = sample.pphpdByStream['route-down'];
      const streamHeadway = sample.headwayByStream['route-down'];
      if (streamPphpd == null || streamHeadway == null || streamPphpd <= 0) continue;
      const expected = computeCapacityPphpd(70, streamHeadway);
      assert.ok(
        Math.abs(expected - streamPphpd) <= 5,
        `班距與運能不一致：minute=${sample.minute} headway=${streamHeadway} → ${expected} vs pphpd=${streamPphpd}`,
      );
    }
  });
});


describe('resolveCapacityGroupStreamKey', () => {
  it('maps routeId to group stream via selected routes', () => {
    const routeById = new Map([
      [downRoute.routeId, downRoute],
      [upRoute.routeId, upRoute],
    ]);
    assert.equal(
      resolveCapacityGroupStreamKey(
        passengerBlock({ id: 'a', anchorStartMinute: 0, routeId: 'route-down' }),
        routeById,
      ),
      'group:g-down',
    );
  });
});

describe('buildCapacityTrendFromPlan (serviceDirection mode)', () => {
  it('averages merged same-direction trip headways (not vehicle/route sum)', () => {
    // A、B 同服務方向但在不同時間線＝兩台車並行班次，均化後密於單線。
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 2,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'a1',
              plannedStartMinute: 30,
              anchorStartMinute: 30,
              routeId: 'route-down-a',
            }),
            passengerBlock({
              id: 'a2',
              plannedStartMinute: 40,
              anchorStartMinute: 40,
              routeId: 'route-down-a',
            }),
          ],
        },
        {
          row: 2,
          blocks: [
            passengerBlock({
              id: 'b1',
              plannedStartMinute: 33,
              anchorStartMinute: 33,
              routeId: 'route-down-b',
            }),
            passengerBlock({
              id: 'b2',
              plannedStartMinute: 43,
              anchorStartMinute: 43,
              routeId: 'route-down-b',
            }),
          ],
        },
      ],
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const taggedA = { ...downVariantA, serviceDirectionId: 'sdir-down' };
    const taggedB = { ...downVariantB, serviceDirectionId: 'sdir-down' };
    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [taggedA, taggedB],
      serviceDirectionTags: [{ id: 'sdir-down', name: '下行' }],
      viewMode: 'serviceDirection',
      sampleStepMinutes: 1,
    });

    assert.equal(series.streams.length, 1);
    assert.equal(series.streams[0]!.streamKey, 'sdir:sdir-down');
    assert.equal(series.streams[0]!.label, '下行');
    assert.equal(series.streams[0]!.kind, 'serviceDirection');
    assert.equal(series.streams[0]!.departureCount, 4);

    // 標籤清單遺失時，仍應用路線上冗餘名稱，不可露出 UUID
    const recovered = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [
        { ...taggedA, serviceDirectionName: '往南港' },
        { ...taggedB, serviceDirectionName: '往南港' },
      ],
      serviceDirectionTags: [],
      viewMode: 'serviceDirection',
      sampleStepMinutes: 1,
    });
    assert.equal(recovered.streams[0]!.label, '往南港');

    const byRoute = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [taggedA, taggedB],
      serviceDirectionTags: [{ id: 'sdir-down', name: '下行' }],
      viewMode: 'route',
      sampleStepMinutes: 1,
    });
    const at30Dir = series.samples.find((sample) => sample.minute === 30);
    const at30Route = byRoute.samples.find((sample) => sample.minute === 30);
    assert.ok(at30Dir);
    assert.ok(at30Route);
    const directionHw = at30Dir!.headwayByStream['sdir:sdir-down'];
    const directionPphpd = at30Dir!.pphpdByStream['sdir:sdir-down'];
    const routeHwA = at30Route!.headwayByStream['route-down-a'];
    const routePphpdA = at30Route!.pphpdByStream['route-down-a'];
    assert.ok(directionHw != null && routeHwA != null);
    assert.ok(directionPphpd != null && routePphpdA != null);
    // 同向並行班次均化後等效班距應短於單路線、運能應更高
    assert.ok(directionHw! < routeHwA!, `avg headway ${directionHw} >= route ${routeHwA}`);
    assert.ok(
      directionPphpd! > routePphpdA!,
      `avg pphpd ${directionPphpd} <= route ${routePphpdA}`,
    );
  });

  it('counts contiguous same-direction segments on one timeline as one trip', () => {
    // 同一時間線 NT→TS 同向：只算一趟班次，不可把串接路段算兩倍
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 1,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'nt1',
              plannedStartMinute: 30,
              anchorStartMinute: 30,
              routeId: 'route-down-a',
            }),
            passengerBlock({
              id: 'ts1',
              plannedStartMinute: 35,
              anchorStartMinute: 35,
              routeId: 'route-down-b',
            }),
            passengerBlock({
              id: 'nt2',
              plannedStartMinute: 50,
              anchorStartMinute: 50,
              routeId: 'route-down-a',
            }),
            passengerBlock({
              id: 'ts2',
              plannedStartMinute: 55,
              anchorStartMinute: 55,
              routeId: 'route-down-b',
            }),
          ],
        },
      ],
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const taggedA = { ...downVariantA, serviceDirectionId: 'sdir-down' };
    const taggedB = { ...downVariantB, serviceDirectionId: 'sdir-down' };
    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [taggedA, taggedB],
      serviceDirectionTags: [{ id: 'sdir-down', name: '下行' }],
      viewMode: 'serviceDirection',
      sampleStepMinutes: 1,
    });

    assert.equal(series.streams.length, 1);
    assert.equal(series.streams[0]!.departureCount, 2);
    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    // 兩趟班次 30→50＝20 分＝1200 秒班距 → 70×3600/1200＝210
    // （允許分桶／平滑誤差）
    const hw = at30!.headwayByStream['sdir:sdir-down'];
    const pphpd = at30!.pphpdByStream['sdir:sdir-down'];
    assert.ok(hw != null && pphpd != null);
    assert.ok(hw! >= 900 && hw! <= 1500, `unexpected headway ${hw}`);
    assert.ok(pphpd! >= 150 && pphpd! <= 300, `unexpected pphpd ${pphpd}`);
  });

  it('keeps opposite service directions as separate streams', () => {
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 2,
      timelines: [
        {
          row: 1,
          blocks: [
            passengerBlock({
              id: 'd1',
              plannedStartMinute: 30,
              anchorStartMinute: 30,
              routeId: 'route-down',
            }),
            passengerBlock({
              id: 'd2',
              plannedStartMinute: 40,
              anchorStartMinute: 40,
              routeId: 'route-down',
            }),
          ],
        },
        {
          row: 2,
          blocks: [
            passengerBlock({
              id: 'u1',
              plannedStartMinute: 30,
              anchorStartMinute: 30,
              routeId: 'route-up',
            }),
            passengerBlock({
              id: 'u2',
              plannedStartMinute: 33,
              anchorStartMinute: 33,
              routeId: 'route-up',
            }),
          ],
        },
      ],
      routeAssignmentAlgorithm: 'constraint-greedy-v1',
    };

    const series = buildCapacityTrendFromPlan({
      plan,
      vehicleCapacity: 70,
      selectedRoutes: [
        { ...downRoute, serviceDirectionId: 'sdir-down' },
        { ...upRoute, serviceDirectionId: 'sdir-up' },
      ],
      serviceDirectionTags: [
        { id: 'sdir-down', name: '下行' },
        { id: 'sdir-up', name: '上行' },
      ],
      viewMode: 'serviceDirection',
      sampleStepMinutes: 1,
    });

    assert.equal(series.streams.length, 2);
    const keys = series.streams.map((stream) => stream.streamKey).sort();
    assert.deepEqual(keys, ['sdir:sdir-down', 'sdir:sdir-up']);

    const at30 = series.samples.find((sample) => sample.minute === 30);
    assert.ok(at30);
    assert.equal(at30!.pphpdByStream['sdir:sdir-down'], 420);
    assert.equal(at30!.pphpdByStream['sdir:sdir-up'], 1400);
  });

  it('falls back to per-route streams when service direction is unset', () => {
    const series = buildCapacityTrendFromPlan({
      plan: planWithDepartures([30, 40], 'route-down'),
      vehicleCapacity: 70,
      selectedRoutes: [downRoute, upRoute],
      viewMode: 'serviceDirection',
      sampleStepMinutes: 1,
    });
    assert.equal(series.streams.some((stream) => stream.streamKey === 'route-down'), true);
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
