import { normalizeDataSettings } from './dashboard-plane.service';

describe('儀表板資料設定（data_settings）', () => {
  it('只留 sourceMap，丟掉其他欄位；對應到自己的不存', () => {
    expect(normalizeDataSettings({ sourceMap: { 'default-internal': 'sql-b', 'default-mqtt': 'default-mqtt' }, password: 'x' }))
      .toEqual({ sourceMap: { 'default-internal': 'sql-b' } });
  });
  it('null 清空', () => {
    expect(normalizeDataSettings(null)).toBeNull();
  });
  it('不合法的 ID 或格式拒絕', () => {
    expect(() => normalizeDataSettings({ sourceMap: { 'default-internal': 'a b' } })).toThrow();
    expect(() => normalizeDataSettings({ sourceMap: ['x'] })).toThrow();
    expect(() => normalizeDataSettings('x')).toThrow();
  });
});
