import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { VideoConfigService } from './video-config.service';

describe('VideoConfigService 來源標籤查詢', () => {
  const build = () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    const manager = { find: jest.fn().mockResolvedValue([]), query: jest.fn().mockResolvedValue([]) };
    return { service: new VideoConfigService({ query, manager } as unknown as DataSource), query };
  };

  it('多標籤使用 OR 的 EXISTS/ANY，正規化去重且不產生重複來源列', async () => {
    const { service, query } = build();
    await service.querySources({ tags: ' 前門 ,後門,前門 ', page: 1, pageSize: 20 });
    expect(query.mock.calls[0][0]).toContain('EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.tags)');
    expect(query.mock.calls[0][0]).toContain('= ANY($1::text[])');
    expect(query.mock.calls[0][1]).toEqual([['前門', '後門']]);
    expect(query.mock.calls[1][0]).toContain('SELECT s.id');
  });

  it('超過明示上限時拒絕，不悄悄截斷', async () => {
    const { service } = build();
    const tags = Array.from({ length: 101 }, (_, index) => `t${index}`).join(',');
    await expect(service.querySources({ tags })).rejects.toBeInstanceOf(BadRequestException);
  });
});
