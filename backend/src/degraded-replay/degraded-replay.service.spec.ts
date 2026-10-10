import 'reflect-metadata';
import { parameterChanges } from './degraded-replay.service';

describe('parameterChanges', () => {
  const execution = {
    commandTracking: [
      {
        at: 1_000,
        result: 'not_dispatched',
        reason: 'degraded_control_contract_unavailable',
      },
      {
        at: 5_000,
        result: 'not_dispatched',
        reason: 'degraded_control_contract_unavailable',
      },
    ],
  } as never;
  const event = (
    action: string,
    realAt: number,
    operatingAt: number,
    before: object | null,
    after: object | null,
    result = 'success',
  ) =>
    ({
      id: `${action}-${realAt}`,
      action,
      operatorId: 'tester',
      realAt: String(realAt),
      operatingAt: String(operatingAt),
      beforeValue: before,
      afterValue: after,
      result,
    }) as never;

  it('keeps every change with operation, effective and dispatch times separated', () => {
    const changes = parameterChanges(execution, [
      event('immediate_submitted', 1_000, 90_000, null, {
        level: 3,
        speed_limit_kmh: 30,
      }),
      event(
        'parameters_adjusted',
        5_000,
        150_000,
        { level: 3, speed_limit_kmh: 30 },
        { level: 2, speed_limit_kmh: 20 },
      ),
      event('parameters_adjusted', 6_000, 160_000, null, null, 'failed'),
    ]);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      operated_at_real: 5_000,
      effective_at_operating: 150_000,
      level: 2,
      speed_limit_kmh: 20,
      previous_level: 3,
      previous_speed_limit_kmh: 30,
      control: { result: 'not_dispatched', dispatched_at_real: null },
    });
  });

  it('does not give a booking an effective time; the due event carries it', () => {
    const changes = parameterChanges(execution, [
      event('schedule_submitted', 1_000, 90_000, null, {
        level: 2,
        speed_limit_kmh: 25,
      }),
      event(
        'schedule_due',
        2_000,
        120_000,
        { execution_status: 'scheduled' },
        { level: 2, speed_limit_kmh: 25 },
      ),
    ]);
    expect(changes.map((change) => change.effective_at_operating)).toEqual([
      null,
      120_000,
    ]);
  });
});
