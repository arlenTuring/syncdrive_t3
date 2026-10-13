import { TelemetryWriteQueue } from './telemetry-write.queue';

describe('TelemetryWriteQueue', () => {
  it('歷史寫入阻塞時佇列有上限，最新快照不受這條佇列影響', () => {
    const queue = new TelemetryWriteQueue({ saveTelemetryBatch: jest.fn() } as any);
    (queue as any).draining = true;
    for (let index = 0; index < 5_100; index += 1) {
      queue.enqueue('PMS01', { timestamp: index });
    }
    expect((queue as any).queue.length).toBeLessThanOrEqual(5_000);
    expect((queue as any).queue.at(-1).payload.timestamp).toBe(5_099);
  });
});
