import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampTaskMoveStart,
  updateScheduleTask,
  computeUncoveredRangesForRow,
  resolveTaskMinuteRanges,
  tasksOverlapOnDayCycle,
  type MinuteRange,
  type ScheduleTask,
} from './editor';

const task = (over: Partial<ScheduleTask> & { startMinute: number; durationMinutes: number }) =>
  ({
    id: 't', rowIndex: 1, taskType: 'standby', label: '待命', ...over,
  }) as ScheduleTask;

/** 整天都營運 */
const ALL_DAY: MinuteRange[] = [{ start: 0, end: 24 * 60 }];

describe('跨午夜的任務條', () => {
  it('切成日尾＋日頭兩段', () => {
    assert.deepEqual(
      resolveTaskMinuteRanges({ startMinute: 23 * 60 + 40, durationMinutes: 40 }),
      [{ start: 23 * 60 + 40, end: 24 * 60 }, { start: 0, end: 20 }],
    );
    // 沒跨午夜的維持一段
    assert.deepEqual(
      resolveTaskMinuteRanges({ startMinute: 600, durationMinutes: 30 }),
      [{ start: 600, end: 630 }],
    );
  });

  it('重疊判定要照日循環——線性比大小會漏掉繞回去那半段', () => {
    const wrapping = { startMinute: 23 * 60 + 40, durationMinutes: 40 }; // 23:40–00:20
    assert.equal(tasksOverlapOnDayCycle(wrapping, { startMinute: 10, durationMinutes: 30 }), true);
    assert.equal(tasksOverlapOnDayCycle(wrapping, { startMinute: 60, durationMinutes: 30 }), false);
  });

  it('缺口偵測看得到繞回去那半段蓋住的時間', () => {
    // 23:00–01:00 一根跨午夜的條子；00:00–01:00 那段不該再被算成缺口
    const tasks = [task({ id: 'a', startMinute: 23 * 60, durationMinutes: 120 })];
    const uncovered = computeUncoveredRangesForRow(1, tasks, ALL_DAY);
    assert.deepEqual(uncovered, [{ start: 60, end: 23 * 60 }]);
  });

  it('拖過午夜：可行就繞過去', () => {
    const start = clampTaskMoveStart('t', 1, 40, 23 * 60 + 40, ALL_DAY, []);
    assert.equal(start, 23 * 60 + 40, '沒有東西擋著就該讓它跨過去');
  });

  it('拖過午夜：繞過去會撞到別的任務就退回線性夾制', () => {
    const others = [task({ id: 'other', startMinute: 0, durationMinutes: 60 })];
    const start = clampTaskMoveStart('t', 1, 40, 23 * 60 + 40, ALL_DAY, others);
    assert.ok(
      start + 40 <= 24 * 60,
      `撞到 00:00–01:00 那根就不該跨過去，實際 start=${start}`,
    );
  });

  it('端到端：拖過午夜之後，時長不可以被正規化砍掉', () => {
    // 這是使用者實際踩到的那條：clampTaskMoveStart 算得對（21:30 起、跨到隔天
    // 01:00），但 updateScheduleTask 的正規化把時長上限訂成「從開始到午夜」，
    // 一進去就被砍成 150 分、結束硬切在 24:00——畫面上看起來就是拖到 00:00
    // 卡住不動，看不出問題其實不在拖曳。
    const bar = task({ id: 't', rowIndex: 5, startMinute: 20 * 60 + 30, durationMinutes: 210 });
    const nextStart = clampTaskMoveStart('t', 5, 210, bar.startMinute + 60, ALL_DAY, [bar]);
    assert.equal(nextStart, 21 * 60 + 30);

    const moved = updateScheduleTask([bar], 't', { startMinute: nextStart })[0]!;
    assert.equal(moved.durationMinutes, 210, '時長不能被砍');
    assert.equal(
      moved.startMinute + moved.durationMinutes,
      25 * 60,
      '結束要落在隔天 01:00（1500 分），不是被切在 24:00',
    );
  });

  it('沒跨午夜的拖曳行為完全不變', () => {
    assert.equal(clampTaskMoveStart('t', 1, 60, 600, ALL_DAY, []), 600);
  });
});
