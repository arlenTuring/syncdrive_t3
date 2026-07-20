import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBlockStationDepartures,
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
    // 10:00 起，三站各停 40s，剩餘 200s 行駛均分兩段
    // 站A 抵達 10:00:00 / 出發 10:00:40
    // 站B 抵達 10:02:20 / 出發 10:03:00
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
    assert.equal(Math.round(stops[0]!.departureMinute * 60), base + 40);

    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), base + 140);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), base + 180);

    assert.equal(Math.round(stops[2]!.arrivalMinute * 60), base + 280);
    assert.equal(Math.round(stops[2]!.departureMinute * 60), base + 320);
    assert.equal(stops[0]!.travelToNextSeconds, 100);
    assert.equal(stops[1]!.travelToNextSeconds, 100);
    assert.equal(stops[2]!.travelToNextSeconds, null);
  });

  it('applies dwell slack before departure', () => {
    const withSlack: ShiftScheduleSelectedRoute = {
      ...route,
      dwellSlackSeconds: 10,
      stationDwells: [{ stationId: 's1', stationName: '站A', dwellSeconds: 40 }],
    };
    // 有效停靠 40 + 10 = 50
    const stops = buildBlockStationDepartures(passengerBlock(0, 50 / 60), withSlack);
    assert.equal(stops.length, 1);
    assert.equal(stops[0]!.dwellSeconds, 50);
    assert.equal(Math.round(stops[0]!.arrivalMinute * 60), 0);
    assert.equal(Math.round(stops[0]!.departureMinute * 60), 50);
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
    // 三站各停 40s，行駛預算 300s → 站間 100 / 200
    const stops = buildBlockStationDepartures(passengerBlock(0, 420 / 60), weighted);
    assert.equal(stops.length, 3);
    assert.equal(Math.round(stops[0]!.arrivalMinute * 60), 0);
    assert.equal(Math.round(stops[0]!.departureMinute * 60), 40);
    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), 140);
    assert.equal(Math.round(stops[1]!.departureMinute * 60), 180);
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
    // 預算：總長 36*3+200=308 → 兩段各 100
    // A: 0→36；偏好到站 136 → 對齊 140
    // B: 140→176；偏好到站 276 → 對齊 280
    const stops = buildBlockStationDepartures(passengerBlock(0, 308 / 60), offGridDwell);
    for (const stop of stops) {
      assert.equal(
        isClockAlignedSeconds(Math.round(stop.arrivalMinute * 60)),
        true,
        `arrival not on 10s grid: ${stop.stationName}`,
      );
    }
    assert.equal(Math.round(stops[1]!.arrivalMinute * 60), 140);
    assert.equal(Math.round(stops[2]!.arrivalMinute * 60), 280);
    assert.equal(stops[0]!.travelToNextSeconds, 104);
    assert.equal(stops[1]!.travelToNextSeconds, 104);
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
