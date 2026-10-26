import { BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';

describe('EventsService 事件管理集合與確認緣由', () => {
  const service = new EventsService({ query: jest.fn(), transaction: jest.fn() } as never, {} as never);
  const actor = { id: 'u1', display_name: '測試員', roles: [], permissions: [] };

  it.each([
    [undefined, '必填'],
    [null, '必填'],
    ['', '請填寫'],
    [' \n ', '請填寫'],
    [[], '必須是文字'],
    [{}, '必須是文字'],
    ['x'.repeat(501), '最多 500 字'],
  ])('在寫入前拒絕無效確認緣由 %#', async (note, message) => {
    await expect(service.acknowledge('1', note, actor, {})).rejects.toThrow(message);
  });

  it('live bucket 為必填且只接受 pending／confirmed', async () => {
    await expect(service.live({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.live({ bucket: 'recent' })).rejects.toThrow('事件集合');
  });

  it('live 以兩個部分索引條件取得精確計數，並保留歷史確認時間為空的資料', async () => {
    const dataSource = {
      query: jest.fn((sql: string) => {
        if (sql.includes('AS rank')) return Promise.resolve([]);
        if (sql.includes('SELECT count(*)::int')) return Promise.resolve([{ pending: 11, confirmed: 4, max_id: '15', max_ack: '0' }]);
        throw new Error(`未預期 SQL: ${sql}`);
      }),
    };
    const target = new EventsService(dataSource as never, {} as never);
    jest.spyOn(target, 'timeZone').mockResolvedValue('Asia/Taipei');

    await expect(target.live({ bucket: 'confirmed', limit: '20' })).resolves.toMatchObject({
      items: [], total: 4, pendingTotal: 11, confirmedTotal: 4, timeZone: 'Asia/Taipei',
    });
    const countsSql = dataSource.query.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('SELECT count(*)::int')) as string;
    expect(countsSql).toContain('WHERE is_acknowledged = false');
    expect(countsSql).toContain('WHERE is_acknowledged = true');
    expect(countsSql).not.toContain('FILTER (WHERE');
  });

  it('事件 ID 精確查詢不需要也不套用時間區間，並以 bigint 字串完整查詢', async () => {
    const dataSource = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        if (sql.includes('count(*)')) return Promise.resolve([{ total: 0 }]);
        if (sql.includes('FROM security_event_logs e')) return Promise.resolve([]);
        throw new Error(`未預期 SQL: ${sql} ${String(params)}`);
      }),
    };
    const target = new EventsService(dataSource as never, {} as never);
    jest.spyOn(target, 'timeZone').mockResolvedValue('Asia/Taipei');
    await expect(target.list({ eventRecordId: '9007199254740993', page: '1' })).resolves.toMatchObject({ total: 0, range: null, snapshot: '9007199254740993' });
    const calls = dataSource.query.mock.calls.filter(([sql]) => sql.includes('FROM security_event_logs e'));
    expect(calls).toHaveLength(2);
    for (const [sql, params] of calls) {
      expect(sql).toContain('e.id = $1::bigint');
      expect(sql).not.toContain('e.created_at >=');
      expect(params).toEqual(['9007199254740993']);
    }
  });

  it.each(['0', '-1', '1.2', 'abc', '9223372036854775808'])('事件 ID 不合法時在送進 PostgreSQL cast 前回 400：%s', async (eventRecordId) => {
    await expect(service.list({ eventRecordId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('事件 ID CSV 使用相同精確條件並清楚區分系統主鍵與來源事件 ID', async () => {
    const row = { id: '42', event_id: 'DEVICE-42', source_type: 'VEHICLE', source_id: 'PMS01', source_name_snapshot: 'PMS01', origin: 'REPORTED', vehicle_code: 'PMS01', event_code: 'PATH_BLOCKED', severity: 'WARNING', created_at: '1', occurred_at_valid: true, received_at: '2', display_message: 'x', detail: null, is_acknowledged: false, acknowledged_at: null, acknowledged_by_name: null, acknowledgement_note: null, location: null };
    const dataSource = { query: jest.fn((sql: string) => sql.includes('count(*)') ? Promise.resolve([{ total: 1 }]) : Promise.resolve([row])) };
    const target = new EventsService(dataSource as never, {} as never);
    jest.spyOn(target, 'timeZone').mockResolvedValue('Asia/Taipei');
    const result = await target.exportCsv({ eventRecordId: '42' });
    expect(result.csv).toContain('事件 ID（系統紀錄主鍵）');
    expect(result.csv).toContain('來源事件 ID');
    expect(result.csv).toContain('42');
    expect(result.csv).toContain('DEVICE-42');
  });

  it.each([
    ['  已聯絡現場\nEngineer confirmed  ', '已聯絡現場\nEngineer confirmed'],
    [` ${'界'.repeat(500)} `, '界'.repeat(500)],
  ])('合法中英、換行與 500 字邊界完整保存 %#', async (input, saved) => {
    const manager = { query: jest.fn().mockResolvedValue([{ id: '1' }]) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = { transaction: jest.fn((work: (value: typeof manager) => unknown) => work(manager)) };
    const target = new EventsService(dataSource as never, audit as never);
    jest.spyOn(target, 'detail').mockResolvedValue({ id: '1' } as never);

    await expect(target.acknowledge('1', input, actor, {})).resolves.toMatchObject({ id: '1', alreadyAcknowledged: false });
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE security_event_logs'), ['1', 'u1', '測試員', expect.any(Number), saved]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].actionDetail).toEqual({ note: saved });
  });
});
