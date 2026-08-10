import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildScheduleAnalysisReport,
  resolveRotationCycleSeconds,
} from './buildScheduleAnalysisReport';
import type { GeneratedSchedulePlan } from './schedule-engine/types';

/** 兩段對開：A 站 → B 站 → A 站，各 300 秒行駛、無停靠 */
const ROUTES = [
  {
    routeId: 'ab',
    routeCode: 'AB',
    routeName: 'A>B',
    stationIds: ['station_a', 'station_b'],
    stationDwells: [
      { stationId: 'station_a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'station_b', stationName: 'B', dwellSeconds: 0, dwellRequired: false },
    ],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
  {
    routeId: 'ba',
    routeCode: 'BA',
    routeName: 'B>A',
    stationIds: ['station_b', 'station_a'],
    stationDwells: [
      { stationId: 'station_b', stationName: 'B', dwellSeconds: 0, dwellRequired: false },
      { stationId: 'station_a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
    ],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
] as never as Parameters<typeof buildScheduleAnalysisReport>[0]['passengerRoutes'];

const INTERVALS = [
  {
    id: 'iv1',
    attributeId: 'attr1',
    name: '尖峰',
    startTime: '08:00',
    endTime: '09:00',
    isDraft: false,
  },
] as never as Parameters<typeof buildScheduleAnalysisReport>[0]['intervals'];

/** 班距 600 秒；一輪往返 600 秒 → 需求恰好 1.0 台 */
const ATTRIBUTES = [
  {
    id: 'attr1',
    name: '尖峰屬性',
    color: '#fff',
    headwaySeconds: 600,
    capacityPphpd: 0,
    isDraft: false,
  },
] as never as Parameters<typeof buildScheduleAnalysisReport>[0]['attributes'];

/**
 * 每一列都<strong>整個時段</strong>都在跑正線（08:00–09:00 連續發車）。
 *
 * 「實際」比的是同一時刻平均有幾台在線上，不是這個時段出現過幾條時間線，
 * 所以 fixture 必須讓車真的整段都在跑；只排一段 5 分鐘的班次代表的是
 * 「平均 0.08 台」，那跟 rowCount 是兩回事。
 */
function planWithRows(rowCount: number): GeneratedSchedulePlan {
  const timelines = [];
  for (let row = 1; row <= rowCount; row += 1) {
    const blocks = [];
    for (let leg = 0; leg < 12; leg += 1) {
      blocks.push({
        id: `blk-${row}-${leg}`,
        timelineRow: row,
        taskType: 'passenger',
        label: 'A>B',
        routeId: 'ab',
        anchorStartMinute: 8 * 60 + leg * 5,
        plannedStartMinute: 8 * 60 + leg * 5,
        plannedEndMinute: 8 * 60 + leg * 5 + 5,
        travelSeconds: 300,
        dwellSeconds: 0,
        source: 'template_bar',
      });
    }
    timelines.push({ row, blocks });
  }
  return { timelines } as never as GeneratedSchedulePlan;
}

function run(rowCount: number) {
  return buildScheduleAnalysisReport({
    plan: planWithRows(rowCount),
    intervals: INTERVALS,
    attributes: ATTRIBUTES,
    passengerRoutes: ROUTES,
    selectedRoutes: ROUTES,
    minimumRecoveryTimeSeconds: 0,
    collisionProtectionSeconds: 30,
  });
}

describe('buildScheduleAnalysisReport', () => {
  it('一輪往返 = 各段占用加總（同站折返不加恢復時間）', () => {
    assert.equal(resolveRotationCycleSeconds(ROUTES, 0), 600);
  });

  it('需求車數 = 一輪往返 ÷ 目標班距', () => {
    const report = run(1);
    const row = report.fleet[0]!;
    assert.equal(row.cycleSeconds, 600);
    assert.equal(row.targetHeadwaySeconds, 600);
    assert.equal(row.requiredVehicles, 1);
  });

  it('車比需求多會算出過剩，並產生 FLEET_SURPLUS 建議', () => {
    const report = run(4);
    const row = report.fleet[0]!;
    assert.equal(row.actualVehicles, 4);
    assert.equal(row.surplusVehicles, 3);
    const surplus = report.suggestions.filter((s) => s.code === 'FLEET_SURPLUS');
    assert.equal(surplus.length, 1);
    assert.match(surplus[0]!.message, /多 3\.0 台/);
    assert.equal(report.hasFindings, true);
  });

  it('車剛好等於需求時不產生任何建議', () => {
    const report = run(1);
    assert.equal(report.fleet[0]!.surplusVehicles, 0);
    assert.equal(report.suggestions.length, 0);
    assert.equal(report.hasFindings, false);
  });

  it('同一條式子也講得出「車不夠」', () => {
    const report = buildScheduleAnalysisReport({
      plan: planWithRows(1),
      intervals: INTERVALS,
      // 班距縮到 200 秒 → 需求 3 台，只有 1 台
      attributes: [{ ...ATTRIBUTES[0]!, headwaySeconds: 200 }] as never,
      passengerRoutes: ROUTES,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 30,
    });
    assert.equal(report.fleet[0]!.requiredVehicles, 3);
    assert.equal(report.fleet[0]!.surplusVehicles, -2);
    const shortage = report.suggestions.filter((s) => s.code === 'FLEET_SHORTAGE');
    assert.equal(shortage.length, 1);
    assert.match(shortage[0]!.message, /少 2\.0 台/);
  });

  it('時段屬性沒設班距時不做供需判斷，不亂報', () => {
    const report = buildScheduleAnalysisReport({
      plan: planWithRows(4),
      intervals: INTERVALS,
      attributes: [{ ...ATTRIBUTES[0]!, headwaySeconds: null }] as never,
      passengerRoutes: ROUTES,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 30,
    });
    assert.equal(report.fleet[0]!.requiredVehicles, null);
    assert.equal(report.fleet[0]!.surplusVehicles, null);
    assert.equal(
      report.suggestions.filter((s) => s.code.startsWith('FLEET_')).length,
      0,
    );
  });

  it('沒有提供關聯圖時，替代停靠數是 null（不知道）而不是 0（確定沒有）', () => {
    // 四台車同時停在同一站 → 一定會有 BERTH_OVERFLOW
    const report = run(4);
    for (const berth of report.berths) {
      assert.equal(berth.alternativeBerthCount, null);
    }
    assert.equal(
      report.suggestions.filter((s) => s.code === 'NO_ALTERNATIVE_BERTH').length,
      0,
    );
  });
});
