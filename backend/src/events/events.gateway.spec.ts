import { EventsGateway } from './events.gateway';

describe('EventsGateway vehicle realtime authorization', () => {
  it('only joins the vehicle realtime room with its view permission', async () => {
    const auth = { authenticate: jest.fn().mockResolvedValue({ user: { permissions: ['dashboard.monitor.view'] } }) };
    const gateway = new EventsGateway(auth as any);
    const client = { request: { headers: {} }, join: jest.fn(), disconnect: jest.fn() } as any;

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('live');
    expect(client.join).not.toHaveBeenCalledWith('vehicle-realtime');
  });

  it('broadcasts the consolidated state only to authorized viewers', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new EventsGateway({} as any);
    gateway.server = { to } as any;
    const payload = {
      vehicleCode: 'PMS01', stream: 'telemetry' as const, dataAt: 1, receivedAt: 2,
      persisted: true, payload: {},
    };

    gateway.broadcastVehicleState(payload);

    expect(to).toHaveBeenCalledWith('vehicle-realtime');
    expect(emit).toHaveBeenCalledWith('vehicle/state', payload);
  });
});
