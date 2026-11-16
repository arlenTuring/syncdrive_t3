import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { GenerateShiftScheduleInput } from '../generate';
import type { FeasibilityIssue, GenerateShiftScheduleResult, ShiftScheduleVariant } from '../types';
import { runScheduleEngineInBackground, ScheduleEngineCancelledError } from './runScheduleEngineInBackground';

/**
 * 兩個派車版本各開一個背景執行緒同時跑：用假的 Worker 控制各自回傳的時機與內容，
 * 驗證同時啟動、挑選規則、單邊失敗、取消。
 */

type Posted = { id: number; input: unknown; variant: ShiftScheduleVariant };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  posted: Posted | null = null;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(data: Posted) {
    this.posted = data;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data: { id: this.posted!.id, ...data } });
  }
}

const originalWorker = (globalThis as { Worker?: unknown }).Worker;
function installFakeWorker() {
  FakeWorker.instances = [];
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
}
afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = originalWorker;
});

const workerFor = (variant: ShiftScheduleVariant) => {
  const worker = FakeWorker.instances.find((instance) => instance.posted?.variant === variant);
  assert.ok(worker, `${variant} 版本沒有啟動`);
  return worker;
};

const unserved = (n: number): FeasibilityIssue[] =>
  Array.from({ length: n }, (_, index) => ({
    code: 'UNSERVED_SERVICE_PULSE',
    severity: 'warning',
    message: `脈衝 ${index} 沒車接`,
  }) as FeasibilityIssue);

function result(trips: number, warnings: FeasibilityIssue[]): GenerateShiftScheduleResult {
  return {
    plan: {
      shiftId: 'S',
      generatedAt: '2026-11-10T00:00:00.000Z',
      scheduleRowCount: 1,
      timelines: [{
        row: 1,
        blocks: Array.from({ length: trips }, (_, index) => ({
          id: `t${index}`,
          taskType: 'passenger',
          plannedStartMinute: index * 10,
          plannedEndMinute: index * 10 + 5,
        })),
      }],
    },
    report: { ok: warnings.length === 0, errors: [], warnings },
  } as unknown as GenerateShiftScheduleResult;
}

const input = {} as GenerateShiftScheduleInput;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('runScheduleEngineInBackground：兩個派車版本同時跑', () => {
  it('兩個版本在任何一份回來之前就都已啟動，alt 較好時選 alt', async () => {
    installFakeWorker();
    const promise = runScheduleEngineInBackground(input);
    assert.deepEqual(FakeWorker.instances.map((worker) => worker.posted?.variant), ['base', 'alt']);
    workerFor('alt').reply({ type: 'result', result: result(8, []) });
    workerFor('base').reply({ type: 'result', result: result(4, unserved(1)) });
    const chosen = await promise;
    assert.equal(chosen.report.variantSelection?.chosen, 'alt');
    assert.equal(chosen.report.variantSelection?.why, 'compared');
    assert.equal(chosen.plan?.timelines[0]!.blocks.length, 8);
    assert.ok(FakeWorker.instances.every((worker) => worker.terminated));
  });

  it('base 沒有漏接脈衝就不等 alt，直接停掉 alt', async () => {
    installFakeWorker();
    const promise = runScheduleEngineInBackground(input);
    workerFor('base').reply({ type: 'result', result: result(8, []) });
    const chosen = await promise;
    assert.equal(chosen.report.variantSelection?.chosen, 'base');
    assert.equal(chosen.report.variantSelection?.why, 'base-fully-served');
    assert.equal(workerFor('alt').terminated, true);
  });

  it('base 有漏接時要等 alt 回來才決定', async () => {
    installFakeWorker();
    let done = false;
    const promise = runScheduleEngineInBackground(input).then((value) => {
      done = true;
      return value;
    });
    workerFor('base').reply({ type: 'result', result: result(4, unserved(1)) });
    await tick();
    assert.equal(done, false);
    workerFor('alt').reply({ type: 'result', result: result(4, unserved(2)) });
    const chosen = await promise;
    assert.equal(chosen.report.variantSelection?.chosen, 'base');
  });

  it('alt 執行失敗時用 base，並記下失敗原因', async () => {
    installFakeWorker();
    const promise = runScheduleEngineInBackground(input);
    workerFor('alt').reply({ type: 'error', message: 'alt 爆了' });
    workerFor('base').reply({ type: 'result', result: result(4, unserved(1)) });
    const chosen = await promise;
    assert.equal(chosen.report.variantSelection?.why, 'alt-failed');
    assert.equal(chosen.report.variantSelection?.altFailure, 'alt 爆了');
  });

  it('base 執行失敗就是這次生成失敗', async () => {
    installFakeWorker();
    const promise = runScheduleEngineInBackground(input);
    workerFor('base').reply({ type: 'error', message: 'base 爆了' });
    await assert.rejects(promise, /base 爆了/);
    assert.equal(workerFor('alt').terminated, true);
  });

  it('取消時兩個執行緒都終止', async () => {
    installFakeWorker();
    const controller = new AbortController();
    const promise = runScheduleEngineInBackground(input, { signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, ScheduleEngineCancelledError);
    assert.ok(FakeWorker.instances.every((worker) => worker.terminated));
  });

  it('瀏覽器未提供錯誤細節時改用單一 Worker 重試，略過已終止的回應', async () => {
    installFakeWorker();
    const promise = runScheduleEngineInBackground(input);
    const original = workerFor('base');
    original.onerror?.({});
    assert.equal(FakeWorker.instances.length, 3);
    assert.ok(FakeWorker.instances.slice(0, 2).every((worker) => worker.terminated));
    original.reply({ type: 'result', result: result(1, []) });
    FakeWorker.instances[2]!.reply({ type: 'result', result: result(8, unserved(1)) });
    assert.equal(FakeWorker.instances.length, 4);
    FakeWorker.instances[3]!.reply({ type: 'result', result: result(9, []) });
    assert.equal((await promise).plan?.timelines[0]!.blocks.length, 9);
    assert.ok(FakeWorker.instances.every((worker) => worker.terminated));
  });

  it('單一 Worker 再次中止時回報失敗，不無限重試', async () => {
    installFakeWorker();
    const promise = runScheduleEngineInBackground(input);
    workerFor('base').onerror?.({});
    FakeWorker.instances[2]!.onerror?.({});
    await assert.rejects(promise, /無法載入或意外中止.*重新整理/);
    assert.equal(FakeWorker.instances.length, 3);
    assert.ok(FakeWorker.instances.every((worker) => worker.terminated));
  });

  it('進度回報較慢的那個版本', async () => {
    installFakeWorker();
    const seen: number[] = [];
    const promise = runScheduleEngineInBackground(input, { onProgress: (progress) => seen.push(progress.fraction) });
    workerFor('base').reply({ type: 'progress', progress: { stage: 'search', message: 'b', fraction: 0.8 } });
    workerFor('alt').reply({ type: 'progress', progress: { stage: 'geometry', message: 'a', fraction: 0.3 } });
    workerFor('base').reply({ type: 'progress', progress: { stage: 'validate', message: 'b', fraction: 0.9 } });
    assert.deepEqual(seen, [0.8, 0.3, 0.3]);
    workerFor('base').reply({ type: 'result', result: result(8, []) });
    await promise;
  });
});
