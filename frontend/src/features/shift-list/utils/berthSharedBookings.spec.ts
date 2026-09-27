import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import { bookBerthWindowsExcept, movedTripLingerCollides } from './stationBerthConstraint';

const tn = {
  instanceId: 'tn', routeId: 'tn', routeName: 'TN', routeCode: 'TN', groupName: 'g', executionOrder: 1,
  avgTravelTimeSeconds: 120, minTravelTimeSeconds: 100, switchBufferAfterSeconds: 0, dwellSlackSeconds: 0,
  stationIds: ['T3', 'P1'],
  stationDwells: [
    { stationId: 'T3', stationName: 'T3', dwellSeconds: 0 },
    { stationId: 'P1', stationName: 'P1', dwellSeconds: 0 },
  ],
  stationLegTravels: [{ fromStationId: 'T3', toStationId: 'P1', avgTravelTimeSeconds: 120, minTravelTimeSeconds: 100 }],
  stationDwellsConfirmed: true, backupForInstanceId: null, backupForRouteId: null,
} as unknown as ShiftScheduleSelectedRoute;

function pax(id: string, row: number, startMinute: number): GeneratedScheduleBlock {
  return {
    id, timelineRow: row, taskType: 'passenger', label: '正線', source: 'template_bar',
    routeId: 'tn', routeCode: 'TN', travelSeconds: 120, dwellSeconds: 0,
    anchorStartMinute: startMinute, plannedStartMinute: startMinute, plannedEndMinute: startMinute + 2,
  } as GeneratedScheduleBlock;
}

describe('bookBerthWindowsExcept', () => {
  it('明確停在正線停靠站的待命也算預約', () => {
    const standby = {
      id: 'stby', timelineRow: 2, taskType: 'standby', label: '待命', source: 'template_bar',
      travelSeconds: 0, dwellSeconds: 0, anchorStartMinute: 600, plannedStartMinute: 600, plannedEndMinute: 630,
      yardFacilityNodeId: 'p1-dock', yardFacilityStationId: 'P1', yardFacilityLabel: 'P1',
    } as GeneratedScheduleBlock;
    const booked = bookBerthWindowsExcept(
      [{ row: 1, blocks: [pax('a', 1, 500)] }, { row: 2, blocks: [standby] }],
      [tn],
      'a',
      { collisionProtectionSeconds: 30 },
    );
    const p1 = booked.find((win) => win.blockId === 'stby');
    assert.ok(p1, '待命不能在站位預約裡消失');
    assert.equal(p1!.stationId, 'P1');
    assert.equal(p1!.endSecond, 630 * 60 + 60);
  });
});

describe('movedTripLingerCollides', () => {
  it('整班往前拉讓終點站提早到、停更久，撞到別台車就擋', () => {
    // a：10:00 發、10:02 到 P1，下一班 10:10 才從 P1 發——往前拉到 09:57 會在 P1 從 09:59 等到 10:10
    const a = pax('a', 1, 600);
    const next = { ...pax('a2', 1, 610), routeId: 'back', routeCode: 'BK' };
    const back = { ...tn, routeId: 'back', instanceId: 'back', stationIds: ['P1', 'T3'] } as ShiftScheduleSelectedRoute;
    const other = pax('b', 2, 598); // b 10:00 到 P1
    const timelines = [{ row: 1, blocks: [a, next] }, { row: 2, blocks: [other] }];
    const booked = bookBerthWindowsExcept(timelines, [tn, back], 'a', { collisionProtectionSeconds: 30 });
    const collides = movedTripLingerCollides({
      timelines,
      selectedRoutes: [tn, back],
      block: a,
      route: tn,
      newStartSecond: 597 * 60,
      newEndSecond: 599 * 60,
      booked,
      protection: { collisionProtectionSeconds: 30 },
    });
    assert.equal(collides, true);
  });
});
