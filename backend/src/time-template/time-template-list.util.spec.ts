import {
  TimeTemplatePublishStatus,
  TimeTemplateUsageStatus,
} from '../database/entities/time-template.entity';
import {
  formatTemplateTimestamp,
  publishStatusLabel,
  toTimeTemplateListItem,
  usageStatusLabel,
} from './time-template-list.util';

describe('time-template-list.util', () => {
  it('formatTemplateTimestamp', () => {
    const ms = new Date('2026-05-01T08:00:00').getTime();
    expect(formatTemplateTimestamp(String(ms))).toBe('2026-05-01 08:00');
  });

  it('toTimeTemplateListItem maps labels', () => {
    const ms = String(new Date('2026-05-01T08:00:00').getTime());
    const item = toTimeTemplateListItem({
      id: 'TT-TEST',
      name: '測試模板',
      publishStatus: TimeTemplatePublishStatus.DRAFT,
      usageStatus: TimeTemplateUsageStatus.IDLE,
      body: {},
      createdAt: ms,
      updatedAt: ms,
    } as never);
    expect(item.publish_status_label).toBe('草稿區');
    expect(item.usage_status_label).toBe('閒置中');
  });

  it('publishStatusLabel and usageStatusLabel', () => {
    expect(publishStatusLabel(TimeTemplatePublishStatus.PUBLISHED)).toBe('已發布');
    expect(usageStatusLabel(TimeTemplateUsageStatus.IN_USE)).toBe('使用中');
  });
});
