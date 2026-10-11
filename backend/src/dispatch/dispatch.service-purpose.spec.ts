import { servicePurposeByBlock } from './dispatch.service-purpose';

const block = (id: string, taskType: string, start: number, end: number) => ({
  id, taskType, plannedStartMinute: start, plannedEndMinute: end,
});

describe('servicePurposeByBlock', () => {
  it('過渡與等待卡服務緊接在後的任務；待命與沒有後續任務算待命', () => {
    const body = {
      scheduleOutput: {
        plan: {
          timelines: [
            {
              blocks: [
                block('standby-morning', 'standby', 300, 400), // 清晨候用
                block('exit-1', 'dispatch', 400, 405), // 出廠
                block('hold-1', 'idle', 405, 410), // 接班等待
                block('trip-1', 'passenger', 410, 440),
                block('entry-1', 'dispatch', 440, 445), // 入廠去充電
                block('charge', 'charging', 445, 500),
                block('hold-2', 'idle', 500, 505), // 充電後等待，後面沒任務
              ],
            },
          ],
        },
      },
    };
    const purposes = servicePurposeByBlock(body);
    const of = (id: string) => purposes.get(id)?.purpose;
    expect(of('standby-morning')).toBe('standby');
    expect(of('exit-1')).toBe('operation');
    expect(of('hold-1')).toBe('operation');
    expect(purposes.get('hold-1')?.servesBlockId).toBe('trip-1');
    expect(of('trip-1')).toBe('operation');
    expect(of('entry-1')).toBe('maintenance');
    expect(purposes.get('entry-1')?.servesTaskType).toBe('charging');
    expect(of('charge')).toBe('maintenance');
    expect(of('hold-2')).toBe('standby');
  });

  it('每一列各自判斷，不跨列', () => {
    const purposes = servicePurposeByBlock({
      scheduleOutput: { plan: { timelines: [
        { blocks: [block('a-exit', 'dispatch', 0, 5)] },
        { blocks: [block('b-trip', 'passenger', 10, 20)] },
      ] } },
    });
    expect(purposes.get('a-exit')?.purpose).toBe('standby');
  });
});
