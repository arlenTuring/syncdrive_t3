import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataRetentionService } from './data-retention.service';

function serviceWith(query: jest.Mock) {
  const db = { query, options: { database: 'isolated_test', host: '127.0.0.1', type: 'postgres' }, transaction: jest.fn() } as any;
  return new DataRetentionService(db, { flushForCleanup: jest.fn() } as any, { flush: jest.fn() } as any, { flush: jest.fn() } as any);
}

describe('DataRetentionService', () => {
  it('預覽只精確計數並建立短效計畫，不修改業務資料', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('count(*)::bigint records FROM telemetry_logs WHERE received_at IS NOT NULL')) return [{ records: '4' }];
      if (sql.includes('count(*)::bigint records FROM telemetry_logs WHERE received_at IS NULL')) return [{ records: '2' }];
      if (sql.includes('active_replays')) return [{ active_replays: 0, active_recorders: 1, active_orders: 2 }];
      if (sql.includes('INSERT INTO data_cleanup_plans')) return [{ id: 'plan-1' }];
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const service = serviceWith(query);
    const result = await service.preview({ category: 'telemetry', to: Date.now() - 1_000, vehicleCode: 'PMS01' }, 'account-1');
    expect(result.planId).toBe('plan-1');
    expect(result.preview.records).toBe(4);
    expect(result.preview.protected[0]).toContain('2 筆');
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/DELETE\s+FROM/i);
  });

  it('沒有可靠來源標記時拒絕以測試 run 猜測資料', async () => {
    const service = serviceWith(jest.fn());
    await expect(service.preview({ category: 'vehicle_history', to: Date.now() - 1, sourceRun: 'PMS-demo' }, 'account-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('過期預覽不能執行', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'p', operator_id: 'account-1', expires_at: String(Date.now() - 1), consumed_at: null }]);
    const service = serviceWith(query);
    await expect(service.execute('p', 'account-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('指定單車清理採有界 DELETE，不會呼叫 drop_chunks', async () => {
    const query = jest.fn().mockResolvedValue([{ count: 1 }]);
    const service = serviceWith(query);
    const deleted = await (service as any).deleteBatch({ category: 'telemetry', to: Date.now(), vehicleCode: 'PMS01', snapshotAt: Date.now() });
    expect(deleted).toBe(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('LIMIT 2000');
    expect(sql).toContain('vehicle_code');
    expect(sql).not.toContain('drop_chunks');
  });

  it('能解析 PostgreSQL 對 UPDATE RETURNING 的巢狀回傳格式', () => {
    const service = serviceWith(jest.fn());
    expect((service as any).mutationRows([[{ id: 'job-1', criteria: { category: 'telemetry' } }], 1])).toEqual([
      { id: 'job-1', criteria: { category: 'telemetry' } },
    ]);
  });

  it('工作清單提供精確預覽總數供進度顯示', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = serviceWith(query);
    await service.jobs();
    expect(query.mock.calls[0][0]).toContain("p.preview->>'records'");
    expect(query.mock.calls[0][0]).toContain('expected_count');
  });
});
