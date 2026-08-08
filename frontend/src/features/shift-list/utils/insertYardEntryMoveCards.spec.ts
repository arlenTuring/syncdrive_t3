import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { insertYardEntryMoveCards } from './insertYardEntryMoveCards';
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

/** N2W ──60s──> M1（快）／M2（慢 120s）；M 系是保養設施 */
function topology(): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      {
        id: 'n-n2w',
        kind: 'docking',
        label: 'N2W',
        stationId: 'station_n2w',
        x: 0,
        y: 0,
        color: '#111111',
      },
      { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#222222' },
      { id: 'M2', kind: 'facility', label: 'M2', x: 0, y: 0, color: '#222222' },
    ],
    edges: [edge('n-n2w', 'M1', 60), edge('n-n2w', 'M2', 120)],
  };
}

const ROUTES = [
  {
    routeId: 'ab',
    routeCode: 'AB',
    routeName: 'A>N2W',
    stationIds: ['station_a', 'station_n2w'],
    stationDwells: [],
    minTravelTimeSeconds: 300,
    avgTravelTimeSeconds: 300,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
] as never as Parameters<typeof insertYardEntryMoveCards>[0]['selectedRoutes'];

const BODY = {
  maintenance: {
    stepEnabled: true,
    equipmentRows: [{ id: 'r1', mapCode: 'M1' }, { id: 'r2', mapCode: 'M2' }],
  },
};

/** 正線 09:00–09:30，保養 yardStart–11:00 */
function plan(args: {
  yardStartMinute: number;
  row?: number;
  extraYardAfter?: boolean;
}): GeneratedSchedulePlan {
  const row = args.row ?? 1;
  const blocks: unknown[] = [
    {
      id: `pax-${row}`,
      timelineRow: row,
      taskType: 'passenger',
      label: 'AB',
      routeId: 'ab',
      anchorStartMinute: 9 * 60,
      plannedStartMinute: 9 * 60,
      plannedEndMinute: 9 * 60 + 30,
      travelSeconds: 300,
      dwellSeconds: 0,
      source: 'template_bar',
    },
    {
      id: `yard-${row}`,
      timelineRow: row,
      taskType: 'servicing',
      label: '保養',
      anchorStartMinute: args.yardStartMinute,
      plannedStartMinute: args.yardStartMinute,
      plannedEndMinute: 11 * 60,
      travelSeconds: 0,
      dwellSeconds: 0,
      source: 'template_bar',
    },
  ];
  if (args.extraYardAfter) {
    blocks.push({
      id: `yard2-${row}`,
      timelineRow: row,
      taskType: 'charging',
      label: '充電',
      anchorStartMinute: 11 * 60,
      plannedStartMinute: 11 * 60,
      plannedEndMinute: 12 * 60,
      travelSeconds: 0,
      dwellSeconds: 0,
      source: 'template_bar',
    });
  }
  return { timelines: [{ row, blocks }] } as never as GeneratedSchedulePlan;
}

function run(p: GeneratedSchedulePlan, body: unknown = BODY) {
  return insertYardEntryMoveCards({
    timelines: p.timelines,
    topology: topology(),
    maintenanceBody: body as Record<string, unknown>,
    selectedRoutes: ROUTES,
    minimumRecoveryTimeSeconds: 0,
  });
}

describe('insertYardEntryMoveCards（整備入廠卡 MI）', () => {
  it('整備開始提前到抵達時刻，結束時刻不動（時長變長）', () => {
    // 正線 09:30 結束，保養原訂 10:00–11:00，M1 要 60 秒 → 09:31 就到得了
    const p = plan({ yardStartMinute: 10 * 60 });
    const result = run(p);

    assert.equal(result.inserted, 1);
    assert.equal(result.yardHeadExtended, 1);

    const blocks = p.timelines[0]!.blocks;
    const card = blocks.find((b) => b.source === 'yard_entry_move')!;
    assert.equal(card.moveCardTag, 'MI');
    assert.equal(card.plannedStartMinute, 9 * 60 + 30);
    assert.equal(card.plannedEndMinute, 9 * 60 + 31);

    const yard = blocks.find((b) => b.id === 'yard-1')!;
    assert.equal(yard.plannedStartMinute, 9 * 60 + 31, '整備開始要提前到 MI 抵達');
    assert.equal(yard.plannedEndMinute, 11 * 60, '整備結束時刻必須不動');
  });

  it('沒有提前空間就不插卡（車跑到整備開始才空出來）', () => {
    const p = plan({ yardStartMinute: 9 * 60 + 30 });
    const result = run(p);
    assert.equal(result.inserted, 0);
    assert.equal(p.timelines[0]!.blocks.find((b) => b.source === 'yard_entry_move'), undefined);
  });

  it('挑最快到得了的設施', () => {
    const p = plan({ yardStartMinute: 10 * 60 });
    run(p);
    const card = p.timelines[0]!.blocks.find((b) => b.source === 'yard_entry_move')!;
    assert.equal(card.yardExitFacilityLabel, 'M1', 'M1 60 秒比 M2 120 秒快');
    assert.equal(card.travelSeconds, 60);
  });

  it('連續整備串只在串首入廠，不會每段都插', () => {
    const p = plan({ yardStartMinute: 10 * 60, extraYardAfter: true });
    const result = run(p);
    assert.equal(result.inserted, 1);
  });

  it('整備任務沒設定該類設施時回報，不硬插', () => {
    const p = plan({ yardStartMinute: 10 * 60 });
    const result = run(p, { maintenance: { stepEnabled: true, equipmentRows: [] } });
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!.reason, /沒設定這一類的設施/);
  });

  it('拓樸到不了該設施時回報（方向不對就是逆行，不會自己反向走）', () => {
    const p = plan({ yardStartMinute: 10 * 60 });
    const reversed = topology();
    // 把邊全部翻成「設施 → 站」，入廠方向就沒有了
    reversed.edges = reversed.edges.map((e) => ({
      ...e,
      fromNodeId: e.toNodeId,
      toNodeId: e.fromNodeId,
    }));
    const result = insertYardEntryMoveCards({
      timelines: p.timelines,
      topology: reversed,
      maintenanceBody: BODY,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
    });
    assert.equal(result.inserted, 0);
    assert.match(result.skipped[0]!.reason, /到不了任何一座該類設施/);
  });

  it('沒有拓樸時安靜略過，不當成錯誤', () => {
    const p = plan({ yardStartMinute: 10 * 60 });
    const result = insertYardEntryMoveCards({
      timelines: p.timelines,
      topology: null,
      maintenanceBody: BODY,
      selectedRoutes: ROUTES,
      minimumRecoveryTimeSeconds: 0,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 0);
  });
});
