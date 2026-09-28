import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planStateKey, SearchBudget } from './searchBudget';
import { resolveResidualConflicts } from './resolveResidualConflicts';
import type { PlanEvaluationContext } from './evaluatePlan';
import type { GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';
import type { ShiftScheduleSelectedRoute } from '../../types/create';

describe('SearchBudget', () => {
  it('候選數用盡就停，並記下是哪一個上限', () => {
    const budget = new SearchBudget({ maxCandidates: 2, maxEvaluations: 100, timeLimitMs: 1e9 });
    assert.equal(budget.tryCandidate(), true);
    assert.equal(budget.tryCandidate(), true);
    assert.equal(budget.tryCandidate(), false);
    assert.equal(budget.exhausted, true);
    assert.equal(budget.report().exhaustedBy, 'candidates');
    // 用盡後評估也不再給
    assert.equal(budget.tryEvaluation(), false);
  });

  it('完整評估數用盡就停', () => {
    const budget = new SearchBudget({ maxCandidates: 100, maxEvaluations: 1, timeLimitMs: 1e9 });
    assert.equal(budget.tryEvaluation(), true);
    assert.equal(budget.tryEvaluation(), false);
    assert.equal(budget.report().exhaustedBy, 'evaluations');
  });

  it('時間上限用假時鐘驗證：到點之後不再給候選', () => {
    let now = 0;
    const budget = new SearchBudget({ maxCandidates: 100, maxEvaluations: 100, timeLimitMs: 1000 }, () => now);
    assert.equal(budget.tryCandidate(), true);
    now = 1000;
    assert.equal(budget.tryCandidate(), false);
    assert.equal(budget.report().exhaustedBy, 'time');
  });

  it('計時從第一次搜尋開始：前面非搜尋的運算不吃搜尋時間', () => {
    let now = 0;
    const budget = new SearchBudget({ maxCandidates: 100, maxEvaluations: 100, timeLimitMs: 1000 }, () => now);
    now = 5000; // 收斂迴圈之類的前置運算
    assert.equal(budget.exhausted, false);
    assert.equal(budget.tryCandidate(), true);
    now = 5999;
    assert.equal(budget.tryCandidate(), true);
    now = 6000;
    assert.equal(budget.tryCandidate(), false);
  });

  it('版面指紋：時刻或格位不同就不同，同樣內容相同', () => {
    const plan = [{ row: 1, blocks: [{ id: 'a', plannedStartMinute: 1, plannedEndMinute: 2 }] }];
    const same = [{ row: 1, blocks: [{ id: 'a', plannedStartMinute: 1, plannedEndMinute: 2 }] }];
    const moved = [{ row: 1, blocks: [{ id: 'a', plannedStartMinute: 1.5, plannedEndMinute: 2 }] }];
    const parked = [{ row: 1, blocks: [{ id: 'a', plannedStartMinute: 1, plannedEndMinute: 2, yardFacilityNodeId: 'p' }] }];
    assert.equal(planStateKey(plan), planStateKey(same));
    assert.notEqual(planStateKey(plan), planStateKey(moved));
    assert.notEqual(planStateKey(plan), planStateKey(parked));
  });
});

// ───────── 縮小的高衝突案例：多列車同一刻從同一站出發（名稱與時刻都只是測試資料） ─────────

const route = { routeId: 'ab', stationIds: ['a', 'b'], minTravelTimeSeconds: 60,
  avgTravelTimeSeconds: 120, dwellSlackSeconds: 0, switchBufferAfterSeconds: 0,
  stationDwells: [{ stationId: 'a', dwellSeconds: 30, dwellRequired: true, dwellMode: 'seconds' },
    { stationId: 'b', dwellSeconds: 30, dwellRequired: true, dwellMode: 'seconds' }],
} as ShiftScheduleSelectedRoute;
const ctx: PlanEvaluationContext = { selectedRoutes: [route], routeById: new Map([['ab', route]]),
  passengerRoutes: [route], minimumRecoveryTimeSeconds: 0, collisionProtectionSeconds: 30,
  intervals: [], attributes: [], scheduleRowCount: 6 };

function trip(row: number, start: number): GeneratedScheduleBlock {
  return { id: `trip-${row}`, timelineRow: row, label: `trip-${row}`, taskType: 'passenger', source: 'template_bar',
    routeId: 'ab', plannedStartMinute: start, plannedEndMinute: start + 3, anchorStartMinute: start,
    travelSeconds: 120, dwellSeconds: 60 };
}
function crowded(): GeneratedSchedulePlan['timelines'] {
  return [1, 2, 3, 4, 5, 6].map((row) => ({ row, blocks: [trip(row, 600)] }));
}

describe('殘留衝突修復用共用預算停止', () => {
  it('候選上限很小：停在上限、標明搜尋未完成，不假裝找過全部', () => {
    const budget = new SearchBudget({ maxCandidates: 3, maxEvaluations: 1000, timeLimitMs: 1e9 });
    const result = resolveResidualConflicts({ timelines: crowded(), ctx, searchBudget: budget });
    assert.equal(result.budgetExhausted, true);
    assert.equal(budget.report().candidates, 3);
    assert.equal(budget.report().exhaustedBy, 'candidates');
    assert.ok(result.attempts.some((attempt) => attempt.searchIncomplete), JSON.stringify(result.attempts));
  });

  it('同一份預算接著給下一次呼叫：已用盡就不再搜，也不會重新拿一份', () => {
    const budget = new SearchBudget({ maxCandidates: 3, maxEvaluations: 1000, timeLimitMs: 1e9 });
    resolveResidualConflicts({ timelines: crowded(), ctx, searchBudget: budget });
    const again = resolveResidualConflicts({ timelines: crowded(), ctx, searchBudget: budget });
    assert.equal(again.budgetExhausted, true);
    // 每一筆都記成「沒搜」，不是「搜過沒找到」
    assert.ok(again.attempts.length > 0);
    assert.ok(again.attempts.every((attempt) => attempt.searchIncomplete && attempt.candidatesTried === 0));
    assert.equal(budget.report().candidates, 3);
  });

  it('同一個版面第二次搜：沿用第一次的結果，不重搜也不多扣預算，結果一樣', () => {
    const budget = new SearchBudget({ maxCandidates: 5000, maxEvaluations: 5000, timeLimitMs: 1e9 });
    const first = resolveResidualConflicts({ timelines: crowded(), ctx, searchBudget: budget });
    assert.equal(first.budgetExhausted, false);
    const used = budget.report().candidates;
    const second = resolveResidualConflicts({ timelines: crowded(), ctx, searchBudget: budget });
    assert.equal(budget.report().candidates, used);
    assert.ok(budget.report().duplicatesSkipped > 0);
    assert.deepEqual(
      second.timelines.map((timeline) => timeline.blocks.map((block) => [block.id, block.plannedStartMinute])),
      first.timelines.map((timeline) => timeline.blocks.map((block) => [block.id, block.plannedStartMinute])),
    );
    assert.deepEqual(second.attempts.map((attempt) => attempt.outcome), first.attempts.map((attempt) => attempt.outcome));
  });
});
