import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import {
  buildBlockStationDepartures,
  resolveBlockDwellSlackBreakdown,
} from './buildBlockStationDepartures';
// 後端展開用的是另一份實作：同一張卡兩邊算出來的逐站時刻必須一樣
import { buildTimetableStationStops } from '../../../../../backend/src/operation-shift/timetable/build-station-stops';

const route = {
  instanceId: 'r', routeId: 'r', routeName: 'R', routeCode: 'R', groupName: 'g', executionOrder: 1,
  avgTravelTimeSeconds: 240, minTravelTimeSeconds: 200, switchBufferAfterSeconds: 0, dwellSlackSeconds: 5,
  stationIds: ['a', 'b', 'c', 'd'],
  stationDwells: [
    { stationId: 'a', stationName: 'A', dwellSeconds: 0 },
    { stationId: 'b', stationName: 'B', dwellSeconds: 30 },
    { stationId: 'c', stationName: 'C', dwellSeconds: 0, dwellRequired: false },
    { stationId: 'd', stationName: 'D', dwellSeconds: 20 },
  ],
  stationLegTravels: [],
  stationDwellsConfirmed: true, backupForInstanceId: null, backupForRouteId: null,
} as unknown as ShiftScheduleSelectedRoute;

function trip(partial: Partial<GeneratedScheduleBlock>): GeneratedScheduleBlock {
  return {
    id: 't', timelineRow: 1, taskType: 'passenger', label: '正線', source: 'template_bar',
    routeId: 'r', travelSeconds: 240, dwellSeconds: 0,
    anchorStartMinute: 600, plannedStartMinute: 600, plannedEndMinute: 600 + 320 / 60,
    ...partial,
  } as GeneratedScheduleBlock;
}

describe('靠站緩衝解析：站點設定與緩衝分開', () => {
  it('沒有覆寫：用路線緩衝', () => {
    assert.equal(resolveBlockDwellSlackBreakdown(trip({}), route).effectiveSlackSeconds, 5);
  });

  it('只給單班緩衝、沒覆寫站點：單班緩衝照樣生效（先前會被忽略）', () => {
    assert.equal(resolveBlockDwellSlackBreakdown(trip({ dwellSlackSeconds: 12 }), route).effectiveSlackSeconds, 12);
  });

  it('單班明確給 0：是 0，不是退回路線設定', () => {
    const breakdown = resolveBlockDwellSlackBreakdown(trip({ dwellSlackSeconds: 0 }), route);
    assert.equal(breakdown.effectiveSlackSeconds, 0);
    assert.equal(breakdown.source, 'block');
  });

  it('覆寫站點但沒給緩衝：沿用既有相容行為（0）', () => {
    const breakdown = resolveBlockDwellSlackBreakdown(
      trip({ stationDwells: route.stationDwells.map((dwell) => ({ ...dwell })) }),
      route,
    );
    assert.equal(breakdown.effectiveSlackSeconds, 0);
  });

  it('系統增加量加在緩衝上，基本停靠不變；不適用的站（途經、首站）不加', () => {
    const adjusted = trip({
      plannedEndMinute: 600 + (320 + 2 * 60) / 60,
      dwellSlackAdjustment: {
        baseSlackSeconds: 5,
        addedSeconds: 60,
        reason: { code: 'STATION_BERTH_COLLISION', resourceId: 'd', resourceLabel: 'D', counterpartBlockIds: [], message: '' },
        affectedStops: [],
        blockBefore: { startMinute: 600, endMinute: 600 + 320 / 60 },
      },
    });
    const breakdown = resolveBlockDwellSlackBreakdown(adjusted, route);
    assert.deepEqual([breakdown.baseSlackSeconds, breakdown.addedSeconds, breakdown.effectiveSlackSeconds], [5, 60, 65]);
    const stops = buildBlockStationDepartures(adjusted, route);
    assert.deepEqual(stops.map((stop) => stop.baseDwellSeconds), [0, 30, 0, 20]);
    assert.equal(stops[0]!.dwellSeconds, 0, '首站不加');
    assert.equal(stops[1]!.dwellSeconds, 30 + 65);
    assert.equal(stops[2]!.dwellSeconds, 0, '途經不加');
  });

  it('前端逐站時刻與後端展開一致（含系統增加緩衝、只給單班緩衝兩種情形）', () => {
    const cases = [
      trip({ dwellSlackSeconds: 12, plannedEndMinute: 600 + (320 + 14) / 60 }),
      trip({
        plannedEndMinute: 600 + (320 + 120) / 60,
        dwellSlackAdjustment: {
          baseSlackSeconds: 5, addedSeconds: 60,
          reason: { code: 'X', resourceId: 'd', resourceLabel: 'D', counterpartBlockIds: [], message: '' },
          affectedStops: [], blockBefore: { startMinute: 600, endMinute: 600 + 320 / 60 },
        },
      }),
    ];
    for (const block of cases) {
      const front = buildBlockStationDepartures(block, route).map((stop) => [
        stop.stationId, Math.round(stop.arrivalMinute * 60), Math.round(stop.departureMinute * 60), stop.dwellSeconds,
      ]);
      const back = buildTimetableStationStops(block as never, route as never).map((stop) => [
        stop.stationId, stop.arrivalSecond, stop.departureSecond, stop.dwellSeconds,
      ]);
      assert.deepEqual(back, front);
    }
  });

  it('卡片起訖分鐘是浮點（x/60 算不回整數秒）：前後端都取整秒，逐站時刻一致', () => {
    // 1959.9999999999998 秒：先前後端直接用浮點，行駛預算少 1 秒、整段晚一格對齊
    const legged = {
      ...route,
      avgTravelTimeSeconds: 145, minTravelTimeSeconds: 120, dwellSlackSeconds: 4,
      stationIds: ['a', 'b', 'c', 'd'],
      stationDwells: [
        { stationId: 'a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'b', stationName: 'B', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'c', stationName: 'C', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'd', stationName: 'D', dwellSeconds: 36, dwellMode: 'seconds', dwellRequired: true },
      ],
      stationLegTravels: [
        { fromStationId: 'a', toStationId: 'b', avgTravelTimeSeconds: 5, minTravelTimeSeconds: 5 },
        { fromStationId: 'b', toStationId: 'c', avgTravelTimeSeconds: 5, minTravelTimeSeconds: 5 },
        { fromStationId: 'c', toStationId: 'd', avgTravelTimeSeconds: 135, minTravelTimeSeconds: 110 },
      ],
    } as unknown as ShiftScheduleSelectedRoute;
    const block = trip({ plannedStartMinute: 1780 / 60, anchorStartMinute: 1780 / 60, plannedEndMinute: 1959.9999999999998 / 60 });
    const front = buildBlockStationDepartures(block, legged).map((stop) => [
      stop.stationId, Math.round(stop.arrivalMinute * 60), Math.round(stop.departureMinute * 60),
    ]);
    const back = buildTimetableStationStops(block as never, legged as never).map((stop) => [
      stop.stationId, stop.arrivalSecond, stop.departureSecond,
    ]);
    assert.deepEqual(back, front);
    assert.ok(back.every(([, arrival, departure]) => Number.isInteger(arrival) && Number.isInteger(departure)));
  });

  it('同一站在路線中出現兩次：兩次停靠都加緩衝，前後端一致', () => {
    const loop = {
      ...route,
      stationIds: ['a', 'b', 'a', 'd'],
      stationDwells: [
        { stationId: 'a', stationName: 'A', dwellSeconds: 0 },
        { stationId: 'b', stationName: 'B', dwellSeconds: 30 },
        { stationId: 'a', stationName: 'A', dwellSeconds: 20 },
        { stationId: 'd', stationName: 'D', dwellSeconds: 20 },
      ],
    } as unknown as ShiftScheduleSelectedRoute;
    const block = trip({
      plannedEndMinute: 600 + (240 + 70 + 3 * 5 + 3 * 30) / 60,
      dwellSlackAdjustment: {
        baseSlackSeconds: 5, addedSeconds: 30,
        reason: { code: 'X', resourceId: 'a', resourceLabel: 'A', counterpartBlockIds: [], message: '' },
        affectedStops: [], blockBefore: { startMinute: 600, endMinute: 600 + (240 + 70 + 15) / 60 },
      },
    });
    const stops = buildBlockStationDepartures(block, loop);
    assert.deepEqual(stops.map((stop) => stop.stationId), ['a', 'b', 'a', 'd']);
    assert.equal(stops[1]!.dwellSeconds, 30 + 35);
    assert.equal(stops[2]!.dwellSeconds, 20 + 35, '第二次經過 A 也加');
    const back = buildTimetableStationStops(block as never, loop as never);
    assert.deepEqual(
      back.map((stop) => [stop.stationId, stop.arrivalSecond, stop.departureSecond]),
      stops.map((stop) => [stop.stationId, Math.round(stop.arrivalMinute * 60), Math.round(stop.departureMinute * 60)]),
    );
  });

  it('跨午夜的班次：逐站時刻延續到隔日，前後端一致', () => {
    const block = trip({
      plannedStartMinute: 1438,
      anchorStartMinute: 1438,
      plannedEndMinute: 1438 + (320 + 60) / 60,
      dwellSlackAdjustment: {
        baseSlackSeconds: 5, addedSeconds: 30,
        reason: { code: 'X', resourceId: 'd', resourceLabel: 'D', counterpartBlockIds: [], message: '' },
        affectedStops: [], blockBefore: { startMinute: 1438, endMinute: 1438 + 320 / 60 },
      },
    });
    const stops = buildBlockStationDepartures(block, route);
    assert.ok(stops.at(-1)!.departureMinute > 1440, '末站落在隔日');
    for (let index = 1; index < stops.length; index += 1) {
      assert.ok(stops[index]!.arrivalMinute >= stops[index - 1]!.departureMinute, '時刻不回頭');
    }
    const back = buildTimetableStationStops(block as never, route as never);
    assert.deepEqual(
      back.map((stop) => [stop.stationId, stop.arrivalSecond, stop.departureSecond]),
      stops.map((stop) => [stop.stationId, Math.round(stop.arrivalMinute * 60), Math.round(stop.departureMinute * 60)]),
    );
  });
});
