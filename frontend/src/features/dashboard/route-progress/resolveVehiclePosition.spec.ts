import { describe, expect, it } from 'vitest';
import { readMqttRouteProgress } from './resolveVehiclePosition';

describe('readMqttRouteProgress', () => {
  it('uses the center-calculated leg maximum when the vehicle only reports ETA', () => {
    const stations = [
      { id: 'a', stationId: 'a', name: 'A', value: 0 },
      { id: 'b', stationId: 'b', name: 'B', value: 50 },
      { id: 'c', stationId: 'c', name: 'C', value: 100 },
    ];
    expect(readMqttRouteProgress({
      current_leg: { target_station_id: 'b', eta_seconds: 30 },
      leg_eta_max: '{"b":60}',
    }, stations)).toBe(25);
  });
});
