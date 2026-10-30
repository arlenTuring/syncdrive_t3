import { afterEach, describe, expect, it, vi } from 'vitest';

/** 2026-10-30 圖台在途請求以完整語意 key 重測：兩個資料來源指向同一後端，datasource/ping 同時打兩支 */
const sources: Record<string, { type: string; backendUrl: string }> = {
  internal: { type: 'internal', backendUrl: 'http://backend.test' },
  mqtt: { type: 'mqtt', backendUrl: 'http://backend.test' },
  other: { type: 'internal', backendUrl: 'http://other.test' },
};
vi.mock('../store/useDataSourceStore', () => ({ getDataSourceById: (id: string) => sources[id] }));

const { pingDataSourceById } = await import('./bindingHealth');

afterEach(() => vi.unstubAllGlobals());

describe('pingDataSourceById', () => {
  it('同一後端同時檢查只打一支，結果共用；不同後端各打各的；結束後下一次重新打', async () => {
    const resolvers: Array<() => void> = [];
    const fetchMock = vi.fn(
      () => new Promise((resolve) => resolvers.push(() => resolve({ json: async () => ({ ok: true }) }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const all = Promise.all([pingDataSourceById('internal'), pingDataSourceById('mqtt'), pingDataSourceById('other')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvers.forEach((r) => r());
    expect(await all).toEqual([true, true, true]);
    const next = pingDataSourceById('mqtt');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    resolvers[2]();
    expect(await next).toBe(true);
  });

  it('失敗也共用同一個結果', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('down')));
    vi.stubGlobal('fetch', fetchMock);
    expect(await Promise.all([pingDataSourceById('internal'), pingDataSourceById('mqtt')])).toEqual([false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
