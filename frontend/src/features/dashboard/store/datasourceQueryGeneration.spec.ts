import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDatasourceQueryCacheForTags, executeDatasourceQuery } from './useDataSourceStore';

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
    expect(fetchMock).toHaveBeenCalledTimes(2);

    respond(1, []);
    expect(await afterClear).toEqual([]);
    respond(0, [{ order_id: 'ORD-OLD' }]);
    expect(await beforeClear).toEqual([{ order_id: 'ORD-OLD' }]);

    // 第三次呼叫走快取：必須是清空後的空集合，而不是晚回來的舊單
    expect(await executeDatasourceQuery('default-internal', sql)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
