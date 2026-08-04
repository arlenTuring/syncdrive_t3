import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBlockStationDepartures,
  resolveBlockStationDepartureFeasibility,
  resolveClockAlignedArrivalSecond,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import { isClockAlignedSeconds } from './schedule-engine/physics';

const route: ShiftScheduleSelectedRoute = {
  routeId: 'route-down',
  routeName: '環狀線下行',
  routeCode: 'D',
  groupId: 'g1',
  groupName: '主線',
  stationIds: ['s1', 's2', 's3'],
  stationDwells: [
    { stationId: 's1', stationName: '站A', dwellSeconds: 40 },
    { stationId: 's2', stationName: '站B', dwellSeconds: 40 },
    { stationId: 's3', stationName: '站C', dwellSeconds: 40 },
  ],
  stationDwellsConfirmed: true,
  stationLegTravels: [],
  avgTravelTimeSeconds: 200,
  minTravelTimeSeconds: 180,
  executionOrder: 1,
  switchBufferAfterSeconds: 20,
  dwellSlackSeconds: 0,
};

function passengerBlock(startMinute: number, endMinute: number): GeneratedScheduleBlock {
  return {
    id: 'b1',
    timelineRow: 1,
    taskType: 'passenger',
    label: '正線',
    routeId: 'route-down',
    routeName: '環狀線下行',
    routeCode: 'D',
    anchorStartMinute: startMinute,
    plannedStartMinute: startMinute,
    plannedEndMinute: endMinute,
    travelSeconds: 200,
    dwellSeconds: 120,
    source: 'template_bar',
  };
}

describe('resolveClockAlignedArrivalSecond', () => {
  it('snaps preferred arrival up to 10-second grid', () => {
    // 出發 46 + 行駛 100 = 146 → 對齊 150
    assert.equal(
      resolveClockAlignedArrivalSecond({
        departureSecond: 46,
        preferredTravelSeconds: 100,
        minTravelSeconds: 80,
        maxTravelSeconds: 130,
      }),
      150,
    );
  });

  it('does not stretch beyond max vs average', () => {
    // 偏好會對齊到很遠，但上限擋住 → 取上限格內
    const arrival = resolveClockAlignedArrivalSecond({
      departureSecond: 0,
      preferredTravelSeconds: 200,
      minTravelSeconds: 80,
      maxTravelSeconds: 110,
    });
    assert.equal(arrival, 110);
    assert.equal(isClockAlignedSeconds(arrival), true);
  });

  it('respects min travel even if over stretch cap', () => {
    const arrival = resolveClockAlignedArrivalSecond({
      departureSecond: 0,
      preferredTravelSeconds: 50,
      minTravelSeconds: 95,
      maxTravelSeconds: 100,
    });
    assert.equal(arrival, 100);
  });
});

describe('buildBlockStationDepartures', () => {
  it('lists every station with arrival then departure', () => {
    // 10:00 起；首站不靠站，後兩站各停 40s；剩餘 240s 行駛均分兩段
    // 站A 抵達／出發 10:00:00
    // 站B 抵達 10:02:00 / 出發 10:02:40
    // 站C 抵達 10:04:40 / 出發 10:05:20
    const start = 10 * 60;
    const stops = buildBlockStationDepartures(passengerBlock(start, start + 320 / 60), route);
    assert.equal(stops.length, 3);
    assert.deepEqual(
      stops.map((stop) => stop.stationName),
      ['站A', '站B', '站C'],
    );

    const base = 10 * 3600;
    assert.equal(Math.round(stops[0]!.arrivalMinute * 60), base);
    assert.equal(Math.round(stops[0]!.departureMinute * 60), base);
    assert.equal(stops[0]!.dwellSeconds, 0);

    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), base + 120);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), base + 160);

    assert.equal(Math.round(stops[2]!.arrivalMinute * 60), base + 280);
    assert.equal(Math.round(stops[2]!.departureMinute * 60), base + 320);
    assert.equal(stops[0]!.travelToNextSeconds, 120);
    assert.equal(stops[1]!.travelToNextSeconds, 120);
    assert.equal(stops[2]!.travelToNextSeconds, null);
  });

  it('applies dwell slack before departure (skips origin)', () => {
    const withSlack: ShiftScheduleSelectedRoute = {
      ...route,
      avgTravelTimeSeconds: 50,
      minTravelTimeSeconds: 50,
      dwellSlackSeconds: 10,
      stationDwells: [
        { stationId: 's1', stationName: '站A', dwellSeconds: 40 },
        { stationId: 's2', stationName: '站B', dwellSeconds: 40 },
      ],
    };
    // 首站 0；次站有效停靠 40 + 10 = 50
    const stops = buildBlockStationDepartures(passengerBlock(0, 100 / 60), withSlack);
    assert.equal(stops.length, 2);
    assert.equal(stops[0]!.dwellSeconds, 0);
    assert.equal(stops[1]!.dwellSeconds, 50);
    assert.equal(Math.round(stops[0]!.arrivalMinute * 60), 0);
    assert.equal(Math.round(stops[0]!.departureMinute * 60), 0);
    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), 50);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), 100);
  });

  it('prefers per-block stationDwells and dwellSlack over route defaults', () => {
    const block: GeneratedScheduleBlock = {
      ...passengerBlock(0, 200 / 60),
      stationDwells: [
        { stationId: 's1', stationName: '站A', dwellSeconds: 20 },
        { stationId: 's2', stationName: '站B', dwellSeconds: 30 },
        { stationId: 's3', stationName: '站C', dwellSeconds: 40 },
      ],
      dwellSlackSeconds: 5,
    };
    // 首站 0；(30+5)+(40+5)=80
    const stops = buildBlockStationDepartures(
      block,
      {
        ...route,
        avgTravelTimeSeconds: 120,
        minTravelTimeSeconds: 110,
      },
    );
    assert.equal(stops.length, 3);
    assert.equal(stops[0]!.dwellSeconds, 0);
    assert.equal(stops[1]!.dwellSeconds, 35);
    // 設定值 40+5；卡尾零頭併入末站後 dwell ≥ 設定值，出發對齊卡尾
    assert.equal(stops[2]!.baseDwellSeconds, 40);
    assert.ok(stops[2]!.dwellSeconds >= 45);
    assert.equal(Math.round(stops[2]!.departureMinute * 60), 200);
  });

  it('allocates travel by topology leg weights instead of equal split', () => {
    const weighted: ShiftScheduleSelectedRoute = {
      ...route,
      avgTravelTimeSeconds: 300,
      minTravelTimeSeconds: 240,
      stationLegTravels: [
        {
          fromStationId: 's1',
          toStationId: 's2',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 80,
          distanceMeters: 500,
        },
        {
          fromStationId: 's2',
          toStationId: 's3',
          avgTravelTimeSeconds: 200,
          minTravelTimeSeconds: 160,
          distanceMeters: 1000,
        },
      ],
    };
    // 首站不靠站；後兩站各 40s；行駛依權重分配後再對齊 10 秒格
    const stops = buildBlockStationDepartures(passengerBlock(0, 420 / 60), weighted);
    assert.equal(stops.length, 3);
    assert.equal(Math.round(stops[0]!.arrivalMinute * 60), 0);
    assert.equal(Math.round(stops[0]!.departureMinute * 60), 0);
    assert.equal(stops[0]!.dwellSeconds, 0);
    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), 110);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), 150);
    assert.equal(Math.round(stops[2]!.arrivalMinute * 60), 380);
    assert.equal(Math.round(stops[2]!.departureMinute * 60), 420);
  });

  it('snaps subsequent arrivals to 10-second grid when dwell leaves off-grid', () => {
    const offGridDwell: ShiftScheduleSelectedRoute = {
      ...route,
      dwellSlackSeconds: 0,
      stationDwells: [
        { stationId: 's1', stationName: '站A', dwellSeconds: 36 },
        { stationId: 's2', stationName: '站B', dwellSeconds: 36 },
        { stationId: 's3', stationName: '站C', dwellSeconds: 36 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's1',
          toStationId: 's2',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 80,
        },
        {
          fromStationId: 's2',
          toStationId: 's3',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 80,
        },
      ],
      avgTravelTimeSeconds: 200,
      minTravelTimeSeconds: 160,
    };
    // 首站 0；其餘各 36。到站對齊 10 秒格
    const stops = buildBlockStationDepartures(passengerBlock(0, 308 / 60), offGridDwell);
    for (const stop of stops) {
      assert.equal(
        isClockAlignedSeconds(Math.round(stop.arrivalMinute * 60)),
        true,
        `arrival not on 10s grid: ${stop.stationName}`,
      );
    }
    assert.equal(stops[0]!.dwellSeconds, 0);
    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), 120);
    assert.equal(Math.round(stops[2]!.arrivalMinute * 60), 270);
    assert.ok(Math.round(stops[2]!.departureMinute * 60) <= 308);
  });

  it('keeps dwell and stays within snap-down occupancy end', () => {
    const snapDownRoute: ShiftScheduleSelectedRoute = {
      ...route,
      stationIds: ['s1', 's2'],
      stationDwells: [
        { stationId: 's1', stationName: '站A', dwellSeconds: 0 },
        { stationId: 's2', stationName: '站B', dwellSeconds: 2 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's1',
          toStationId: 's2',
          avgTravelTimeSeconds: 109,
          minTravelTimeSeconds: 90,
        },
      ],
      avgTravelTimeSeconds: 109,
      minTravelTimeSeconds: 90,
    };
    // raw avg+dwell = 111，block occupancy snap↓ 為 110。
    // 舊逐段 snap↑：108 travel budget → 110，到末站出發為 112（超尾 2 秒）。
    const block = passengerBlock(0, 110 / 60);
    const stops = buildBlockStationDepartures(block, snapDownRoute);

    assert.equal(stops.length, 2);
    assert.equal(stops[0]!.travelToNextSeconds, 100);
    assert.equal(isClockAlignedSeconds(Math.round(stops[1]!.arrivalMinute * 60)), true);
    // 卡尾零頭併入末站：出發對齊卡尾；靠站設定值保留在 baseDwell
    assert.equal(stops[1]!.baseDwellSeconds, 2);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), 110);
    assert.ok(stops[1]!.dwellSeconds >= 2);
  });

  it('reports an infeasible block instead of shortening dwell or min travel', () => {
    const infeasibleRoute: ShiftScheduleSelectedRoute = {
      ...route,
      stationIds: ['s1', 's2'],
      stationDwells: [
        { stationId: 's1', stationName: '站A', dwellSeconds: 0 },
        { stationId: 's2', stationName: '站B', dwellSeconds: 2 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's1',
          toStationId: 's2',
          avgTravelTimeSeconds: 109,
          minTravelTimeSeconds: 109,
        },
      ],
      avgTravelTimeSeconds: 109,
      minTravelTimeSeconds: 109,
    };
    const block = passengerBlock(0, 110 / 60);
    const feasibility = resolveBlockStationDepartureFeasibility(block, infeasibleRoute);

    assert.deepEqual(feasibility, {
      feasible: false,
      reason: 'insufficient_travel_budget',
      availableTravelSeconds: 108,
      minRequiredTravelSeconds: 110,
      shortfallSeconds: 2,
    });
    assert.deepEqual(buildBlockStationDepartures(block, infeasibleRoute), []);
  });

  it('absorbs trailing card slack into the last stop departure', () => {
    // 行駛+靠站夠用後仍可能留下卡尾零頭；末站出發必須對齊卡結束
    const shortRoute: ShiftScheduleSelectedRoute = {
      ...route,
      stationIds: ['s1', 's2'],
      stationDwells: [
        { stationId: 's1', stationName: '站A', dwellSeconds: 0 },
        { stationId: 's2', stationName: '站B', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's1',
          toStationId: 's2',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 100,
        },
      ],
      avgTravelTimeSeconds: 100,
      minTravelTimeSeconds: 100,
    };
    // 占用 160s；均分後末站出發可能早於卡尾 → 併入末站
    const stops = buildBlockStationDepartures(passengerBlock(0, 160 / 60), shortRoute);
    assert.equal(stops.length, 2);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), 160);
    assert.ok(stops[1]!.dwellSeconds >= 40);
  });

  it('keeps next origin on own card start when previous terminal matches but cards have a gap', () => {
    // TN 結束後到 NT 之間有恢復空檔：不可把上一卡時刻鏡到下一卡首站
    const inbound: ShiftScheduleSelectedRoute = {
      ...route,
      routeId: 'tn',
      routeCode: 'TN',
      stationIds: ['s3', 's4'],
      stationDwells: [
        { stationId: 's3', stationName: 'T3', dwellSeconds: 0, dwellRequired: false },
        { stationId: 's4', stationName: 'P1', dwellSeconds: 0, dwellRequired: false },
      ],
      stationLegTravels: [
        {
          fromStationId: 's3',
          toStationId: 's4',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 100,
        },
      ],
      avgTravelTimeSeconds: 100,
      minTravelTimeSeconds: 100,
    };
    const outbound: ShiftScheduleSelectedRoute = {
      ...route,
      routeId: 'nt',
      routeCode: 'NT',
      stationIds: ['s4', 's5'],
      stationDwells: [
        { stationId: 's4', stationName: 'P1', dwellSeconds: 0, dwellRequired: false },
        { stationId: 's5', stationName: 'N2', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's4',
          toStationId: 's5',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 100,
        },
      ],
      avgTravelTimeSeconds: 100,
      minTravelTimeSeconds: 100,
    };
    const prev = {
      ...passengerBlock(0, 100 / 60),
      id: 'prev',
      routeId: 'tn',
      routeCode: 'TN',
    };
    // 中間空 5 分鐘（恢復）
    const next = {
      ...passengerBlock(400 / 60, 540 / 60),
      id: 'next',
      routeId: 'nt',
      routeCode: 'NT',
    };
    const prevStops = buildBlockStationDepartures(prev, inbound);
    const nextStops = buildBlockStationDepartures(next, outbound, {
      previousBlock: prev,
      previousRoute: inbound,
    });
    assert.equal(prevStops[1]!.stationId, 's4');
    assert.equal(Math.round(prevStops[1]!.departureMinute * 60), 100);
    assert.equal(nextStops[0]!.stationId, 's4');
    // 首站出發＝本卡開始，不是上一卡結束
    assert.equal(Math.round(nextStops[0]!.departureMinute * 60), 400);
    assert.equal(Math.round(nextStops[0]!.arrivalMinute * 60), 400);
  });

  it('when cards abut at shared terminal, next origin depart equals previous dwell-complete', () => {
    const inbound: ShiftScheduleSelectedRoute = {
      ...route,
      routeId: 'st',
      routeCode: 'ST',
      stationIds: ['s2', 's3'],
      stationDwells: [
        { stationId: 's2', stationName: 'S2', dwellSeconds: 0, dwellRequired: false },
        { stationId: 's3', stationName: 'T3', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's2',
          toStationId: 's3',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 100,
        },
      ],
      avgTravelTimeSeconds: 100,
      minTravelTimeSeconds: 100,
    };
    const outbound: ShiftScheduleSelectedRoute = {
      ...route,
      routeId: 'tn',
      routeCode: 'TN',
      stationIds: ['s3', 's4'],
      stationDwells: [
        { stationId: 's3', stationName: 'T3', dwellSeconds: 0, dwellRequired: false },
        { stationId: 's4', stationName: 'N2', dwellSeconds: 40 },
      ],
      stationLegTravels: [
        {
          fromStationId: 's3',
          toStationId: 's4',
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 100,
        },
      ],
      avgTravelTimeSeconds: 100,
      minTravelTimeSeconds: 100,
    };
    const prev = {
      ...passengerBlock(0, 150 / 60),
      id: 'prev',
      routeId: 'st',
      routeCode: 'ST',
    };
    const next = {
      ...passengerBlock(150 / 60, 300 / 60),
      id: 'next',
      routeId: 'tn',
      routeCode: 'TN',
    };
    const prevStops = buildBlockStationDepartures(prev, inbound);
    const nextStops = buildBlockStationDepartures(next, outbound);
    assert.equal(Math.round(prevStops[1]!.departureMinute * 60), 150);
    assert.equal(Math.round(nextStops[0]!.departureMinute * 60), 150);
  });
});

describe('resolveRouteForBlock', () => {
  it('resolves by routeId', () => {
    assert.equal(
      resolveRouteForBlock(passengerBlock(0, 1), [route])?.routeId,
      'route-down',
    );
  });
});
