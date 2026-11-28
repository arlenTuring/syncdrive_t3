import { shiftTimelineRows } from './dispatch-engine.service';

describe('shiftTimelineRows：輪替選可接替時間線的清單', () => {
  it('lists every timeline of the deployed shift, including one with no task today', () => {
    const body = { scheduleOutput: { plan: { timelines: [{ row: 2, blocks: [] }, { row: 1, blocks: [{}] }, { row: 12, blocks: [] }] } } };
    expect(shiftTimelineRows(body)).toEqual([1, 2, 12]);
  });

  it('returns nothing when the shift has no schedule output', () => {
    expect(shiftTimelineRows({})).toEqual([]);
    expect(shiftTimelineRows({ scheduleOutput: { plan: { timelines: [{ row: 'x' }, { row: 0 }] } } })).toEqual([]);
  });
});
