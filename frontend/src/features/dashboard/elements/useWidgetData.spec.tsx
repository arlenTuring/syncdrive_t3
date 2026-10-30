// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetFetchState } from './useWidgetData';

/**
 * 直接跑真的 useWidgetData，只把網路、失效通知與時鐘換成可控的替身。
 *
 * 2026-10-28 查核重現的問題：每則失效通知都把重查往後延 200ms，而且讓在途結果作廢；
 * 通知每 100ms 一則時，畫面永遠是 loading、資料空白，直到通知停下來才查。
 */
const h = vi.hoisted(() => ({
  listeners: [] as Array<(payload: { tags: string[]; at: number; reason?: string }) => void>,
  calls: 0,
  active: 0,
  maxActive: 0,
  latencyMs: 1000,
  fail: false,
  clock: { advancing: false, rate: 1 },
  vars: {},
}));

vi.mock('../store/useDataSourceStore', () => ({
  getDataSourceById: () => ({ backendUrl: '' }),
  clearDatasourceQueryCacheForQuery: () => undefined,
  executeDatasourceQuery: () => {
    h.calls += 1;
    const n = h.calls;
    h.active += 1;
    h.maxActive = Math.max(h.maxActive, h.active);
    const fail = h.fail;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        h.active -= 1;
        if (fail) reject(new Error('連不上'));
        else resolve([{ value: n }]);
      }, h.latencyMs);
    });
  },
}));
vi.mock('../context/PlaneDataSourceContext', () => ({ usePlaneSourceResolver: () => (s: string) => s }));
vi.mock('../VariableContext', () => ({ useVariables: () => h.vars, interpolateVariables: (s: string) => s }));
vi.mock('../constants/demoSql', () => ({ expandBuiltinSqlMacros: (s: string) => s }));
vi.mock('../utils/datasourceInvalidationBus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/datasourceInvalidationBus')>()),
  subscribeDatasourceInvalidation: (fn: (typeof h.listeners)[number]) => {
    h.listeners.push(fn);
    return () => {
      h.listeners = h.listeners.filter((x) => x !== fn);
    };
  },
}));
vi.mock('../utils/operatingClock', () => ({ useOperatingClockPace: () => h.clock }));

const { useWidgetData } = await import('./useWidgetData');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAGS = ['table:operation_orders'];
let current: WidgetFetchState = { data: [], loading: false, error: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe() {
  const value = useWidgetData({ dataSourceId: 'test', sqlQuery: 'SELECT value FROM operation_orders', invalidateTags: TAGS });
  useEffect(() => {
    current = value;
  }, [value]);
  return null;
}

const notify = (reason?: string) => {
  for (const fn of h.listeners) fn({ tags: TAGS, at: Date.now(), ...(reason ? { reason } : {}) });
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const shownValue = () => (current.data[0] as { value?: number } | undefined)?.value ?? null;

beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(h, { listeners: [], calls: 0, active: 0, maxActive: 0, latencyMs: 1000, fail: false });
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

describe('useWidgetData 背景重查的有界調度', () => {
  it('1 秒延遲＋每 100ms 一則一般更新、持續 10 秒：不會永遠 loading，同時最多一支，持續拿到新結果', async () => {
    expect(h.calls).toBe(1);
    const seen = new Set<number>();
    let firstShownAt: number | null = null;
    for (let t = 0; t < 10_000; t += 100) {
      notify('order_lifecycle');
      await advance(100);
      const value = shownValue();
      if (value !== null) {
        seen.add(value);
        firstShownAt ??= t + 100;
      }
    }
    // 第一支 1 秒回來就顯示，不必等通知停
    expect(firstShownAt).toBe(1000);
    expect(current.loading).toBe(false);
    expect(h.maxActive).toBe(1);
    // 每支約 1 秒＋最小間隔：10 秒內大約 10 支，不是每則通知一支（100 則）
    expect(h.calls).toBeGreaterThanOrEqual(8);
    expect(h.calls).toBeLessThanOrEqual(11);
    // 畫面一路換新的快照
    expect(seen.size).toBeGreaterThanOrEqual(7);

    // 通知停下：補完最後一支就收斂，不再打
    await advance(3000);
    const settledCalls = h.calls;
    expect(shownValue()).toBe(settledCalls);
    await advance(5000);
    expect(h.calls).toBe(settledCalls);
    expect(h.active).toBe(0);
  });

  it('硬邊界（沒有標一般更新原因，例如清空／重置）之前送出的查詢晚回來不顯示', async () => {
    await advance(1000);
    expect(shownValue()).toBe(1);
    notify('order_lifecycle');
    await advance(500); // 第 2 支在途
    expect(h.calls).toBe(2);
    notify('complete_test_reset');
    await advance(500); // 第 2 支回來：在邊界前送出，丟掉
    expect(shownValue()).toBe(1);
    await advance(1500); // 第 3 支是邊界後送出的
    expect(h.calls).toBe(3);
    expect(shownValue()).toBe(3);
  });

  it('一般更新：在途結果照樣顯示，再由補查換成最新', async () => {
    notify('order_lifecycle');
    await advance(1000);
    expect(shownValue()).toBe(1);
    await advance(1000);
    expect(shownValue()).toBe(2);
  });

  it('失敗時退避：密集通知不會變成密集重試', async () => {
    await advance(1000);
    h.fail = true;
    h.latencyMs = 10;
    notify('order_lifecycle');
    await advance(600);
    expect(current.error).toBe('連不上');
    // 失敗時沿用上次成功的資料，畫面不閃空
    expect(shownValue()).toBe(1);
    h.calls = 0;
    for (let t = 0; t < 10_000; t += 100) {
      notify('order_lifecycle');
      await advance(100);
    }
    // 500ms × 2^n 退避：10 秒內只有個位數重試，不是 100 次
    expect(h.calls).toBeLessThanOrEqual(6);
    h.fail = false;
    await advance(30_000);
    expect(current.error).toBeNull();
    expect(current.data.length).toBe(1);
  });

  it('卸載後不再排程，也不收在途結果', async () => {
    notify('order_lifecycle');
    await act(async () => root!.unmount());
    root = null;
    const calls = h.calls;
    await advance(10_000);
    expect(h.calls).toBe(calls);
    expect(h.listeners).toHaveLength(0);
  });
});
