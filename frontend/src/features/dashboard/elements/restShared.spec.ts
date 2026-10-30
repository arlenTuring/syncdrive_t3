import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonShared, restSharedSize } from './useWidgetData';

function deferredFetch() {
  const pending: Array<(body: unknown) => void> = [];
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
    pending.push((body) => resolve(new Response(JSON.stringify(body), { status: 200 })));
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, respond: (index: number, body: unknown) => pending[index](body) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('REST 共用：多個元件＋密集失效不複製在途請求，也不拿失效前的結果冒充更新', () => {
  it('失效後的呼叫排在失效前那支後面，共用一支補查', async () => {
    const { fetchMock, respond } = deferredFetch();
    const url = '/syncdrive-api/x?case=1';
    const before = fetchJsonShared(url, 0);
    expect(fetchJsonShared(url, 0)).toBe(before);
    const invalidatedAt = Date.now() + 1;
    vi.useFakeTimers({ now: invalidatedAt, toFake: ['Date'] });
    const after = Array.from({ length: 5 }, () => fetchJsonShared(url, invalidatedAt));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond(0, { v: 'old' });
    expect(await before).toEqual({ v: 'old' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    respond(1, { v: 'new' });
    expect(await Promise.all(after)).toEqual(Array(5).fill({ v: 'new' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('共用期過了就從表裡收掉，網址再多也不累積', async () => {
    vi.useFakeTimers();
    const { respond } = deferredFetch();
    const base = restSharedSize();
    const promises = Array.from({ length: 20 }, (_, i) => fetchJsonShared(`/syncdrive-api/x?case=2&i=${i}`));
    expect(restSharedSize()).toBe(base + 20);
    for (let i = 0; i < 20; i += 1) respond(i, { i });
    await Promise.all(promises);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(restSharedSize()).toBe(base);
  });
});
