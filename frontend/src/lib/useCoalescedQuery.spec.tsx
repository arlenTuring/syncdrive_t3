// @vitest-environment jsdom
import { act, createElement, useCallback, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCoalescedQuery } from './useCoalescedQuery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred = { signal: AbortSignal; resolve: (value: string[]) => void; reject: (reason: Error) => void };
const requests: Deferred[] = [];
let latest: ReturnType<typeof useCoalescedQuery<string[]>> | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe({ queryKey, enabled = true }: { queryKey: string; enabled?: boolean }) {
  const load = useCallback((signal: AbortSignal) => new Promise<string[]>((resolve, reject) => {
    requests.push({ signal, resolve, reject });
  }), []);
  const value = useCoalescedQuery({ enabled, queryKey, load });
  useEffect(() => {
    latest = value;
  }, [value]);
  return createElement('div', null, value.data?.join(',') ?? 'none');
}

async function render(queryKey: string, enabled = true) {
  await act(async () => root!.render(createElement(Probe, { queryKey, enabled })));
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
});
