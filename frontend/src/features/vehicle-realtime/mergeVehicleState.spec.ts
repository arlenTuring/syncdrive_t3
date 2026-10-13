import { describe, expect, it } from 'vitest';
import { mergeBufferedEnvelopes, mergeVehicleEnvelope, resolveConnectionStatus } from './mergeVehicleState';
import type { VehicleRealtimeItem, VehicleStateEnvelope } from './types';

const base = (): VehicleRealtimeItem => ({
  id: '1', vehicleCode: 'PMS01', displayName: '一號車', connectionStatus: 'OFFLINE', mapId: 'map-1',
  location: null, speedKph: null, batteryLevel: null, gear: null,
  telemetry: null, operation: null, health: null, contractOrder: null,
});
const envelope = (stream: VehicleStateEnvelope['stream'], dataAt: number, receivedAt: number, payload: Record<string, unknown> = {}): VehicleStateEnvelope =>
  ({ vehicleCode: 'PMS01', stream, dataAt, receivedAt, persisted: true, payload });

describe('vehicle realtime snapshot/live merge', () => {
  it('較晚回來的舊快照不覆蓋新串流', () => {
    const live = envelope('telemetry', 200, 220, { kinematics: { velocity: 2 } });
    const snapshot = { ...base(), telemetry: envelope('telemetry', 100, 110) };
    const merged = mergeBufferedEnvelopes(snapshot, { telemetry: live });
    expect(merged.telemetry?.dataAt).toBe(200);
    expect(merged.speedKph).toBe(7.2);
  });

  it('速度只由原始 m/s 轉換一次且合法零值保留', () => {
    const update = envelope('telemetry', 1, 2, {
      local_pose: { position: { x: 0, y: 0 }, heading: 0 },
      kinematics: { velocity: 0 }, energy: { battery_level: 0 }, actuation_feedback: { gear: 'N' },
    });
    update.derivedLocation = { label: 'D01', kind: 'FACILITY', objectId: '1' };
    const merged = mergeVehicleEnvelope(base(), update);
    expect(merged.speedKph).toBe(0);
    expect(merged.batteryLevel).toBe(0);
    expect(merged.location?.x).toBe(0);
    expect(merged.location?.label).toBe('D01');
  });

  it('Retain 重送的同時間舊 envelope 不造成回退或假在線', () => {
    const newer = mergeVehicleEnvelope(base(), envelope('health', 200, 250, { overall_health: 'OK' }));
    const unchanged = mergeVehicleEnvelope(newer, envelope('health', 200, 240, { overall_health: 'OK' }));
    expect(unchanged).toBe(newer);
    expect(resolveConnectionStatus(unchanged, 10_000, 5_000)).toBe('OFFLINE');
  });

  it('缺值不會被誤判成合法的 0', () => {
    const update = envelope('telemetry', 1, 2, {
      local_pose: { position: { x: null, y: '' } },
      kinematics: { velocity: null }, energy: { battery_level: '' }, actuation_feedback: { gear: 'X' },
    });
    const merged = mergeVehicleEnvelope(base(), update);
    expect(merged.speedKph).toBeNull();
    expect(merged.batteryLevel).toBeNull();
    expect(merged.gear).toBeNull();
    expect(merged.location).toBeNull();
  });
});
