import { BadRequestException } from '@nestjs/common';
import { requireSingleStatement } from './single-statement';
import { LiveDataResetService } from './live-data-reset.service';

describe('LiveDataResetService', () => {
  function build(options?: { databaseFails?: boolean; redisFails?: boolean }) {
    const runner = {
      connect: jest.fn(), startTransaction: jest.fn(), isTransactionActive: true,
      query: options?.databaseFails
        ? jest.fn().mockRejectedValue(new Error('isolated database failure'))
        : jest.fn().mockResolvedValue([{
            order_action_states: 1, order_events: 1, operation_orders: 1,
            telemetry_logs: 2, vehicle_monitor_demo: 1,
          }]),
      commitTransaction: jest.fn().mockImplementation(() => { runner.isTransactionActive = false; }),
      rollbackTransaction: jest.fn().mockImplementation(() => { runner.isTransactionActive = false; }),
      release: jest.fn(),
    };
    const dataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([{ vehicle_code: 'CAR-A' }])
        .mockResolvedValue([{ operation_orders: 0, telemetry_logs: 0 }]),
      createQueryRunner: () => runner,
    };
    const redis = {
      listLiveStateKeys: jest.fn().mockResolvedValue(['vtms:health:CAR-B']),
      deleteLiveState: options?.redisFails
        ? jest.fn().mockRejectedValue(new Error('isolated redis failure'))
        : jest.fn().mockResolvedValue({ deleted: 1, keys: ['vtms:CAR-A'] }),
    };
    const service = new LiveDataResetService(
      dataSource as never,
      redis as never,
      { pauseLiveInputs: jest.fn(), clearLiveCaches: jest.fn(), resumeLiveInputs: jest.fn() } as never,
      { pauseAndDiscard: jest.fn().mockResolvedValue(0), resume: jest.fn() } as never,
      { pause: jest.fn().mockResolvedValue(undefined) } as never,
      { setEnabled: jest.fn().mockResolvedValue(undefined) } as never,
      { emit: jest.fn() } as never,
      { broadcastLiveStateReset: jest.fn() } as never,
    );
    return { service, runner };
  }

  it('derives scope from actual state and generates exactly one PostgreSQL statement', async () => {
    const preview = await build().service.preview();
    expect(preview.vehicleCodes).toEqual(['CAR-A', 'CAR-B']);
    expect(preview.mqttTopics).toContain('v1/vtms/CAR-B/health/heartbeat');
    expect(preview.sql).toContain("'CAR-A', 'CAR-B'");
    expect(() => requireSingleStatement(preview.sql)).not.toThrow();
    expect(JSON.stringify(preview)).not.toMatch(/FLUSHALL/i);
  });

  it('refuses an unscoped reset', async () => {
    await expect(build().service.execute([])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a database failure rolled back and leaves later steps not run', async () => {
    const { service, runner } = build({ databaseFails: true });
    const result = await service.execute(['CAR-A']);
    expect(result.status).toBe('failed');
    expect(result.database).toEqual({ committed: false, rolledBack: true });
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(result.steps.find((step) => step.id === 'redis')?.status).toBe('not_run');
  });

  it('reports partial completion when a post-commit cache step fails', async () => {
    const { service } = build({ redisFails: true });
    const result = await service.execute(['CAR-A']);
    expect(result.status).toBe('partial');
    expect(result.database).toEqual({ committed: true, rolledBack: false });
    expect(result.steps.find((step) => step.id === 'redis')?.status).toBe('failed');
    expect(result.steps.find((step) => step.id === 'notify_clients')?.status).toBe('not_run');
  });
});
