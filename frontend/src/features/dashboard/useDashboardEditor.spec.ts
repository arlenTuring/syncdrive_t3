import { describe, expect, it } from 'vitest';
import { sameDashboardJson } from './useDashboardEditor';

describe('dashboard migration comparison', () => {
  it('treats JSONB key reordering as unchanged but detects a real value change', () => {
    expect(sameDashboardJson(
      { id: 'eta-n2w', tabs: [{ rowKeyField: 'row_key', columns: [1, 2] }] },
      { tabs: [{ columns: [1, 2], rowKeyField: 'row_key' }], id: 'eta-n2w' },
    )).toBe(true);
    expect(sameDashboardJson({ showHeader: true }, { showHeader: false })).toBe(false);
  });
});
