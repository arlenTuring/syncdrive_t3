import { HEALTH_KEEPALIVE_MS, HISTORY_MAX_BUFFER, healthContentKey, VehicleHistoryRecorder } from './vehicle-history.recorder';

function createRecorder(options: { failInserts?: number } = {}) {
  let failuresLeft = options.failInserts ?? 0;
  const inserted: Array<Record<string, unknown>> = [];
  const gaps: Array<Record<string, unknown>> = [];
  const queries: string[] = [];
  const segmentUpdates: Array<Record<string, unknown>> = [];
  const frames = {
    insert: jest.fn(async (rows: Array<Record<string, unknown>>) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('db down');
      }
      inserted.push(...rows);
    }),
  };
  const segments = {
    create: (value: Record<string, unknown>) => value,
    save: jest.fn(async (value: Record<string, unknown>) => ({ ...value, id: '7' })),
    update: jest.fn(async (_where: unknown, value: Record<string, unknown>) => {
      segmentUpdates.push(value);
    }),
  };
  const gapRepo = { insert: jest.fn(async (row: Record<string, unknown>) => gaps.push(row)) };
  const dataSource = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
  const clock = { now: (real: number) => real - 1_000, snapshot: () => ({ mode: 'live', run_id: null }) };
  // 地圖讀不到：版本檢查只記警告，不影響錄製
  const mapService = { getActivePublishedMapLibrary: () => { throw new Error('no map'); } };
  const recorder = new VehicleHistoryRecorder(
    frames as never,
    segments as never,
    gapRepo as never,
    {} as never,
    dataSource as never,
    clock as never,
    mapService as never,
    {} as never,
  );
  return { recorder, inserted, gaps, queries, segmentUpdates, frames };
}

const mqttRows = (rows: Array<Record<string, unknown>>) => rows.filter((row) => row.source === 'mqtt');

describe('VehicleHistoryRecorder', () => {
  const recorders: VehicleHistoryRecorder[] = [];
  afterEach(async () => {
    while (recorders.length) await recorders.pop()!.onModuleDestroy();
  });
  async function started(options?: { failInserts?: number }) {
    const setup = createRecorder(options);
    await setup.recorder.onModuleInit();
    recorders.push(setup.recorder);
    return setup;
  }

  it('marks the previous unclosed segment as interrupted and opens a new one', async () => {
    const { recorder, queries } = await started();
    expect(recorder.enabled()).toBe(true);
    expect(queries[0]).toContain("status = 'interrupted'");
  });

  it('stores every telemetry message as received, with the backend-derived location kept separately', async () => {
    const { recorder, inserted } = await started();
    const payload = { vehicle_code: 'PMS-05', timestamp: 1000, local_pose: { position: { x: 1, y: 2 } } };
    recorder.capture('telemetry', { vehicleCode: 'PMS05', topic: 'v1/vtms/PMS-05/telemetry/update', payload, receivedAt: 5_000, derived: { location: { label: 'D1' } } });
    // 同一筆重送也照收（不去重）
    recorder.capture('telemetry', { vehicleCode: 'PMS05', topic: 'v1/vtms/PMS-05/telemetry/update', payload, receivedAt: 5_001 });
    await recorder.flush();
    const rows = mqttRows(inserted);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      stream: 'telemetry',
      streamKey: 'telemetry|PMS05',
      vehicleCode: 'PMS05',
      receivedAt: '5000',
      operatingAt: '4000',
      clockRun: 'live:',
      vehicleTs: '1000',
      payload,
      derived: { location: { label: 'D1' } },
    });
    expect((rows[0].payload as Record<string, unknown>).vehicle_code).toBe('PMS-05');
  });

  it('keeps health changes in any field, and only skips timestamp-only repeats within the keepalive', async () => {
    const { recorder, inserted } = await started();
    const base = { vehicle_code: 'PMS01', overall_health: 'OK', subsystems: { SENSING: { status: 'OK', error_codes: [] } } };
    recorder.capture('health', { vehicleCode: 'PMS01', topic: null, payload: { ...base, timestamp: 1 }, receivedAt: 10_000 });
    recorder.capture('health', { vehicleCode: 'PMS01', topic: null, payload: { ...base, timestamp: 2 }, receivedAt: 11_000 });
    // 只有錯誤碼變了：一定要留下
    recorder.capture('health', { vehicleCode: 'PMS01', topic: null, payload: { ...base, subsystems: { SENSING: { status: 'OK', error_codes: ['E12'] } }, timestamp: 3 }, receivedAt: 12_000 });
    recorder.capture('health', { vehicleCode: 'PMS01', topic: null, payload: { ...base, subsystems: { SENSING: { status: 'OK', error_codes: ['E12'] } }, timestamp: 4 }, receivedAt: 12_000 + HEALTH_KEEPALIVE_MS });
    await recorder.flush();
    expect(mqttRows(inserted).map((row) => row.receivedAt)).toEqual(['10000', '12000', String(12_000 + HEALTH_KEEPALIVE_MS)]);
  });

  it('retries a failed batch and records a gap only after the retries are used up', async () => {
    const { recorder, inserted, gaps } = await started({ failInserts: 1 });
    recorder.capture('operation', { vehicleCode: 'PMS02', topic: null, payload: { order_id: 'A', timestamp: 1 }, receivedAt: 20_000 });
    await recorder.flush();
    expect(mqttRows(inserted)).toHaveLength(0);
    // 下一輪重試成功：不記缺段，訂單號也存成可查詢的欄位
    (recorder as unknown as { retryAfter: number }).retryAfter = 0;
    await recorder.flush();
    expect(mqttRows(inserted)).toHaveLength(1);
    expect(mqttRows(inserted)[0].orderId).toBe('A');
    expect(gaps).toHaveLength(0);
  });

  it('records a write_failed gap with the lost count when every attempt fails', async () => {
    const { recorder, gaps } = await started({ failInserts: 100 });
    recorder.capture('telemetry', { vehicleCode: 'PMS03', topic: null, payload: { timestamp: 1 }, receivedAt: 30_000 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      (recorder as unknown as { retryAfter: number }).retryAfter = 0;
      await recorder.flush();
    }
    await new Promise((resolve) => setImmediate(resolve));
    // 失敗的那一批：這筆遙測＋啟動時記下的營運時鐘參照，兩筆都算進缺段
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ reason: 'write_failed', count: 2, fromReal: '30000', detail: 'db down' });
  });

  it('stops accepting when the buffer is full and records the dropped range as backpressure', async () => {
    const { recorder, gaps } = await started();
    const buffer = (recorder as unknown as { buffer: unknown[] }).buffer;
    while (buffer.length < HISTORY_MAX_BUFFER) buffer.push({ attempts: 0 });
    recorder.capture('telemetry', { vehicleCode: 'PMS04', topic: null, payload: { timestamp: 1 }, receivedAt: 40_000 });
    recorder.capture('telemetry', { vehicleCode: 'PMS04', topic: null, payload: { timestamp: 2 }, receivedAt: 40_500 });
    expect(buffer).toHaveLength(HISTORY_MAX_BUFFER);
    buffer.length = 0;
    await (recorder as unknown as { closeDroppedGap: () => Promise<void> }).closeDroppedGap();
    expect(gaps).toEqual([expect.objectContaining({ reason: 'backpressure', count: 2, fromReal: '40000', toReal: '40500' })]);
  });

  it('writes everything queued before closing the segment', async () => {
    const setup = createRecorder();
    await setup.recorder.onModuleInit();
    setup.recorder.capture('event', { vehicleCode: 'PMS05', topic: null, payload: { event_id: 'e1' }, receivedAt: 50_000 });
    await setup.recorder.onModuleDestroy();
    expect(mqttRows(setup.inserted)).toHaveLength(1);
    expect(setup.segmentUpdates.at(-1)).toMatchObject({ status: 'closed' });
    expect(setup.recorder.enabled()).toBe(false);
  });

  it('compares health by every field except the timestamp', () => {
    expect(healthContentKey({ a: 1, timestamp: 1, b: { y: 2, x: 1 } })).toBe(healthContentKey({ b: { x: 1, y: 2 }, timestamp: 9, a: 1 }));
    expect(healthContentKey({ a: 1, codes: [] })).not.toBe(healthContentKey({ a: 1, codes: ['E1'] }));
  });
});
