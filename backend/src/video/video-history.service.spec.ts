import { BadRequestException } from '@nestjs/common';
import { VideoHistoryService } from './video-history.service';

describe('VideoHistoryService.sourceCandidates', () => {
  const from = 1_800_000_000_000;
  const to = from + 60_000;

  it('以歷史版本與實際片段完整配對後才套用 12 路上限', async () => {
    const query = jest.fn().mockResolvedValue([{ source_id: 'source-1', name: '前鏡頭' }]);
    const service = Object.create(VideoHistoryService.prototype) as VideoHistoryService;
    Object.assign(service, { dataSource: { query } });

    await expect(service.sourceCandidates({ vehicleCode: 'PMS01', from, to })).resolves.toEqual({
      items: [{ id: 'source-1', name: '前鏡頭' }],
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN video_source_revisions');
    expect(sql).toContain("s.status IN ('READY', 'REMOTE_READY', 'UPLOADING')");
    expect(sql.indexOf('GROUP BY')).toBeLessThan(sql.indexOf('LIMIT 12'));
    expect(params).toEqual([from, to, 'PMS01']);
  });

  it('拒絕缺少載具或過大的查詢區間', async () => {
    const service = Object.create(VideoHistoryService.prototype) as VideoHistoryService;
    Object.assign(service, { dataSource: { query: jest.fn() } });
    await expect(service.sourceCandidates({ from, to })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sourceCandidates({ vehicleCode: 'PMS01', from, to: from + 32 * 86_400_000 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
