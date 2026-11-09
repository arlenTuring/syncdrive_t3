import { BadRequestException } from '@nestjs/common';
import { EventTypesService, parseEventTypes } from './event-types.service';

describe('事件類型管理', () => {
  const valid = { code: 'Ss7125', name: '感測器被遮蔽', severity: 'CRITICAL', sopText: '請擦拭鏡頭' };

  it('接受設計稿的範例並把空的 SOP 存成 null', () => {
    expect(parseEventTypes({ items: [valid] })).toEqual([{ ...valid, sopUrl: null }]);
  });

  it.each([
    [{ items: [{ ...valid, code: '' }] }, '代碼為必填'],
    [{ items: [{ ...valid, code: 'A-1' }] }, '只能用英文字母、數字與底線'],
    [{ items: [{ ...valid, name: ' ' }] }, '事件名稱為必填'],
    [{ items: [{ ...valid, severity: 'HIGH' }] }, '請選擇嚴重等級'],
    [{ items: [{ ...valid, sopText: '界'.repeat(101) }] }, '最多 100 字'],
    [{ items: [{ ...valid, sopUrl: 'javascript:alert(1)' }] }, 'http 或 https'],
    [{ items: [valid, { ...valid, code: 'SS7125' }] }, '重複'],
    [{ items: [{ ...valid, extra: 1 }] }, '不接受的欄位'],
    [{}, '格式不正確'],
  ])('拒絕不合法的清單 %#', (input, message) => {
    expect(() => parseEventTypes(input)).toThrow(BadRequestException);
    expect(() => parseEventTypes(input)).toThrow(message);
  });

  it('整份取代時依清單順序寫入、記錄新增與刪除的代碼，並清掉名稱快取', async () => {
    const manager = {
      query: jest.fn((sql: string) => (sql.startsWith('SELECT') ? Promise.resolve([{ code: 'PATH_BLOCKED', name: '路徑受阻', severity: 'CRITICAL', sop_text: null, sop_url: null }]) : Promise.resolve([]))),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: jest.fn((work: (value: typeof manager) => unknown) => work(manager)),
      query: jest.fn().mockResolvedValue([{ code: 'Ss7125', name: '感測器被遮蔽', severity: 'CRITICAL', sop_text: '請擦拭鏡頭', sop_url: null }]),
    };
    const service = new EventTypesService(dataSource as never, audit as never);
    await service.byCode();
    await service.replace({ items: [valid] }, { id: 'u1', display_name: '測試員' } as never, {});
    const insert = manager.query.mock.calls.find(([sql]) => (sql as string).startsWith('INSERT'))!;
    expect(insert[1]).toEqual(['Ss7125', '感測器被遮蔽', 'CRITICAL', '請擦拭鏡頭', null, 1, expect.any(Number), 'u1']);
    expect(audit.record.mock.calls[0][0].actionDetail).toEqual({ added: ['Ss7125'], removed: ['PATH_BLOCKED'], total: 1 });
    await expect(service.labelOf('ss7125')).resolves.toBe('感測器被遮蔽');
  });
});
