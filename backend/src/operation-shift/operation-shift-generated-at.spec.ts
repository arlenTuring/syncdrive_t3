import { readScheduleGeneratedAt } from './operation-shift-list.util';

describe('班表製作時間', () => {
  it('優先 scheduleOutput.generatedAt', () => {
    expect(
      readScheduleGeneratedAt({
        scheduleOutput: {
          generatedAt: '2026-10-01T08:00:00.000Z',
          plan: { generatedAt: '2026-09-01T00:00:00.000Z' },
        },
      }),
    ).toEqual({
      at: '2026-10-01T08:00:00.000Z',
      source: 'scheduleOutput.generatedAt',
    });
  });

  it('其次 scheduleOutput.plan.generatedAt', () => {
    expect(
      readScheduleGeneratedAt({
        scheduleOutput: { plan: { generatedAt: '2026-09-01T00:00:00.000Z' } },
      }),
    ).toEqual({
      at: '2026-09-01T00:00:00.000Z',
      source: 'scheduleOutput.plan.generatedAt',
    });
  });

  it('都沒有就是未記錄，不用現在時間補', () => {
    expect(readScheduleGeneratedAt({})).toEqual({ at: null, source: null });
    expect(
      readScheduleGeneratedAt({
        scheduleOutput: { generatedAt: 'not a date' },
      }),
    ).toEqual({ at: null, source: null });
  });
});
