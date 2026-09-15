import { VehicleLivenessService } from './vehicle-liveness.service';
import { VTMS_VEHICLE_CODES } from '../common/vehicle-codes';

function makeService(marks: Record<string, { receivedAt: number } | null>) {
  const broadcasts: Array<{ code: string; payload: any }> = [];
  const redis = {
    offlineAfterMs: 5_000,
    getLivenessMark: jest.fn(async (code: string) =>
      marks[code] ? { ...marks[code]!, timestamp: 'a' } : null,
    ),
    getHealth: jest.fn(async () => ({ overall_health: 'OK' })),
  };
  const events = {
    broadcastHealth: jest.fn((code: string, payload: any) =>
      broadcasts.push({ code, payload }),
    ),
  };
  const service = new VehicleLivenessService(redis as any, events as any);
  return { service, broadcasts, events };
}

describe('失聯巡檢', () => {
  const NOW = 100_000;
  const alive = { receivedAt: NOW - 1_000 };
  const stale = { receivedAt: NOW - 20_000 };

  it('全部在線時不推播', async () => {
    const marks = Object.fromEntries(VTMS_VEHICLE_CODES.map((c) => [c, alive]));
    const { service, broadcasts } = makeService(marks);

    const first = await service.sweep(NOW);
    expect(first.offline).toEqual([]);
    // 第一輪把「在線」記下來會推一次；之後沒變就不再推
    broadcasts.length = 0;
    const second = await service.sweep(NOW);
    expect(second.changed).toEqual([]);
    expect(broadcasts).toHaveLength(0);
  });

  it('心跳停了就判失聯並推播一次', async () => {
    const marks: Record<string, { receivedAt: number }> = Object.fromEntries(
      VTMS_VEHICLE_CODES.map((c) => [c, alive]),
    );
    const { service, broadcasts } = makeService(marks);
    await service.sweep(NOW);
    broadcasts.length = 0;

    marks.PMS03 = stale;
    const out = await service.sweep(NOW);

    expect(out.offline).toEqual(['PMS03']);
    expect(out.changed).toEqual(['PMS03']);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.code).toBe('PMS03');
    expect(broadcasts[0]!.payload.overall_health).toBe('OFFLINE');
    expect(broadcasts[0]!.payload.offline).toBe(true);

    // 持續失聯不重複推
    broadcasts.length = 0;
    const again = await service.sweep(NOW);
    expect(again.changed).toEqual([]);
    expect(broadcasts).toHaveLength(0);
  });

  it('恢復連線也推一次', async () => {
    const marks: Record<string, { receivedAt: number }> = Object.fromEntries(
      VTMS_VEHICLE_CODES.map((c) => [c, alive]),
    );
    marks.PMS05 = stale;
    const { service, broadcasts } = makeService(marks);
    await service.sweep(NOW);
    broadcasts.length = 0;

    marks.PMS05 = alive;
    const out = await service.sweep(NOW);
    expect(out.changed).toEqual(['PMS05']);
    expect(broadcasts[0]!.payload.overall_health).toBe('OK');
    expect(broadcasts[0]!.payload.offline).toBe(false);
  });

  it('啟動後從沒收過心跳的車不算「剛剛失聯」，不洗版', async () => {
    const marks = Object.fromEntries(VTMS_VEHICLE_CODES.map((c) => [c, null]));
    const { service, broadcasts } = makeService(marks as any);

    const out = await service.sweep(NOW);
    expect(out.offline).toEqual([...VTMS_VEHICLE_CODES]);
    expect(out.changed).toEqual([]);
    expect(broadcasts).toHaveLength(0);
  });
});
