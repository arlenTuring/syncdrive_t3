import { BadRequestException } from '@nestjs/common';
import { LiveDataResetService } from './live-data-reset.service';

describe('LiveDataResetService', () => {
  function service() {
    return new LiveDataResetService(
      { query: jest.fn().mockResolvedValue([{ vehicle_code: 'CAR-A' }]) } as never,
      { listLiveStateKeys: jest.fn().mockResolvedValue(['vtms:health:CAR-B']) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('derives the scope and exact topics from actual database and Redis state', async () => {
    const preview = await service().preview();
    expect(preview.vehicleCodes).toEqual(['CAR-A', 'CAR-B']);
    expect(preview.mqttTopics).toContain('v1/vtms/CAR-B/health/heartbeat');
    expect(preview.sql).toContain("'CAR-A', 'CAR-B'");
    expect(JSON.stringify(preview)).not.toMatch(/FLUSHALL/i);
  });

  it('refuses an unscoped reset', async () => {
    await expect(service().execute([])).rejects.toBeInstanceOf(BadRequestException);
  });
});
