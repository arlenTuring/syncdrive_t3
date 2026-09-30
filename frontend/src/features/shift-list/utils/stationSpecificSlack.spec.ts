import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import { buildBlockStationDepartures, resolveBlockDurationBounds } from './buildBlockStationDepartures';

/** 名稱、時刻都只是測試資料 */
const route = {
  routeId: 'r', routeName: 'A>D', stationIds: ['a', 'b', 'c', 'd'],
  stationDwells: [
    { stationId: 'a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
    { stationId: 'b', stationName: 'B', dwellSeconds: 30, dwellMode: 'seconds' },
    { stationId: 'c', stationName: 'C', dwellSeconds: 30, dwellMode: 'seconds' },
    { stationId: 'd', stationName: 'D', dwellSeconds: 30, dwellMode: 'seconds' },
  ],
  stationLegTravels: [], avgTravelTimeSeconds: 180, minTravelTimeSeconds: 150, dwellSlackSeconds: 0,
} as unknown as ShiftScheduleSelectedRoute;

const block = (adjustment?: GeneratedScheduleBlock['dwellSlackAdjustment'], extraMinutes = 0): GeneratedScheduleBlock => ({
  id: 'trip', timelineRow: 1, taskType: 'passenger', label: 'A>D', routeId: 'r',
  anchorStartMinute: 600, plannedStartMinute: 600, plannedEndMinute: 600 + 270 / 60 + extraMinutes,
  travelSeconds: 180, dwellSeconds: 90, source: 'template_bar',
  ...(adjustment ? { dwellSlackAdjustment: adjustment } : {}),
} as GeneratedScheduleBlock);

const reason = { code: 'STATION_BERTH_PROTECTION_GAP', resourceId: 'c', resourceLabel: 'C', counterpartBlockIds: [], message: '' };

describe('解衝突的等待只加在指定站（白皮書 GEN-03）', () => {
  it('指定在 B 站多等 40 秒：只有 B 的停靠變長，C、D 不變', () => {
    const adjusted = block({ baseSlackSeconds: 0, addedSeconds: 40, stationIndex: 1, reason, affectedStops: [], blockBefore: { startMinute: 600, endMinute: 604.5 } }, 40 / 60);
    const stops = buildBlockStationDepartures(adjusted, route);
    assert.deepEqual(stops.map((stop) => stop.dwellSeconds), [0, 70, 30, 30]);
    const bounds = resolveBlockDurationBounds(adjusted, route)!;
    assert.equal(bounds.dwellSeconds, 130, '停靠合計只多 40 秒');
  });

  it('舊紀錄（沒有指定站）照舊每個適用站都加', () => {
    const legacy = block({ baseSlackSeconds: 0, addedSeconds: 10, reason, affectedStops: [], blockBefore: { startMinute: 600, endMinute: 604.5 } }, 30 / 60);
    const stops = buildBlockStationDepartures(legacy, route);
    assert.deepEqual(stops.map((stop) => stop.dwellSeconds), [0, 40, 40, 40]);
  });
});
