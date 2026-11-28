import { TimeTemplateUsageStatus } from '../database/entities/time-template.entity';
import {
  formatTemplateTimestamp,
  toTimeTemplateListItem,
  usageStatusLabel,
} from './time-template-list.util';

describe('time-template-list.util', () => {
  it('formatTemplateTimestamp', () => {
    const ms = new Date('2026-05-01T08:00:00').getTime();
    expect(formatTemplateTimestamp(String(ms))).toBe('2026-05-01 08:00');
  });

  it('toTimeTemplateListItem maps labels; templates have no draft/published status', () => {
    const ms = String(new Date('2026-05-01T08:00:00').getTime());
    const item = toTimeTemplateListItem({
      id: 'TT-TEST',
      name: '測試模板',
      usageStatus: TimeTemplateUsageStatus.IDLE,
      body: {},
      createdAt: ms,
      updatedAt: ms,
    } as never);
    expect(item.usage_status_label).toBe('未使用');
    expect(item).not.toHaveProperty('publish_status');
    expect(item).not.toHaveProperty('publish_status_label');
  });

  it('usageStatusLabel', () => {
    expect(usageStatusLabel(TimeTemplateUsageStatus.IN_USE)).toBe('使用中');
  });
});
