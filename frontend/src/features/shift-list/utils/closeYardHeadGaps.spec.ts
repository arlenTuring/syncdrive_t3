import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';
import { closeYardHeadGaps } from './closeYardHeadGaps';

function block(
  partial: Partial<GeneratedScheduleBlock> & {
    id: string;
    timelineRow: number;
    plannedStartMinute: number;
    plannedEndMinute: number;
  },
): GeneratedScheduleBlock {
  return {
    taskType: 'dispatch',
    label: '',
    source: 'transition',
    travelSeconds: 0,
    dwellSeconds: 0,
    anchorStartMinute: partial.plannedStartMinute,
    ...partial,
  } as GeneratedScheduleBlock;
}

/**
 * row1：入廠移動抵達 E2（t=100），排定的充電要等到 t=110 才開始——中間空白 10 分鐘，
 * 這支的工作就是把充電往前拉到 t=100（車已經在裡面了）；候選空位查的是
 * <strong>[100,110) 這一小段窄窗</strong>，不落在 row2 出場移動卡自己的區間裡。
 *
 * row2：另一台車也用 E2，充電本身排定 t=50–95 結束，但出場移動晚了很多才開
 * （t=120），車實際上到 t=120 才真的離開——[95,120) 這段帳面上（卡片自己的
 * plannedEndMinute）是空的，實際上車還在裡面，[100,110) 整段都落在這裡面。
 * 出場移動卡自己的窗口 [120,121) 不會跟 [100,110) 重疊，只看卡片原始窗口的候選
 * 檢查完全看不出這段被佔著。
 */
function timelines(row2ExitStart: number, row1TaskType: GeneratedScheduleBlock['taskType'] = 'standby'): GeneratedScheduleTimeline[] {
  return [
    {
      row: 1,
      blocks: [
        block({
          id: 'enter1', timelineRow: 1, taskType: 'dispatch', source: 'yard_entry_move',
          plannedStartMinute: 90, plannedEndMinute: 100,
          yardExitFacilityNodeId: 'E2',
        }),
        block({
          id: 'charge1', timelineRow: 1, taskType: row1TaskType, source: 'template_bar',
          plannedStartMinute: 110, plannedEndMinute: 160,
          yardFacilityNodeId: 'E2', yardFacilityLabel: 'E2',
        }),
      ],
    },
    {
      row: 2,
      blocks: [
        block({
          id: 'charge2', timelineRow: 2, taskType: 'charging', source: 'template_bar',
          plannedStartMinute: 50, plannedEndMinute: 95,
          yardFacilityNodeId: 'E2', yardFacilityLabel: 'E2',
        }),
        block({
          id: 'exit2', timelineRow: 2, taskType: 'dispatch', source: 'yard_exit_move',
          plannedStartMinute: row2ExitStart, plannedEndMinute: row2ExitStart + 1,
          yardExitFacilityNodeId: 'E2',
        }),
      ],
    },
  ];
}

describe('closeYardHeadGaps：候選空位檢查要看實際離開時刻，不是卡片自己寫的結束時刻', () => {
  it('別列車排定的整備結束時刻雖早，但出場移動晚很多才開——窄窗也要判成佔用，不拉', () => {
    // charge2 排定 t=95 結束，exit2 到 t=120 才開；目標窄窗 [100,110) 整段落在
    // 「帳面上空、實際上還在」的區間裡，且不碰到 exit2 自己的 [120,121)。
    const result = closeYardHeadGaps({ timelines: timelines(120) });
    const row1 = result.timelines.find((t) => t.row === 1)!;
    const charge1 = row1.blocks.find((b) => b.id === 'charge1')!;
    assert.equal(result.closed, 0, '格子其實還被佔著，不該拉');
    assert.equal(charge1.plannedStartMinute, 110, '維持原訂時刻，沒有把車瞬移進還有人在的格子');
  });

  it('別列車真的已經離開（出場移動緊接著開）：格子確實空著，待命正常往前接', () => {
    // exit2 緊接在 charge2 結束後開（t=95.5，間隔 30 秒，在 60 秒門檻內不算滯留）
    const result = closeYardHeadGaps({ timelines: timelines(95.5) });
    const row1 = result.timelines.find((t) => t.row === 1)!;
    const charge1 = row1.blocks.find((b) => b.id === 'charge1')!;
    assert.equal(result.closed, 1);
    assert.equal(charge1.plannedStartMinute, 100, '車已經在 E2 裡面，待命往前拉到抵達時刻');
    assert.equal(charge1.plannedEndMinute, 160, '結束時刻不動');
  });

  it('作業類整備（充電）不往前拉：提早到只是等待（白皮書 YARD-07）', () => {
    const result = closeYardHeadGaps({ timelines: timelines(95.5, 'charging') });
    const charge1 = result.timelines.find((t) => t.row === 1)!.blocks.find((b) => b.id === 'charge1')!;
    assert.equal(result.closed, 0);
    assert.equal(charge1.plannedStartMinute, 110, '充電照原訂時刻開始');
  });
});
