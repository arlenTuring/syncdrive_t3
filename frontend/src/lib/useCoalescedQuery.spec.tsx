// @vitest-environment jsdom
import { act, createElement, useCallback, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoalescedQuery } from './useCoalescedQuery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred = { signal: AbortSignal; resolve: (value: string[]) => void; reject: (reason: Error) => void };
const requests: Deferred[] = [];
let latest: ReturnType<typeof useCoalescedQuery<string[]>> | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe({ queryKey, enabled = true, minIntervalMs = 0 }: { queryKey: string; enabled?: boolean; minIntervalMs?: number }) {
  const load = useCallback((signal: AbortSignal) => new Promise<string[]>((resolve, reject) => {
    requests.push({ signal, resolve, reject });
  }), []);
  // 這組測試看合併與錯序語意，不看節流：間隔設 0，節流另外用假時鐘測
  const value = useCoalescedQuery({ enabled, queryKey, load, minIntervalMs });
  useEffect(() => {
    latest = value;
  }, [value]);
  return createElement('div', null, value.data?.join(',') ?? 'none');
}

async function render(queryKey: string, enabled = true, minIntervalMs = 0) {
  await act(async () => root!.render(createElement(Probe, { queryKey, enabled, minIntervalMs })));
}

beforeEach(() => {
  requests.length = 0;
  latest = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe('useCoalescedQuery', () => {
  it('同條件背景更新保留既有資料，完成後替換', async () => {
    await render('A');
    await act(async () => requests[0].resolve(['舊資料']));
    expect(latest?.data).toEqual(['舊資料']);
    act(() => latest!.refresh());
    expect(latest?.data).toEqual(['舊資料']);
    expect(latest?.refreshing).toBe(true);
    await act(async () => requests[1].resolve(['新資料']));
    expect(latest?.data).toEqual(['新資料']);
  });

  it('A 回應與過期錯誤都不能覆蓋 B', async () => {
    await render('A');
    const a = requests[0];
    await render('B');
    const b = requests[1];
    expect(a.signal.aborted).toBe(true);
    await act(async () => b.resolve(['B']));
    await act(async () => a.resolve(['A']));
    expect(latest?.data).toEqual(['B']);
    expect(latest?.initialError).toBe('');
  });

  it('背景失敗保留資料且成功重試會清除錯誤；首次失敗不是空結果', async () => {
    await render('A');
    await act(async () => requests[0].reject(new Error('首次失敗')));
    expect(latest?.data).toBeNull();
    expect(latest?.initialError).toBe('首次失敗');
    act(() => latest!.refresh());
    await act(async () => requests[1].resolve(['成功']));
    act(() => latest!.refresh());
    await act(async () => requests[2].reject(new Error('背景失敗')));
    expect(latest?.data).toEqual(['成功']);
    expect(latest?.backgroundError).toBe('背景失敗');
    act(() => latest!.refresh());
    await act(async () => requests[3].resolve(['恢復']));
    expect(latest?.backgroundError).toBe('');
    expect(latest?.data).toEqual(['恢復']);
  });

  it('進行中連續失效只補跑一次，停用會中止且重新啟用不洩漏舊資料', async () => {
    await render('A');
    act(() => {
      latest!.refresh();
      latest!.refresh();
      latest!.refresh();
    });
    expect(requests).toHaveLength(1);
    await act(async () => requests[0].resolve(['A']));
    expect(requests).toHaveLength(2);
    await act(async () => requests[1].resolve(['A2']));
    expect(requests).toHaveLength(2);
    act(() => latest!.refresh());
    const pending = requests[2];
    await render('A', false);
    expect(pending.signal.aborted).toBe(true);
    expect(latest?.data).toBeNull();
    expect(latest?.initialLoading).toBe(false);
    await render('A', true);
    expect(latest?.data).toBeNull();
    expect(latest?.initialLoading).toBe(true);
  });

  it('背景重查預設 500ms 節流：進行中密集失效只補一支，且不等通知停下才查', async () => {
    vi.useFakeTimers();
    try {
      await render('A', true, 500);
      for (let i = 0; i < 20; i += 1) {
        act(() => latest!.backgroundRefresh());
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
        if (i === 2) await act(async () => requests[0].resolve(['A1']));
      }
      // 2 秒內 20 則通知：第一支 300ms 回來，之後每 ≥500ms 一支，不是 20 支，也不是 0 支
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.length).toBeLessThanOrEqual(5);
      expect(latest?.data).toEqual(['A1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('換條件立即查，不受節流；背景重查連續失敗退避', async () => {
    vi.useFakeTimers();
    try {
      await render('A', true, 500);
      await render('B', true, 500);
      expect(requests).toHaveLength(2);
      await act(async () => requests[1].reject(new Error('失敗1')));
      act(() => latest!.backgroundRefresh());
      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(requests).toHaveLength(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(requests).toHaveLength(3);
      await act(async () => requests[2].resolve(['B']));
      expect(latest?.data).toEqual(['B']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('使用者操作的 refresh 立即查；進行中就等回來立即補，不走節流', async () => {
    vi.useFakeTimers();
    try {
      await render('A', true, 500);
      await act(async () => requests[0].resolve(['A1']));
      act(() => latest!.refresh());
      expect(requests).toHaveLength(2);
      act(() => latest!.refresh());
      await act(async () => requests[1].resolve(['A2']));
      expect(requests).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
