import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alignRouteWithVehicleLocation } from './alignRouteWithVehicleLocation';
import type { GeneratedSchedulePlan } from './schedule-engine/types';

/**
 * 複製 SB1938 的形狀：<strong>跨午夜</strong>的待命停在備用站位，
 * 接著的載客卻被指派了從主線站位出發的路線。
 *
 * 跨午夜是關鍵——待命 19:38–24:00、載客 00:11，照 plannedStartMinute 線性排序時
 * 載客排在陣列最前面、待命排在最後面，取「前一個」會拿到清晨的卡，
 * 於是整段邏輯對跨午夜的待命完全失效。
 */
const route = (
  routeId: string,
  stationIds: string[],
  routeName: string,
) => ({
  routeId,
  instanceId: routeId,
  routeCode: routeId,
  routeName,
  stationIds,
  stationDwells: stationIds.map((stationId) => ({
    stationId,
    stationName: stationId === 'st-main' ? 'N2W下行出發' : '[備用]N2W下行出發',
    dwellSeconds: 0,
  })),
  minTravelTimeSeconds: 300,
  avgTravelTimeSeconds: 300,
  dwellSlackSeconds: 0,
  switchBufferAfterSeconds: 0,
});

/** 前一段載客（結束在 N2W）→ 後繼有主線 NT 與備用 NTB，兩者終點都是 T3 */
const ROUTES = [
  route('TN', ['st-t3', 'st-main'], 'T3>N2W'),
  route('NT', ['st-main', 'st-t3'], 'N2W>T3'),
  route('NTB', ['st-backup', 'st-t3'], '[備用]N2W>T3'),
] as never as Parameters<typeof alignRouteWithVehicleLocation>[0]['selectedRoutes'];

const POLICY = {
  routesByInstanceId: new Map(
    (ROUTES as never as Array<{ instanceId: string }>).map((r) => [r.instanceId, r]),
  ),
  prioritySuccessors: new Map([['TN', ['NT']]]),
  secondarySuccessors: new Map([['TN', ['NTB']]]),
  rotationRoutes: [],
} as never as Parameters<typeof alignRouteWithVehicleLocation>[0]['successorPolicy'];

function planWithParkedStandby(parkedStationId: string | undefined) {
  return [
    {
      row: 2,
      blocks: [
        // 00:11 的載客——線性排序時它排在最前面
        {
          id: 'pax-next', timelineRow: 2, taskType: 'passenger', label: 'NT',
          routeId: 'NT', routeInstanceId: 'NT',
          anchorStartMinute: 11.5, plannedStartMinute: 11.5, plannedEndMinute: 15,
          travelSeconds: 210, dwellSeconds: 0, source: 'template_bar',
        },
        // 前一段載客，結束在 N2W
        {
          id: 'pax-prev', timelineRow: 2, taskType: 'passenger', label: 'TN',
          routeId: 'TN', routeInstanceId: 'TN',
          anchorStartMinute: 19 * 60, plannedStartMinute: 19 * 60, plannedEndMinute: 19 * 60 + 30,
          travelSeconds: 1800, dwellSeconds: 0, source: 'template_bar',
        },
        // 跨午夜的待命，停在備用站位
        {
          id: 'standby', timelineRow: 2, taskType: 'standby', label: '待命',
          anchorStartMinute: 19 * 60 + 38, plannedStartMinute: 19 * 60 + 38,
          plannedEndMinute: 24 * 60,
          travelSeconds: 0, dwellSeconds: 0, source: 'template_bar',
          yardFacilityStationId: parkedStationId,
          yardFacilityLabel: '[備用]N2W下行出發',
        },
      ],
    },
  ] as never as GeneratedSchedulePlan['timelines'];
}

describe('車停在哪，下一班就從那裡發', () => {
  it('跨午夜的待命也要算——線性取「前一個」會拿到清晨的卡', () => {
    const timelines = planWithParkedStandby('st-backup');
    const result = alignRouteWithVehicleLocation({
      timelines,
      selectedRoutes: ROUTES,
      successorPolicy: POLICY,
    });

    assert.equal(result.swapped, 1);
    const next = timelines[0]!.blocks.find((b) => b.id === 'pax-next')!;
    assert.equal(next.routeId, 'NTB', '應改成從車所在的備用站位出發');
  });

  it('車已經停在該路線的起點就不動', () => {
    const timelines = planWithParkedStandby('st-main');
    const result = alignRouteWithVehicleLocation({
      timelines,
      selectedRoutes: ROUTES,
      successorPolicy: POLICY,
    });
    assert.equal(result.swapped, 0);
    assert.equal(timelines[0]!.blocks.find((b) => b.id === 'pax-next')!.routeId, 'NT');
  });

  it('待命停在設施格（沒有站位）就沒有可談的', () => {
    const timelines = planWithParkedStandby(undefined);
    const result = alignRouteWithVehicleLocation({
      timelines,
      selectedRoutes: ROUTES,
      successorPolicy: POLICY,
    });
    assert.equal(result.swapped, 0);
  });
});
