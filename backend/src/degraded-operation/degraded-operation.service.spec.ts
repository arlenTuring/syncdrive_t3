import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DegradedOperationDraft } from '../database/entities/degraded-operation-draft.entity';
import { DegradedOperationEvent } from '../database/entities/degraded-operation-event.entity';
import { DegradedOperationExecution } from '../database/entities/degraded-operation-execution.entity';
import { DegradedOperationPlan } from '../database/entities/degraded-operation-plan.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import {
  CreateDegradedOperationPlanDto,
  RestoreExecutionDto,
} from './degraded-operation.dto';
import {
  DegradedOperationService,
  resolveScheduledOperatingTime,
} from './degraded-operation.service';

describe('degraded operation', () => {
  it('accepts zero speed, rejects invalid speeds, and requires both restore confirmations', () => {
    expect(
      validateSync(
        plainToInstance(CreateDegradedOperationPlanDto, {
          name: '停駛',
          level: 3,
          speed_limit_kmh: 0,
        }),
      ),
    ).toHaveLength(0);
    for (const speed of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(
        validateSync(
          plainToInstance(CreateDegradedOperationPlanDto, {
            name: '錯誤',
            level: 3,
            speed_limit_kmh: speed,
          }),
        ).length,
      ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(RestoreExecutionDto, {
          personnel_and_vehicles_cleared: true,
          alarms_cleared: true,
          version: 1,
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(RestoreExecutionDto, {
          personnel_and_vehicles_cleared: true,
          version: 1,
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('uses the operating day, treats current minute as immediate, and rejects past minutes', () => {
    const now = Date.parse('2026-10-10T02:15:30.000Z');
    expect(resolveScheduledOperatingTime(now, '10:15', 'Asia/Taipei')).toBe(
      now,
    );
    expect(resolveScheduledOperatingTime(now, '10:16', 'Asia/Taipei')).toBe(
      Date.parse('2026-10-10T02:16:00.000Z'),
    );
    expect(() =>
      resolveScheduledOperatingTime(now, '10:14', 'Asia/Taipei'),
    ).toThrow(BadRequestException);
  });

  it('keeps immediate execution idempotent and reports control as not dispatched', async () => {
    const harness = createHarness(Date.parse('2026-10-10T02:15:30Z'));
    const input = {
      name: '測試降級',
      description: '',
      level: 3,
      speed_limit_kmh: 30,
      schedule_mode: 'immediate' as const,
      time_zone: 'Asia/Taipei',
      idempotency_key: 'same-request',
    };
    const first = await harness.service.execute(input, 'tester');
    const second = await harness.service.execute(input, 'tester');
    expect(first.execution_id).toBe(second.execution_id);
    expect(first).toMatchObject({
      execution_status: 'active',
      control_status: 'not_dispatched',
    });
    expect(harness.executions.size).toBe(1);
    expect((await harness.service.getOperationStatus()).mode).toBe('degraded');
  });

  it('persists a future schedule and a restarted service activates it once when due', async () => {
    const harness = createHarness(Date.parse('2026-10-10T02:15:30Z'));
    const scheduled = await harness.service.execute(
      {
        name: '預約',
        level: 2,
        speed_limit_kmh: 20,
        schedule_mode: 'scheduled',
        scheduled_time: '10:16',
        time_zone: 'Asia/Taipei',
        idempotency_key: 'scheduled-request',
      },
      'tester',
    );
    expect(scheduled.execution_status).toBe('scheduled');
    await harness.service.processDueSchedules();
    expect(
      harness.executions.get(scheduled.execution_id)?.executionStatus,
    ).toBe('scheduled');
    harness.setNow(Date.parse('2026-10-10T02:16:01Z'));
    const restarted = harness.recreateService();
    await restarted.processDueSchedules();
    await restarted.processDueSchedules();
    expect(harness.executions.get(scheduled.execution_id)).toMatchObject({
      executionStatus: 'active',
      version: 2,
    });
  });
});

function createHarness(initialNow: number) {
  let now = initialNow;
  const plans = new Map<string, DegradedOperationPlan>();
  const executions = new Map<string, DegradedOperationExecution>();
  const settings = new Map<string, SystemSetting>();
  const events = new Map<string, DegradedOperationEvent>();
  const drafts = new Map<string, DegradedOperationDraft>();
  const store = (entity: Function): Map<string, any> =>
    entity === DegradedOperationPlan
      ? plans
      : entity === DegradedOperationExecution
        ? executions
        : entity === SystemSetting
          ? settings
          : entity === DegradedOperationEvent
            ? events
            : drafts;
  const create = <T>(entity: new () => T, value: Partial<T>) =>
    Object.assign(new entity(), value);
  const save = async <
    T extends { id?: string; key?: string; settingKey?: string },
  >(
    value: T,
  ) => {
    store(value.constructor).set(
      value.id ?? value.key ?? value.settingKey!,
      value,
    );
    return value;
  };
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) =>
    Object.entries(where).every(([key, expected]) =>
      expected &&
      typeof expected === 'object' &&
      '_value' in (expected as object)
        ? (expected as { _value: unknown[] })._value.includes(row[key])
        : row[key] === expected,
    );
  const repo = <T extends { id?: string; key?: string; settingKey?: string }>(
    entity: new () => T,
  ) => ({
    create: (value: Partial<T>) => create(entity, value),
    save,
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      [...store(entity).values()].find((row) => matches(row, where)) ?? null,
    find: async () => [],
    findAndCount: async () => [[], 0],
    delete: async () => ({ affected: 1 }),
    createQueryBuilder: () => ({
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      orderBy() {
        return this;
      },
      getOne: async () =>
        [...executions.values()].find(
          (row) =>
            row.executionStatus === 'scheduled' &&
            Number(row.scheduledForOperating) <= now,
        ) ?? null,
    }),
  });
  const manager = {
    create,
    save,
    query: async () => [],
    findOne: async <T>(
      entity: new () => T,
      { where }: { where: Record<string, unknown> },
    ) => [...store(entity).values()].find((row) => matches(row, where)) ?? null,
    delete: async <T>(entity: new () => T, id: string) => {
      store(entity).delete(id);
    },
  };
  const dataSource = {
    transaction: async <T>(
      callback: (transactionManager: typeof manager) => Promise<T>,
    ) => callback(manager),
  };
  const clock = { now: () => now };
  const foundation = {
    get: async () => ({ globalParams: { defaultVehicleSpeedLimitKmh: 40 } }),
  };
  const recreateService = () =>
    new DegradedOperationService(
      repo(DegradedOperationPlan) as never,
      repo(DegradedOperationExecution) as never,
      repo(SystemSetting) as never,
      repo(DegradedOperationEvent) as never,
      repo(DegradedOperationDraft) as never,
      dataSource as never,
      clock as never,
      foundation as never,
    );
  return {
    service: recreateService(),
    recreateService,
    executions,
    setNow: (value: number) => {
      now = value;
    },
  };
}
