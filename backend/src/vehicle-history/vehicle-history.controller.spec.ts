import { REQUIRE_PERMISSION } from '../access-control/access.guard';
import { VehicleHistoryController } from './vehicle-history.controller';

describe('VehicleHistoryController', () => {
  it('protects every investigation API with the run-history permission only (not degraded operation)', () => {
    const own = Reflect.getMetadata(REQUIRE_PERMISSION, VehicleHistoryController) as string[];
    expect(own).toEqual(['vehicle.log.view']);
    const handlers = Object.getOwnPropertyNames(VehicleHistoryController.prototype).filter((name) => name !== 'constructor');
    expect(handlers.sort()).toEqual(['frames', 'map', 'neighbor', 'resolveRange', 'resolveShift', 'snapshot', 'vehicleEvents', 'vehicles']);
    for (const name of handlers) {
      // 沒有任何 handler 另外放寬（例如 PublicEndpoint 會設成空陣列）
      const override = Reflect.getMetadata(REQUIRE_PERMISSION, (VehicleHistoryController.prototype as unknown as Record<string, object>)[name]);
      expect(override).toBeUndefined();
    }
  });

  it('passes the stable vehicle id and scope through to every investigation query', async () => {
    const history = {
      resolveRange: jest.fn(),
      resolveShift: jest.fn(),
      snapshot: jest.fn(),
      frames: jest.fn(),
      neighbor: jest.fn(),
      vehicleEvents: jest.fn(),
    };
    const controller = new VehicleHistoryController(history as never);
    const id = '11111111-1111-4111-8111-111111111111';
    controller.resolveRange(id, 'f', 't');
    controller.resolveShift('C@1791000000000', id);
    controller.snapshot(id, '1', '2', 'background');
    controller.frames(id, '1', '2', undefined, undefined, undefined, 'vehicle');
    controller.neighbor(id, '1', '2', 'next');
    controller.vehicleEvents(id, '1', '2');
    expect(history.resolveRange.mock.calls[0][0]).toMatchObject({ vehicle_id: id });
    expect(history.resolveShift).toHaveBeenCalledWith('C@1791000000000', id);
    expect(history.snapshot.mock.calls[0][0]).toMatchObject({ vehicle_id: id, scope: 'background' });
    expect(history.frames.mock.calls[0][0]).toMatchObject({ vehicle_id: id, scope: 'vehicle' });
    expect(history.neighbor.mock.calls[0][0]).toMatchObject({ vehicle_id: id });
    expect(history.vehicleEvents.mock.calls[0][0]).toMatchObject({ vehicle_id: id });
  });
});
