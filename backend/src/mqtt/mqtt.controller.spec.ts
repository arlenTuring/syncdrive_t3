import { MqttController } from './mqtt.controller';

describe('MqttController', () => {
  it('does not sync operation orders from telemetry (operation/update only)', async () => {
    const redisService = {
      setTelemetry: jest.fn().mockResolvedValue(undefined),
    };
    const eventsGateway = {
      broadcastTelemetry: jest.fn(),
      broadcastMqttMessage: jest.fn(),
    };
    const mqttService = {
      shouldPersistTelemetry: jest.fn().mockReturnValue(false),
      syncOperationOrderFromLive: jest.fn().mockResolvedValue(undefined),
    };
    const telemetryWriteQueue = {
      enqueue: jest.fn(),
    };
    const controller = new MqttController(
      redisService as any,
      eventsGateway as any,
      mqttService as any,
      telemetryWriteQueue as any,
    );
    const payload = {
      line_kind: 'MAINLINE',
      order_status: 'PROCESSING',
      trip_code: 'D1413',
      route_progress: 25,
    };
    const context = {
      getTopic: () => 'v1/vtms/PMS-05/telemetry/update',
    };

    await controller.handleTelemetry(payload, context as any);

    expect(redisService.setTelemetry).toHaveBeenCalledWith('PMS-05', payload);
    expect(mqttService.syncOperationOrderFromLive).not.toHaveBeenCalled();
    expect(telemetryWriteQueue.enqueue).not.toHaveBeenCalled();
    expect(eventsGateway.broadcastTelemetry).toHaveBeenCalledWith('PMS-05', payload);
  });
});
