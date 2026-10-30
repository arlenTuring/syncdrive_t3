import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDatasourceQueryCacheForTags, datasourceQueryCacheStats, executeDatasourceQuery } from './useDataSourceStore';

/** 可以手動決定何時回應的 fetch：模擬「清空前送出、清空後才回來」的查詢 */
function deferredFetch() {
  const pending: Array<(rows: Record<string, unknown>[]) => void> = [];
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
    pending.push((rows) => resolve(new Response(JSON.stringify({ rows }), { status: 200 })));
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, respond: (index: number, rows: Record<string, unknown>[]) => pending[index](rows) };
}

afterEach(() => vi.unstubAllGlobals());

describe('失效通知之後，失效前送出的查詢不會把舊結果補回來', () => {
  const sql = "SELECT order_id FROM operation_orders WHERE line_kind = 'MAINTENANCE' /* generation-test */";

  it('失效後的新呼叫不共用失效前的進行中查詢，舊結果也不寫回快取', async () => {
    const { fetchMock, respond } = deferredFetch();

    const beforeClear = executeDatasourceQuery('default-internal', sql);
    clearDatasourceQueryCacheForTags(['table:operation_orders']);
    const afterClear = executeDatasourceQuery('default-internal', sql);
    // 同一支 SQL 同時只有一個網路請求：補查排在失效前那支後面
    expect(fetchMock).toHaveBeenCalledTimes(1);

    respond(0, [{ order_id: 'ORD-OLD' }]);
    expect(await beforeClear).toEqual([{ order_id: 'ORD-OLD' }]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    respond(1, []);
    expect(await afterClear).toEqual([]);

    // 第三次呼叫走快取：必須是清空後的空集合，而不是晚回來的舊單
    expect(await executeDatasourceQuery('default-internal', sql)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('進行中連續收到多則失效、多個元件來查：只補一支，不複製在途請求', async () => {
    const { fetchMock, respond } = deferredFetch();
    const burstSql = `${sql} -- burst`;
    const first = executeDatasourceQuery('default-internal', burstSql);
    const followers: Promise<Record<string, unknown>[]>[] = [];
    for (let i = 0; i < 10; i += 1) {
      clearDatasourceQueryCacheForTags(['table:operation_orders']);
      followers.push(executeDatasourceQuery('default-internal', burstSql));
      followers.push(executeDatasourceQuery('default-internal', burstSql));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond(0, [{ order_id: 'OLD' }]);
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    respond(1, [{ order_id: 'NEW' }]);
    const results = await Promise.all(followers);
    expect(results.every((rows) => rows[0]?.order_id === 'NEW')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(datasourceQueryCacheStats().inflight).toBe(0);
  });

  it('失效前那支失敗，補查照樣開始', async () => {
    const pending: Array<{ resolve: (r: Response) => void; reject: (e: Error) => void }> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject })));
    vi.stubGlobal('fetch', fetchMock);
    const failSql = `${sql} -- fail`;
    const first = executeDatasourceQuery('default-internal', failSql);
    clearDatasourceQueryCacheForTags(['table:operation_orders']);
    const second = executeDatasourceQuery('default-internal', failSql);
    pending[0].reject(new Error('network'));
    await expect(first).rejects.toThrow('network');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    pending[1].resolve(new Response(JSON.stringify({ rows: [{ ok: 1 }] }), { status: 200 }));
    expect(await second).toEqual([{ ok: 1 }]);
  });

  it('不相關的失效標籤不影響這支查詢', async () => {
    const { fetchMock, respond } = deferredFetch();
    const otherSql = `${sql} -- other`;
    const first = executeDatasourceQuery('default-internal', otherSql);
    clearDatasourceQueryCacheForTags(['table:dashboard_planes']);
    const second = executeDatasourceQuery('default-internal', otherSql);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond(0, [{ order_id: 'ORD-1' }]);
    expect(await first).toEqual(await second);
  });
});
