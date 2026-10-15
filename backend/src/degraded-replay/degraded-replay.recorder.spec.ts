import 'reflect-metadata';
import { DegradedReplayRecorder } from './degraded-replay.recorder';

/**
 * 保存端的規則：只在降級進行中收、內容相同不重複存、營運時間倒退或換 run 不收而記缺段、
 * 寫入失敗記缺段、收尾時把排隊的寫完。
 */
function createRecorder({ historyEnabled = false }: { historyEnabled?: boolean } = {}) {
  let operatingNow = 1_000_000;
  let run = 'run-a';
  const inserted: Array<Record<string, unknown>> = [];
  const sessionUpdates: Array<Record<string, unknown>> = [];
  let failInsert = false;
  const frames = {
    insert: jest.fn(async (rows: Array<Record<string, unknown>>) => {
      if (failInsert) throw new Error('disk full');
      inserted.push(...rows);
    }),
  };
  const sessions = {
    create: (value: object) => value,
    save: jest.fn(async (value: object) => value),
    update: jest.fn(async (_where: object, value: Record<string, unknown>) => {
      sessionUpdates.push(value);
    }),
    findOne: jest.fn(async () => null),
  };
  const maps = {
    createQueryBuilder: () => ({
      insert() {
        return this;
      },
      into() {
        return this;
      },
      values() {
        return this;
      },
      orIgnore() {
        return this;
      },
      execute: async () => undefined,
    }),
  };
  const executions = { findOne: jest.fn(async () => null) };
  const dataSource = { query: jest.fn(async () => []) };
  const redis = {
    getTelemetry: async () => ({
      timestamp: 1,
      local_pose: { position: { x: 1, y: 2 } },
    }),
    getOperationUpdate: async () => ({ timestamp: 1, order_id: null }),
    getHealth: async () => ({ overall_health: 'OK' }),
  };
  const mapService = {
    getActivePublishedMapLibrary: () => ({
      mapId: 'map-1',
      mapDocument: { version: 'v1', displayName: '測試地圖', areas: [] },
    }),
  };
  const mapVehicles = {
    resolve: jest.fn(async () => ({
      mapId: 'map-1',
      source: 'map',
      setting: { definitionKey: 'bus', displayWidthPx: 88, displayHeightPx: 30 },
      missingDefinitionKey: null,
      definition: {
        definitionKey: 'bus',
        name: '巴士',
        version: 3,
        width: 260,
        height: 78,
        elements: [{ id: 'body', type: 'body', x: 0, y: 0, width: 260, height: 78 }],
      },
    })),
  };
  const clock = {
    now: () => operatingNow,
    toOperating: () => operatingNow,
    snapshot: () => ({ mode: 'replay', run_id: run }),
  };
  // 一般運行歷史：預設關閉（舊做法，降級自己保存全部串流）；historyEnabled＝true 時由一般歷史保存
  const systemFrames: Array<Record<string, unknown>> = [];
  const history = {
    enabled: () => historyEnabled,
    captureSystem: jest.fn((input: Record<string, unknown>) => {
      if (!historyEnabled) return false;
      systemFrames.push(input);
      return true;
    }),
    systemFrames,
  };
  const recorder = new DegradedReplayRecorder(
    sessions as never,
    maps as never,
    frames as never,
    executions as never,
    dataSource as never,
    redis as never,
    mapService as never,
    clock as never,
    mapVehicles as never,
    history as never,
  );
  return {
    recorder,
    history,
    sessions,
    inserted,
    sessionUpdates,
    setOperating: (value: number) => {
      operatingNow = value;
    },
    setRun: (value: string) => {
      run = value;
    },
    failWrites: (value: boolean) => {
      failInsert = value;
    },
  };
}

const lastGaps = (updates: Array<Record<string, unknown>>) =>
  (updates.at(-1)?.gaps ?? []) as Array<Record<string, unknown>>;

describe('DegradedReplayRecorder', () => {
  it('records nothing while no degradation is in progress', async () => {
    const harness = createRecorder();
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 1 });
    await harness.recorder.flush();
    expect(harness.inserted).toHaveLength(0);
  });

  it('captures the initial state, keeps live frames, and skips identical resends', async () => {
    const harness = createRecorder();
    // 開始前收過遙測：這台車算在場
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 1 });
    await harness.recorder.start({
      id: 'exec-1',
      startedAtReal: Date.now(),
      startedAtOperating: 1_000_000,
    });
    const initial = harness.inserted.filter((row) => row.kind === 'initial');
    expect(initial.map((row) => row.stream).sort()).toEqual([
      'health',
      'operation',
      'telemetry',
    ]);

    harness.setOperating(1_000_100);
    harness.recorder.capture('telemetry', 'PMS01', null, {
      timestamp: 2,
      x: 1,
    });
    harness.recorder.capture('telemetry', 'PMS01', null, {
      timestamp: 2,
      x: 1,
    });
    harness.recorder.capture('telemetry', 'PMS01', null, {
      timestamp: 3,
      x: 2,
    });
    await harness.recorder.flush();
    const live = harness.inserted.filter((row) => row.kind === 'live');
    expect(live).toHaveLength(2);
    expect(live[0]).toMatchObject({
      operatingAt: '1000100',
      vehicleTs: '2',
      stream: 'telemetry',
    });
  });

  it('does not write the same MQTT twice when the general run history is recording', async () => {
    const harness = createRecorder({ historyEnabled: true });
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 1 });
    await harness.recorder.start({ id: 'exec-h', startedAtReal: Date.now(), startedAtOperating: 2_000_000 });
    harness.setOperating(2_000_100);
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 2, x: 1 });
    harness.recorder.capture('health', 'PMS01', null, { timestamp: 2, overall_health: 'OK' });
    harness.recorder.capture('operation', 'PMS01', null, { timestamp: 2, order_id: 'ORD-H' });
    await harness.recorder.flush();
    await new Promise((resolve) => setImmediate(resolve));
    // 串流資料由一般運行歷史保存：降級表一筆遙測／營運／健康都沒有
    expect(harness.inserted.filter((row) => ['telemetry', 'operation', 'health'].includes(String(row.stream)))).toEqual([]);
    const saved = harness.sessions.save.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
    expect(saved.find((row) => row.executionId === 'exec-h')).toMatchObject({ framesSource: 'history' });
  });

  it('stores an immutable snapshot of the vehicle model used by the map at start', async () => {
    const harness = createRecorder();
    await harness.recorder.start({ id: 'exec-1', startedAtReal: Date.now(), startedAtOperating: 1_000_000 });
    const saved = harness.sessions.save.mock.calls[0][0] as { vehicleModel: Record<string, unknown> };
    expect(saved.vehicleModel).toMatchObject({
      source: 'map',
      setting: { definitionKey: 'bus', displayWidthPx: 88, displayHeightPx: 30 },
      definition: { definitionKey: 'bus', version: 3, elements: [expect.objectContaining({ type: 'body' })] },
    });
  });

  it('does not record frames while the operating clock has regressed, and marks the gap', async () => {
    const harness = createRecorder();
    await harness.recorder.start({
      id: 'exec-1',
      startedAtReal: Date.now(),
      startedAtOperating: 1_000_000,
    });
    harness.setOperating(1_050_000);
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 10 });
    // 時鐘倒退（後端重啟、執行端心跳未到）
    harness.setOperating(900_000);
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 11 });
    harness.setOperating(1_060_000);
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 12 });
    await harness.recorder.flush();
    const live = harness.inserted.filter((row) => row.kind === 'live');
    expect(live.map((row) => row.operatingAt)).toEqual(['1050000', '1060000']);
    expect(lastGaps(harness.sessionUpdates)).toEqual([
      expect.objectContaining({
        reason: 'clock_unsynced',
        from_operating: 1_050_000,
        to_operating: 1_060_000,
      }),
    ]);
  });

  it('does not mix data from another operating-clock run', async () => {
    const harness = createRecorder();
    await harness.recorder.start({
      id: 'exec-1',
      startedAtReal: Date.now(),
      startedAtOperating: 1_000_000,
    });
    harness.setRun('run-b');
    harness.recorder.capture('telemetry', 'PMS01', null, { timestamp: 20 });
    await harness.recorder.stop('exec-1', {
      real: Date.now(),
      operating: 1_100_000,
    });
    expect(harness.inserted.filter((row) => row.kind === 'live')).toHaveLength(
      0,
    );
    const final = harness.sessionUpdates.at(-1)!;
    expect(final.status).toBe('complete');
    expect(final.gaps).toEqual([
      expect.objectContaining({ reason: 'clock_run_changed' }),
    ]);
  });

  it('records a write failure as a gap with the lost count', async () => {
    const harness = createRecorder();
    await harness.recorder.start({
      id: 'exec-1',
      startedAtReal: Date.now(),
      startedAtOperating: 1_000_000,
    });
    harness.failWrites(true);
    harness.setOperating(1_000_500);
    harness.recorder.capture('telemetry', 'PMS02', null, { timestamp: 30 });
    await harness.recorder.flush();
    const update = harness.sessionUpdates.at(-1)!;
    expect(update.droppedCount).toBe('1');
    expect(update.lastError).toBe('disk full');
    expect(lastGaps(harness.sessionUpdates)).toEqual([
      expect.objectContaining({
        reason: 'write_failed',
        count: 1,
        from_operating: 1_000_500,
      }),
    ]);
  });

  it('writes everything queued before closing the session, so counts match', async () => {
    const harness = createRecorder();
    await harness.recorder.start({
      id: 'exec-1',
      startedAtReal: Date.now(),
      startedAtOperating: 1_000_000,
    });
    for (let index = 0; index < 5; index += 1) {
      harness.setOperating(1_000_000 + index * 100);
      harness.recorder.capture('telemetry', 'PMS03', null, {
        timestamp: 100 + index,
      });
    }
    await harness.recorder.stop('exec-1', {
      real: Date.now(),
      operating: 1_001_000,
    });
    const final = harness.sessionUpdates.at(-1)!;
    expect(Number(final.frameCount)).toBe(harness.inserted.length);
    expect(harness.recorder.activeExecutionId()).toBeNull();
  });
});
