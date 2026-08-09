import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { insertYardTransitionMoveCards } from './insertYardTransitionMoveCards';
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

/**
 * E1（充電）── 30s ──> N2W ── 200s ──> T3 ── 30s ──> M1（保養）
 * 跟真實場域同形狀：設施→鄰站→（跨區）→鄰站→設施。
 */
function topology(): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      { id: 'E1', kind: 'facility', label: 'E1', x: 0, y: 0, color: '#111111' },
      { id: 'N2W', kind: 'docking', label: 'N2W', x: 0, y: 0, color: '#222222' },
      { id: 'T3', kind: 'docking', label: 'T3', x: 0, y: 0, color: '#222222' },
      { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#111111' },
    ],
    edges: [
      edge('E1', 'N2W', 30),
      edge('N2W', 'T3', 200),
      edge('T3', 'M1', 30),
    ],
  };
}

const BODY = {
  charging: { stepEnabled: true, equipmentRows: [{ id: 'r1', mapCode: 'E1' }] },
  maintenance: { stepEnabled: true, equipmentRows: [{ id: 'r2', mapCode: 'M1' }] },
};

const SECTION_CODES = {
  charging: 'E',
  carWash: 'W',
  maintenance: 'M',
  preTrip: 'P',
  mobile: 'H',
  parking: 'T',
};

/** 充電 07:00–07:10（430–430 分制不用，這裡用分鐘），保養 07:10–10:50 */
function plan(): GeneratedSchedulePlan {
  return {
    timelines: [
      {
        row: 1,
        blocks: [
          {
            id: 'charging-1',
            timelineRow: 1,
            taskType: 'charging',
            label: '充電',
            anchorStartMinute: 400,
            plannedStartMinute: 400,
            plannedEndMinute: 430,
            travelSeconds: 0,
            dwellSeconds: 0,
            source: 'template_bar',
          },
          {
            id: 'servicing-1',
            timelineRow: 1,
            taskType: 'servicing',
            label: '保養',
            anchorStartMinute: 430,
            plannedStartMinute: 430,
            plannedEndMinute: 650,
            travelSeconds: 0,
            dwellSeconds: 0,
            source: 'template_bar',
          },
        ],
      },
    ],
  } as never as GeneratedSchedulePlan;
}

function run(p: GeneratedSchedulePlan, topo: PointTopology = topology()) {
  return insertYardTransitionMoveCards({
    timelines: p.timelines,
    topology: topo,
    maintenanceBody: BODY,
    sectionCodes: SECTION_CODES,
  });
}

describe('insertYardTransitionMoveCards（整備間轉場：出廠卡＋入廠卡）', () => {
  it('前一段跑滿全長、結束時刻不動；後一段開始被推遲、結束時刻不動', () => {
    const p = plan();
    const result = run(p);

    assert.equal(result.inserted, 1);
    assert.equal(result.laterTaskCompressed, 1);
    assert.equal(result.skipped.length, 0);

    const blocks = p.timelines[0]!.blocks;
    const charging = blocks.find((b) => b.id === 'charging-1')!;
    const servicing = blocks.find((b) => b.id === 'servicing-1')!;

    assert.equal(charging.plannedStartMinute, 400, '前一段開始不得更動');
    assert.equal(charging.plannedEndMinute, 430, '前一段結束不得更動——它已經做滿全長');
    assert.equal(servicing.plannedEndMinute, 650, '後一段結束不得更動');
    // 移動總秒數 30+200+30=260s=4.333分；後一段開始被推遲同樣的量
    assert.equal(servicing.plannedStartMinute, 430 + 260 / 60);
  });

  it('插入的是兩張卡——出廠卡緊接入廠卡，不是合併成一張', () => {
    const p = plan();
    run(p);
    const blocks = p.timelines[0]!.blocks;
    const mo = blocks.find((b) => b.moveCardTag === 'MO')!;
    const mi = blocks.find((b) => b.moveCardTag === 'MI')!;
    assert.ok(mo, '要有一張 MO 出廠卡');
    assert.ok(mi, '要有一張 MI 入廠卡');
    assert.equal(mo.source, 'yard_exit_move');
    assert.equal(mi.source, 'yard_entry_move');
    // 出廠卡結束＝入廠卡開始，中間不留縫隙也不重疊
    assert.equal(mo.plannedEndMinute, mi.plannedStartMinute);
  });

  it('出廠卡代號用來源類型（充電=E）；入廠卡代號用目的類型（保養=M）', () => {
    const p = plan();
    run(p);
    const blocks = p.timelines[0]!.blocks;
    const mo = blocks.find((b) => b.moveCardTag === 'MO')!;
    const mi = blocks.find((b) => b.moveCardTag === 'MI')!;
    assert.equal(mo.yardExitSectionCode, 'E');
    assert.equal(mi.yardExitSectionCode, 'M');
  });

  it('出廠卡從設施到路徑第一段邊的終點；入廠卡接著到目的設施', () => {
    const p = plan();
    run(p);
    const blocks = p.timelines[0]!.blocks;
    const mo = blocks.find((b) => b.moveCardTag === 'MO')!;
    const mi = blocks.find((b) => b.moveCardTag === 'MI')!;
    assert.equal(mo.yardExitFacilityLabel, 'E1');
    assert.equal(mo.yardExitStationId, 'N2W', '分界點是第一段邊的終點');
    assert.equal(mo.travelSeconds, 30);
    assert.equal(mi.yardExitStationId, 'N2W', '入廠卡從分界點接續');
    assert.equal(mi.yardExitFacilityLabel, 'M1');
    assert.equal(mi.travelSeconds, 230, '剩下的 200+30 秒都算在入廠卡');
  });

  it('同類型銜接不需要轉場，不插卡', () => {
    const p: GeneratedSchedulePlan = {
      timelines: [
        {
          row: 1,
          blocks: [
            { ...plan().timelines[0]!.blocks[1]!, id: 'a', taskType: 'servicing' },
            {
              ...plan().timelines[0]!.blocks[1]!,
              id: 'b',
              taskType: 'servicing',
              plannedStartMinute: 650,
              plannedEndMinute: 700,
            },
          ],
        },
      ],
    } as never as GeneratedSchedulePlan;
    const result = run(p);
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 0);
  });

  it('移動時間長到會把後一段推過結束時刻時，回報而不強插', () => {
    const p = plan();
    // 把後一段結束時刻改到很早，移動 260 秒（4.3 分）根本塞不下
    p.timelines[0]!.blocks[1]!.plannedEndMinute = 431;
    const result = run(p);
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!.reason, /推過結束時刻/);
    // 兩段都維持原樣
    assert.equal(p.timelines[0]!.blocks[0]!.plannedEndMinute, 430);
  });

  it('其中一種類型沒設定設施時回報，不硬插', () => {
    const p = plan();
    const result = insertYardTransitionMoveCards({
      timelines: p.timelines,
      topology: topology(),
      maintenanceBody: { charging: { stepEnabled: true, equipmentRows: [] } },
      sectionCodes: SECTION_CODES,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!.reason, /沒設定設施/);
  });

  it('沒有拓樸時安靜略過，不當成錯誤', () => {
    const p = plan();
    const result = insertYardTransitionMoveCards({
      timelines: p.timelines,
      topology: null,
      maintenanceBody: BODY,
      sectionCodes: SECTION_CODES,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.skipped.length, 0);
  });
});
