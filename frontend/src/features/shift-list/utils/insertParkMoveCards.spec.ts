import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import {
  PARK_IDLE_THRESHOLD_SECONDS,
  insertParkMoveCards,
} from './insertParkMoveCards';
import type { GeneratedSchedulePlan } from './schedule-engine/types';

function edge(from: string, to: string, seconds: number) {
  return {
    id: `e:${from}->${to}`,
    fromNodeId: from,
    toNodeId: to,
    minTravelTimeSeconds: seconds,
    avgTravelTimeSeconds: seconds,
    distanceMeters: null,
  };
}

/** 終點站 END ──60s──> H1 ──90s──> 起點站 START（雙向都要有邊才進得去又出得來） */
function topology(): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      {
        id: 'n-end',
        kind: 'docking',
        label: '終點',
        stationId: 'station_end',
        x: 0,
        y: 0,
        color: '#111111',
      },
      {
        id: 'n-start',
        kind: 'docking',
        label: '首站',
        stationId: 'station_start',
        x: 0,
        y: 0,
        color: '#111111',
      },
      { id: 'H1', kind: 'facility', label: 'H1', x: 0, y: 0, color: '#222222' },
    ],
    edges: [edge('n-end', 'H1', 60), edge('H1', 'n-start', 90)],
  };
}

const ROUTES = [
  {
    routeId: 'in',
    routeCode: 'IN',
    routeName: '進場方向',
    stationIds: ['station_start', 'station_end'],
    stationDwells: [],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
  {
    routeId: 'out',
    routeCode: 'OUT',
    routeName: '出場方向',
    stationIds: ['station_start', 'station_end'],
    stationDwells: [],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
] as never as Parameters<typeof insertParkMoveCards>[0]['selectedRoutes'];

const BODY = {
  parking: { stepEnabled: true, equipmentRows: [{ id: 'p1', mapCode: 'H1' }] },
};

/** 前段 08:00–08:30（停在 station_end），後段從 station_start 於 gapMinutes 後發車 */
function plan(gapMinutes: number): GeneratedSchedulePlan {
  const beforeEnd = 8 * 60 + 30;
  const afterStart = beforeEnd + gapMinutes;
  return {
    timelines: [
      {
        row: 1,
        blocks: [
          {
            id: 'before',
            timelineRow: 1,
            taskType: 'passenger',
            label: 'IN',
            routeId: 'in',
            anchorStartMinute: 8 * 60,
            plannedStartMinute: 8 * 60,
            plannedEndMinute: beforeEnd,
            travelSeconds: 300,
            dwellSeconds: 0,
            source: 'template_bar',
          },
          {
            id: 'after',
            timelineRow: 1,
            taskType: 'passenger',
            label: 'OUT',
            routeId: 'out',
            anchorStartMinute: afterStart,
            plannedStartMinute: afterStart,
            plannedEndMinute: afterStart + 30,
            travelSeconds: 300,
            dwellSeconds: 0,
            source: 'template_bar',
          },
        ],
      },
    ],
  } as never as GeneratedSchedulePlan;
}

function run(p: GeneratedSchedulePlan, body: unknown = BODY) {
  return insertParkMoveCards({
    timelines: p.timelines,
    topology: topology(),
    maintenanceBody: body as Record<string, unknown>,
    selectedRoutes: ROUTES,
    minimumRecoveryTimeSeconds: 0,
  });
}

describe('insertParkMoveCards（調度入／出廠卡 PI／PO）', () => {
  it('空檔夠長時插入一對 PI／PO', () => {
    const p = plan(30);
    const result = run(p);
    assert.equal(result.inserted, 1);
    const pi = p.timelines[0]!.blocks.find((b) => b.source === 'park_entry_move')!;
    const po = p.timelines[0]!.blocks.find((b) => b.source === 'park_exit_move')!;
    assert.equal(pi.source, 'park_entry_move');
    assert.equal(po.source, 'park_exit_move');
    assert.equal(pi.yardExitFacilityLabel, 'H1');
    // 沒有固定的 PI／PO 標籤，調度視為整備的第六種類型，標籤同樣是動態算的
    assert.equal(pi.yardExitSectionLabel, '調度');
    assert.equal(po.yardExitSectionLabel, '調度');
  });

  it('PI 接在完整載客段之後——先把客人放下才進廠', () => {
    const p = plan(30);
    run(p);
    const before = p.timelines[0]!.blocks.find((b) => b.id === 'before')!;
    const pi = p.timelines[0]!.blocks.find((b) => b.source === 'park_entry_move')!;
    assert.equal(before.plannedEndMinute, 8 * 60 + 30, '前一段載客不得被砍短');
    assert.equal(pi.plannedStartMinute, before.plannedEndMinute);
    assert.equal(pi.plannedEndMinute, before.plannedEndMinute + 1, '進場 60 秒');
  });

  it('PO 結束時刻貼齊下一段發車，接得回正線', () => {
    const p = plan(30);
    run(p);
    const after = p.timelines[0]!.blocks.find((b) => b.id === 'after')!;
    const po = p.timelines[0]!.blocks.find((b) => b.source === 'park_exit_move')!;
    assert.equal(po.plannedEndMinute, after.plannedStartMinute);
    assert.equal(po.plannedStartMinute, after.plannedStartMinute - 1.5, '出場 90 秒');
    assert.equal(after.plannedStartMinute, 9 * 60, '下一段班次時刻不得被改動');
  });

  it('空檔沒到門檻就不進廠（來回移動划不來）', () => {
    const shortGapMinutes = PARK_IDLE_THRESHOLD_SECONDS / 60 - 1;
    const result = run(plan(shortGapMinutes));
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 0, '沒到門檻是正常情況，不該回報');
  });

  it('門檻可由呼叫端覆寫', () => {
    const p = plan(10);
    const result = insertParkMoveCards({
      timelines: p.timelines,
      topology: topology(),
      maintenanceBody: BODY,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
      idleThresholdSeconds: 300,
    });
    assert.equal(result.inserted, 1);
  });

  it('來回時間塞不進空檔就不插', () => {
    const p = plan(30);
    const slow = topology();
    // 進場 60 秒改成 30 分鐘，來回就超過空檔
    slow.edges = slow.edges.map((e) =>
      e.fromNodeId === 'n-end'
        ? { ...e, minTravelTimeSeconds: 1800, avgTravelTimeSeconds: 1800 }
        : e,
    );
    const result = insertParkMoveCards({
      timelines: p.timelines,
      topology: slow,
      maintenanceBody: BODY,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
    });
    assert.equal(result.inserted, 0);
    assert.match(result.skipped[0]!.reason, /進不去或出不來/);
  });

  it('出得去但回不來時不插——不能把車丟在設施裡', () => {
    const p = plan(30);
    const oneWay = topology();
    oneWay.edges = oneWay.edges.filter((e) => e.fromNodeId !== 'H1');
    const result = insertParkMoveCards({
      timelines: p.timelines,
      topology: oneWay,
      maintenanceBody: BODY,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
    });
    assert.equal(result.inserted, 0);
    assert.match(result.skipped[0]!.reason, /進不去或出不來/);
  });

  it('沒設定調度設施時安靜略過，不當成錯誤', () => {
    const result = run(plan(30), { parking: { stepEnabled: true, equipmentRows: [] } });
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 0);
  });

  it('同一台設施同一時段不給兩列車用', () => {
    const p = plan(30);
    // 複製一列同時段的車
    const clone = JSON.parse(JSON.stringify(p.timelines[0])) as typeof p.timelines[number];
    clone.row = 2;
    for (const block of clone.blocks) {
      block.timelineRow = 2;
      block.id = `${block.id}-r2`;
    }
    p.timelines.push(clone);

    const result = run(p);
    assert.equal(result.inserted, 1, '只有一列停得進 H1');
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!.reason, /都被別列車佔著/);
  });
});
