import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';
import {
  validateFacilityOccupancy,
  validateTimelineOverlaps,
  validateYardWorkPreserved,
} from './schedule-engine/validate';
import {
  mergeMidnightSplitYardCards,
  remapMergedBlockIds,
  splitMidnightJoinedSpans,
} from './mergeMidnightSplitYardCards';

/**
 * 午夜切開的整備卡合成一張。
 *
 * 同一台車、同一個格位、同一種整備，只因為模板畫到 24:00 為止就變成兩張卡
 * （待命 21:50–24:00 ＋ 待命 00:00–03:00）。合併後是一張 21:50 → 隔天 03:00 的卡，
 * 結束記成 1440 以上；其他檢查（同格佔用、同列重疊、整備有沒有被刪）照樣要抓得到問題。
 */

const DAY = 24 * 60;

function card(partial: Partial<GeneratedScheduleBlock> & {
  id: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
}): GeneratedScheduleBlock {
  return {
    timelineRow: 1,
    taskType: 'standby',
    label: partial.id,
    source: 'template_bar',
    travelSeconds: 0,
    dwellSeconds: 0,
    anchorStartMinute: partial.plannedStartMinute,
    yardFacilityNodeId: 'H1',
    yardFacilityLabel: 'H1',
    ...partial,
  } as GeneratedScheduleBlock;
}

const timelinesOf = (...rows: GeneratedScheduleBlock[][]) =>
  rows.map((blocks, index) => ({ row: index + 1, blocks })) as GeneratedSchedulePlan['timelines'];

/** 日頭 00:00–03:00、中間跑正線、日尾 21:50–24:00 */
const splitRow = (over: { head?: Partial<GeneratedScheduleBlock>; tail?: Partial<GeneratedScheduleBlock> } = {}) => [
  card({ id: 'head', plannedStartMinute: 0, plannedEndMinute: 180, ...over.head }),
  card({ id: 'pax', taskType: 'passenger', plannedStartMinute: 300, plannedEndMinute: 480, yardFacilityNodeId: undefined, yardFacilityLabel: undefined }),
  card({ id: 'tail', plannedStartMinute: 1310, plannedEndMinute: DAY, ...over.tail }),
];

describe('午夜切開的整備卡合成一張', () => {
  it('同一條時間線、同一種整備、同一格：合成一張，結束記到隔天', () => {
    const timelines = timelinesOf(splitRow());
    const records = mergeMidnightSplitYardCards(timelines);
    assert.deepEqual(records, [{ timelineRow: 1, blockId: 'tail', headBlockId: 'head' }]);
    const ids = timelines[0]!.blocks.map((block) => block.id);
    assert.deepEqual(ids, ['pax', 'tail'], '日頭那張要被併掉');
    const merged = timelines[0]!.blocks.find((block) => block.id === 'tail')!;
    assert.equal(merged.plannedStartMinute, 1310);
    assert.equal(merged.plannedEndMinute, DAY + 180);
    assert.deepEqual(merged.midnightJoin, { headBlockId: 'head', splitMinute: DAY });
  });

  it('日頭那張已經記在日尾之後（1440 起）也一樣合', () => {
    const timelines = timelinesOf([
      card({ id: 'tail', plannedStartMinute: 1310, plannedEndMinute: DAY }),
      card({ id: 'head', plannedStartMinute: DAY, plannedEndMinute: DAY + 90 }),
    ]);
    assert.equal(mergeMidnightSplitYardCards(timelines).length, 1);
    assert.equal(timelines[0]!.blocks.length, 1);
    assert.equal(timelines[0]!.blocks[0]!.plannedEndMinute, DAY + 90);
  });

  it('充電合併後，要求的充電秒數是兩張相加', () => {
    const timelines = timelinesOf(splitRow({
      head: { taskType: 'charging', requiredChargingSeconds: 180 * 60 },
      tail: { taskType: 'charging', requiredChargingSeconds: 130 * 60 },
    }));
    mergeMidnightSplitYardCards(timelines);
    assert.equal(timelines[0]!.blocks.find((block) => block.id === 'tail')!.requiredChargingSeconds, 310 * 60);
  });

  it('不合：格位不同（車真的換了位置）', () => {
    const timelines = timelinesOf(splitRow({ head: { yardFacilityNodeId: 'H2', yardFacilityLabel: 'H2' } }));
    assert.deepEqual(mergeMidnightSplitYardCards(timelines), []);
    assert.equal(timelines[0]!.blocks.length, 3);
  });

  it('不合：整備種類不同（充電接待命）', () => {
    const timelines = timelinesOf(splitRow({ tail: { taskType: 'charging' } }));
    assert.deepEqual(mergeMidnightSplitYardCards(timelines), []);
  });

  it('不合：午夜那一刻夾了出入廠卡', () => {
    const row = splitRow();
    row.push(card({ id: 'move', taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: DAY, plannedEndMinute: DAY }));
    assert.deepEqual(mergeMidnightSplitYardCards(timelinesOf(row)), []);
  });

  it('不合：沒有定到格位，或標成沒有可用設施', () => {
    assert.deepEqual(
      mergeMidnightSplitYardCards(timelinesOf(splitRow({ head: { yardFacilityNodeId: undefined }, tail: { yardFacilityNodeId: undefined } }))),
      [],
    );
    assert.deepEqual(
      mergeMidnightSplitYardCards(timelinesOf(splitRow({ tail: { yardFacilityUnavailable: true } }))),
      [],
    );
  });

  it('不合：日尾那張沒有剛好到午夜（中間有空檔）', () => {
    assert.deepEqual(mergeMidnightSplitYardCards(timelinesOf(splitRow({ tail: { plannedEndMinute: DAY - 5 } }))), []);
  });

  it('整天一張的卡（00:00–24:00）不動', () => {
    const timelines = timelinesOf([card({ id: 'all-day', taskType: 'servicing', plannedStartMinute: 0, plannedEndMinute: DAY })]);
    assert.deepEqual(mergeMidnightSplitYardCards(timelines), []);
    assert.equal(timelines[0]!.blocks[0]!.plannedEndMinute, DAY);
  });

  it('別條時間線的卡不會被拿來合', () => {
    const timelines = timelinesOf(
      [card({ id: 'tail', plannedStartMinute: 1310, plannedEndMinute: DAY })],
      [card({ id: 'head', timelineRow: 2, plannedStartMinute: 0, plannedEndMinute: 180 })],
    );
    assert.deepEqual(mergeMidnightSplitYardCards(timelines), []);
  });
});

describe('合併後的卡，其他檢查照樣看得懂', () => {
  const mergedTimelines = (...extraRows: GeneratedScheduleBlock[][]) => {
    const timelines = timelinesOf(splitRow(), ...extraRows);
    mergeMidnightSplitYardCards(timelines);
    return timelines;
  };
  const templateTasks = [
    { id: 'head', rowIndex: 1, taskType: 'standby', label: '待命', startMinute: 0, durationMinutes: 180 },
    { id: 'tail', rowIndex: 1, taskType: 'standby', label: '待命', startMinute: 1230, durationMinutes: 210 },
  ];

  it('拆回兩段：日尾算在自己身上，日頭算在被併掉那張身上', () => {
    const merged = mergedTimelines()[0]!.blocks.find((block) => block.id === 'tail')!;
    assert.deepEqual(splitMidnightJoinedSpans(merged), [
      { id: 'tail', startMinute: 1310, endMinute: DAY },
      { id: 'head', startMinute: DAY, endMinute: DAY + 180 },
    ]);
  });

  it('模板上兩根條子都還在：不會被當成「整備被刪掉」', () => {
    const errors: FeasibilityIssue[] = [];
    validateYardWorkPreserved({ timelines: mergedTimelines(), yardTasks: templateTasks, maintenanceBody: null, errors });
    assert.deepEqual(errors.map((issue) => issue.message), []);
  });

  it('對照：日頭那根真的不見了，仍然抓得到', () => {
    const timelines = timelinesOf(splitRow().filter((block) => block.id !== 'head'));
    const errors: FeasibilityIssue[] = [];
    validateYardWorkPreserved({ timelines, yardTasks: templateTasks, maintenanceBody: null, errors });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, 'MAINTENANCE_WORK_INSUFFICIENT');
  });

  it('凌晨別台車停進同一格：同格佔用抓得到（合併後那段記在 1440 之後）', () => {
    const intruder = card({ id: 'other', timelineRow: 2, plannedStartMinute: 60, plannedEndMinute: 120 });
    const errors: FeasibilityIssue[] = [];
    validateFacilityOccupancy(mergedTimelines([intruder]), errors, { collisionProtectionSeconds: 30, warnings: [] });
    assert.ok(errors.length > 0, '凌晨 01:00–02:00 兩台車同在 H1，應該報出來');
  });

  it('凌晨同一條時間線又排了別的卡：同列重疊抓得到', () => {
    const timelines = mergedTimelines();
    timelines[0]!.blocks.unshift(
      card({ id: 'clash', taskType: 'inspection', plannedStartMinute: 60, plannedEndMinute: 120, yardFacilityNodeId: 'M1', yardFacilityLabel: 'M1' }),
    );
    const errors: FeasibilityIssue[] = [];
    validateTimelineOverlaps(timelines, errors);
    assert.ok(errors.length > 0, '01:00–02:00 這台車同時有兩張卡，應該報出來');
  });

  it('合併前寫好的問題，指向改成合併後那張卡', () => {
    const issues = [
      { detail: { blockId: 'head', timelineRow: 1 } },
      { detail: { blockIds: ['pax', 'head'] } },
      { detail: { blockId: 'pax' } },
      {},
    ];
    remapMergedBlockIds(issues, [{ timelineRow: 1, blockId: 'tail', headBlockId: 'head' }]);
    assert.deepEqual(issues, [
      { detail: { blockId: 'tail', timelineRow: 1 } },
      { detail: { blockIds: ['pax', 'tail'] } },
      { detail: { blockId: 'pax' } },
      {},
    ]);
  });
});
