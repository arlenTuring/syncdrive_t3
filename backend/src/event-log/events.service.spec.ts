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
