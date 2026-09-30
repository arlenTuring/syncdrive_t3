import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology, type PointTopology } from '../../map-editor/types/pointTopology';
import { insertMaintenanceTransferCards } from './insertMaintenanceTransferCards';
import { collectPlanViolations } from './schedule-engine/evaluatePlan';
import type { GeneratedScheduleBlock, GeneratedSchedulePlan } from './schedule-engine/types';

/**
 * 轉場與佔用的重算。
 *
 * 情境（名稱與時刻都只是測試資料）：兩台車共用一台充電設施 C1。
 * - 列 1：充電到 09:56，下一班 10:01 從站 S 發車。出廠 C1 → S 要 300 秒，09:56 一做完就離格
 *   （作業類整備不吃尾巴，白皮書 YARD-07）。
 * - 列 2：待命格 P1 待到 09:58，接著在 C1 充電到 10:00:30（時段很緊，沒有往後挪的空間）。
 *
 * 轉場階段排在出廠階段之前：排列 2 的「待命 → 充電」時，列 1 的出廠卡還沒排，列 1 在 C1 的
 * 佔用暫時算到下一班發車（10:01），轉場被判失敗。出廠階段排完後 C1 09:56 就空了——
 * 必須用最新的佔用重算，舊的失敗不能留在結果裡。
 */

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

function topology(): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      { id: 'n-s', kind: 'docking', label: 'S', stationId: 'station_s', x: 0, y: 0, color: '#111111' },
      { id: 'C1', kind: 'facility', label: 'C1', x: 0, y: 0, color: '#222222' },
      { id: 'P1', kind: 'facility', label: 'P1', x: 0, y: 0, color: '#333333' },
    ],
    edges: [
      edge('C1', 'n-s', 300),
      edge('n-s', 'C1', 60),
      edge('P1', 'C1', 60),
      edge('n-s', 'P1', 60),
      edge('P1', 'n-s', 60),
    ],
  };
}

const ROUTES = [
  {
    routeId: 'sa',
    routeCode: 'SA',
    routeName: 'S>A',
    stationIds: ['station_s', 'station_a'],
    stationDwells: [],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
  {
    routeId: 'as',
    routeCode: 'AS',
    routeName: 'A>S',
    stationIds: ['station_a', 'station_s'],
    stationDwells: [],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'];

const BODY = {
  charging: { stepEnabled: true, equipmentRows: [{ id: 'c', mapCode: 'C1' }] },
  mobile: { stepEnabled: true, equipmentRows: [{ id: 'p', mapCode: 'P1' }] },
};

const minute = (hh: number, mm: number, ss = 0) => hh * 60 + mm + ss / 60;

function block(partial: Partial<GeneratedScheduleBlock> & Pick<GeneratedScheduleBlock, 'id' | 'timelineRow' | 'taskType'>): GeneratedScheduleBlock {
  return {
    label: partial.taskType,
    anchorStartMinute: partial.plannedStartMinute ?? 0,
    plannedStartMinute: 0,
    plannedEndMinute: 0,
    travelSeconds: 0,
    dwellSeconds: 0,
    source: 'template_bar',
    ...partial,
  } as GeneratedScheduleBlock;
}

function plan(): GeneratedSchedulePlan {
  return {
    timelines: [
      {
        row: 1,
        blocks: [
          block({ id: 'r1-in', timelineRow: 1, taskType: 'passenger', routeId: 'as', plannedStartMinute: minute(8, 0), plannedEndMinute: minute(8, 30) }),
          block({ id: 'r1-charge', timelineRow: 1, taskType: 'charging', plannedStartMinute: minute(8, 31), plannedEndMinute: minute(9, 56) }),
          block({ id: 'r1-out', timelineRow: 1, taskType: 'passenger', routeId: 'sa', plannedStartMinute: minute(10, 1), plannedEndMinute: minute(10, 31) }),
        ],
      },
      {
        row: 2,
        blocks: [
          block({ id: 'r2-in', timelineRow: 2, taskType: 'passenger', routeId: 'as', plannedStartMinute: minute(5, 0), plannedEndMinute: minute(5, 30) }),
          block({ id: 'r2-standby', timelineRow: 2, taskType: 'standby', plannedStartMinute: minute(6, 0), plannedEndMinute: minute(9, 58) }),
          block({ id: 'r2-charge', timelineRow: 2, taskType: 'charging', plannedStartMinute: minute(9, 58), plannedEndMinute: minute(10, 0, 30) }),
          block({ id: 'r2-out', timelineRow: 2, taskType: 'passenger', routeId: 'sa', plannedStartMinute: minute(10, 20), plannedEndMinute: minute(10, 50) }),
        ],
      },
    ],
  } as never as GeneratedSchedulePlan;
}

function run(timelines: GeneratedSchedulePlan['timelines']) {
  return insertMaintenanceTransferCards({
    timelines,
    topology: topology(),
    maintenanceBody: BODY,
    selectedRoutes: ROUTES,
    minimumRecoveryTimeSeconds: 0,
    collisionProtectionSeconds: 0,
  });
}

const transitCards = (timelines: GeneratedSchedulePlan['timelines'], row: number) =>
  timelines.find((timeline) => timeline.row === row)!.blocks.filter((item) => item.id.startsWith('yardtransit-'));

describe('轉場與佔用重算', () => {
  it('別列出廠卡提早離格後，先前判定「設施被佔」的轉場要重算成功，舊錯誤消失', () => {
    const result = run(plan().timelines);
    // 列 1 充電 09:56 做完就出廠，離開 C1（出廠之前，列 1 在 C1 的佔用暫時算到 10:01 發車）
    const exit = result.timelines.find((timeline) => timeline.row === 1)!.blocks
      .find((item) => item.source === 'yard_exit_move');
    assert.ok(exit, '列 1 要有出廠卡');
    assert.ok(Math.abs(exit!.plannedStartMinute - minute(9, 56)) < 1e-6, `出廠 ${exit!.plannedStartMinute}`);
    // 列 2 的待命 → 充電 有一組轉場卡，不留失敗
    const failed = result.skipped.filter((skip) => skip.timelineRow === 2 && skip.necessity !== 'not_needed');
    assert.deepEqual(failed.map((skip) => skip.reason), []);
    assert.equal(transitCards(result.timelines, 2).length, 2);
  });

  it('對同一份輸入重算，不會重複插卡', () => {
    const first = run(plan().timelines);
    const second = run(plan().timelines);
    const ids = (timelines: GeneratedSchedulePlan['timelines']) =>
      timelines.flatMap((timeline) => timeline.blocks.map((item) => item.id)).sort();
    assert.deepEqual(ids(first.timelines), ids(second.timelines));
    const all = ids(first.timelines);
    assert.equal(new Set(all).size, all.length, '卡片 id 不可重複');
  });

  it('轉場成功後，別列被調整到同一段時間佔用同一台設施，最終驗證要重新報錯', () => {
    const result = run(plan().timelines);
    // 事後把列 1 的充電拉長到 10:00:10、出廠卡跟著晚走：跟列 2 在 C1 重疊
    const row1 = result.timelines.find((timeline) => timeline.row === 1)!;
    const charge = row1.blocks.find((item) => item.id === 'r1-charge')!;
    charge.plannedEndMinute = minute(10, 0, 10);
    const exit = row1.blocks.find((item) => item.source === 'yard_exit_move')!;
    exit.plannedStartMinute = minute(10, 0, 10);
    exit.anchorStartMinute = exit.plannedStartMinute;
    const violations = collectPlanViolations({
      selectedRoutes: ROUTES, routeById: new Map(), passengerRoutes: [], minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 0, intervals: [], attributes: [], scheduleRowCount: 2,
    }, result.timelines);
    assert.ok(
      violations.some((item) => item.code === 'FACILITY_SLOT_COLLISION' && item.severity !== 'quality'),
      `應報設施重疊，實際：${violations.map((item) => item.code).join('、')}`,
    );
  });
});

describe('轉折點保留：那一列真的排出移動後，舊保留作廢', () => {
  const entryOf = (timelines: GeneratedSchedulePlan['timelines'], row: number) =>
    timelines.find((timeline) => timeline.row === row)!.blocks.find((item) => item.source === 'yard_entry_move'
      && item.id.startsWith('yardentry-'));
  const runWith = (reserved: Array<{ nodeId: string; instant: number; timelineRow: number }>) =>
    insertMaintenanceTransferCards({
      timelines: plan().timelines,
      topology: topology(),
      maintenanceBody: BODY,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 30,
      reservedJunctionPasses: reserved,
    });

  it('列 1 的保留（落在列 2 進廠經過 S 的時刻）在列 1 自己排出進廠後就不再擋列 2', () => {
    const free = entryOf(runWith([]).timelines, 2);
    assert.ok(free, '列 2 要有入廠卡');
    // 列 2 進廠經過 S 的時刻（入廠卡出發那一刻）
    const instant = Math.round(free!.plannedStartMinute * 60);
    // 保留給「永遠不會排移動」的列：真的會擋，列 2 得挪開——證明這個測試量得到保留的效果
    const blocked = entryOf(runWith([{ nodeId: 'n-s', instant, timelineRow: 99 }]).timelines, 2);
    assert.notEqual(blocked?.plannedStartMinute, free!.plannedStartMinute);
    // 保留給列 1：列 1 先排、真的經過 S 之後，這筆保留就作廢，列 2 照原本時刻進廠
    const released = entryOf(runWith([{ nodeId: 'n-s', instant, timelineRow: 1 }]).timelines, 2);
    assert.equal(released?.plannedStartMinute, free!.plannedStartMinute);
  });
});

describe('待命位置替換', () => {
  /**
   * 車 08:30 跑完到站 S，接著待命到 10:30，下一班從站 T 發車。
   * 「決定去哪」依進出總成本挑了 P1（S→P1 400 秒、P1→T 10 秒），但 400 秒的入廠塞不進
   * 待命開始前的可挪範圍。待命清單上還有 P2（S→P2 60 秒、P2→T 600 秒）：要改停 P2，
   * 入廠、停留、出廠都照 P2 重算，並回報換了位置。
   */
  function relocationTopology(): PointTopology {
    return {
      ...emptyPointTopology(),
      nodes: [
        { id: 'n-s', kind: 'docking', label: 'S', stationId: 'station_s', x: 0, y: 0, color: '#111111' },
        { id: 'n-t', kind: 'docking', label: 'T', stationId: 'station_t', x: 0, y: 0, color: '#111111' },
        { id: 'P1', kind: 'facility', label: 'P1', x: 0, y: 0, color: '#222222' },
        { id: 'P2', kind: 'facility', label: 'P2', x: 0, y: 0, color: '#222222' },
      ],
      edges: [
        edge('n-s', 'P1', 400),
        edge('P1', 'n-t', 10),
        edge('n-s', 'P2', 60),
        edge('P2', 'n-t', 600),
      ],
    };
  }
  const routes = [
    { routeId: 'as', routeCode: 'AS', routeName: 'A>S', stationIds: ['station_a', 'station_s'], stationDwells: [],
      minTravelTimeSeconds: 300, avgTravelTimeSeconds: 300, dwellSlackSeconds: 0, switchBufferAfterSeconds: 0 },
    { routeId: 'ta', routeCode: 'TA', routeName: 'T>A', stationIds: ['station_t', 'station_a'], stationDwells: [],
      minTravelTimeSeconds: 300, avgTravelTimeSeconds: 300, dwellSlackSeconds: 0, switchBufferAfterSeconds: 0 },
  ] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'];

  it('原定位置到不了時改停待命清單上另一個位置，整組重算並回報', () => {
    const timelines = [{
      row: 1,
      blocks: [
        block({ id: 'in', timelineRow: 1, taskType: 'passenger', routeId: 'as', plannedStartMinute: minute(8, 0), plannedEndMinute: minute(8, 30) }),
        block({ id: 'standby', timelineRow: 1, taskType: 'standby', plannedStartMinute: minute(8, 30), plannedEndMinute: minute(10, 30) }),
        block({ id: 'out', timelineRow: 1, taskType: 'passenger', routeId: 'ta', plannedStartMinute: minute(10, 40), plannedEndMinute: minute(11, 10) }),
      ],
    }] as never as GeneratedSchedulePlan['timelines'];
    const result = insertMaintenanceTransferCards({
      timelines,
      topology: relocationTopology(),
      maintenanceBody: { mobile: { stepEnabled: true, equipmentRows: [{ id: 'a', mapCode: 'P1' }, { id: 'b', mapCode: 'P2' }] } },
      selectedRoutes: routes,
      minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 30,
    });
    const standby = result.timelines[0]!.blocks.find((item) => item.id === 'standby')!;
    assert.deepEqual(result.skipped.filter((skip) => skip.necessity !== 'not_needed').map((skip) => skip.reason), []);
    assert.equal(standby.yardFacilityNodeId, 'P2', '待命改停 P2');
    const entry = result.timelines[0]!.blocks.find((item) => item.source === 'yard_entry_move')!;
    const exit = result.timelines[0]!.blocks.find((item) => item.source === 'yard_exit_move')!;
    assert.equal(entry.yardExitFacilityNodeId, 'P2', '入廠卡指向新位置');
    assert.equal(exit.yardExitFacilityNodeId, 'P2', '出廠卡從新位置出發');
    assert.equal(result.standbyRelocations.length, 1);
    assert.equal(result.standbyRelocations[0]!.fromLabel, 'P1');
    assert.equal(result.standbyRelocations[0]!.toLabel, 'P2');
  });

  it('同一個 Area 的位置也要到得了下一段的設施：到不了的不能因為同區就當 0 成本挑進來', () => {
    // 待命之後接充電（C1）。P1 跟 C1 同一個 Area，但路網上 P1 到不了 C1；P2 到得了
    const topo: PointTopology = {
      ...emptyPointTopology(),
      nodes: [
        { id: 'n-s', kind: 'docking', label: 'S', stationId: 'station_s', x: 0, y: 0, color: '#111111' },
        { id: 'P1', kind: 'facility', label: 'P1', x: 0, y: 0, color: '#222222' },
        { id: 'P2', kind: 'facility', label: 'P2', x: 0, y: 0, color: '#222222' },
        { id: 'C1', kind: 'facility', label: 'C1', x: 0, y: 0, color: '#333333' },
      ],
      edges: [edge('n-s', 'P1', 30), edge('n-s', 'P2', 60), edge('P2', 'C1', 60), edge('n-s', 'C1', 90), edge('C1', 'n-s', 60)],
    };
    const areas = [{ id: 'area', name: 'A', facilities: [
      { id: 'P1', type: 'Facility', name: 'P1' }, { id: 'C1', type: 'Facility', name: 'C1' },
    ] }] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['areas'];
    const timelines = [{
      row: 1,
      blocks: [
        block({ id: 'in', timelineRow: 1, taskType: 'passenger', routeId: 'as', plannedStartMinute: minute(8, 0), plannedEndMinute: minute(8, 30) }),
        block({ id: 'standby', timelineRow: 1, taskType: 'standby', plannedStartMinute: minute(8, 40), plannedEndMinute: minute(9, 30) }),
        block({ id: 'charge', timelineRow: 1, taskType: 'charging', plannedStartMinute: minute(9, 30), plannedEndMinute: minute(10, 30) }),
        block({ id: 'out', timelineRow: 1, taskType: 'passenger', routeId: 'sa', plannedStartMinute: minute(10, 40), plannedEndMinute: minute(11, 10) }),
      ],
    }] as never as GeneratedSchedulePlan['timelines'];
    const result = insertMaintenanceTransferCards({
      timelines, topology: topo, areas,
      maintenanceBody: {
        mobile: { stepEnabled: true, equipmentRows: [{ id: 'a', mapCode: 'P1' }, { id: 'b', mapCode: 'P2' }] },
        charging: { stepEnabled: true, equipmentRows: [{ id: 'c', mapCode: 'C1' }] },
      },
      selectedRoutes: ROUTES, minimumRecoveryTimeSeconds: 0, collisionProtectionSeconds: 0,
    });
    assert.equal(result.timelines[0]!.blocks.find((item) => item.id === 'standby')!.yardFacilityNodeId, 'P2');
    assert.deepEqual(result.skipped.filter((skip) => skip.necessity !== 'not_needed').map((skip) => skip.reason), []);
  });

  it('呼叫端要求這一段不要停某個位置：挑位直接跳過它，只在允許清單內換', () => {
    const timelines = () => [{
      row: 1,
      blocks: [
        block({ id: 'in', timelineRow: 1, taskType: 'passenger', routeId: 'as', plannedStartMinute: minute(8, 0), plannedEndMinute: minute(8, 30) }),
        block({ id: 'standby', timelineRow: 1, taskType: 'standby', plannedStartMinute: minute(8, 40), plannedEndMinute: minute(10, 30) }),
        block({ id: 'out', timelineRow: 1, taskType: 'passenger', routeId: 'ta', plannedStartMinute: minute(10, 40), plannedEndMinute: minute(11, 10) }),
      ],
    }] as never as GeneratedSchedulePlan['timelines'];
    const runAvoid = (avoid: Array<{ blockId: string; nodeId: string }>) => insertMaintenanceTransferCards({
      timelines: timelines(),
      topology: relocationTopology(),
      maintenanceBody: { mobile: { stepEnabled: true, equipmentRows: [{ id: 'a', mapCode: 'P1' }, { id: 'b', mapCode: 'P2' }] } },
      selectedRoutes: routes,
      minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 30,
      avoidYardSpots: avoid,
    });
    const standbyAt = (result: ReturnType<typeof runAvoid>) =>
      result.timelines[0]!.blocks.find((item) => item.id === 'standby')!.yardFacilityNodeId;
    assert.equal(standbyAt(runAvoid([])), 'P1', '不排除時照成本挑 P1（這次時間夠進得去）');
    assert.equal(standbyAt(runAvoid([{ blockId: 'standby', nodeId: 'P1' }])), 'P2');
    // 別張卡的排除不影響這一張
    assert.equal(standbyAt(runAvoid([{ blockId: 'other', nodeId: 'P1' }])), 'P1');
  });
});
