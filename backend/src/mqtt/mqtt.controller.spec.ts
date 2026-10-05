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
      updateVehicleLivePosition: jest.fn().mockResolvedValue(undefined),
      shouldPersistTelemetry: jest.fn().mockReturnValue(false),
      syncOperationOrderFromLive: jest.fn().mockResolvedValue(undefined),
      // 控制器現在先問是否暫停接收（資料管理的重置期間）；測試情境都是正常接收
      isLiveInputPaused: jest.fn().mockReturnValue(false),
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
      getTopic: () => 'v1/vtms/PMS05/telemetry/update',
    };

    await controller.handleTelemetry(payload, context as any);

    expect(redisService.setTelemetry).toHaveBeenCalledWith('PMS05', payload);
    expect(mqttService.updateVehicleLivePosition).toHaveBeenCalledWith('PMS05', payload);
    expect(mqttService.syncOperationOrderFromLive).not.toHaveBeenCalled();
    expect(telemetryWriteQueue.enqueue).not.toHaveBeenCalled();
    expect(eventsGateway.broadcastTelemetry).toHaveBeenCalledWith('PMS05', payload);
  });

  /*
   * 改名不是所有發布端同一秒切換：車端、模擬器、broker 上既存的 retain 訊息會有一段
   * 混用期。舊寫法若原樣落進資料庫，就會生出一批對不上車隊清單的孤兒列，而且不會
   * 報錯，只是查不到。
   */
  it('把舊寫法 PMS-05 的 topic 與 payload 一起收成 PMS05', async () => {
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(undefined) };
    const eventsGateway = {
      broadcastTelemetry: jest.fn(),
      broadcastMqttMessage: jest.fn(),
    };
    const mqttService = {
      updateVehicleLivePosition: jest.fn().mockResolvedValue(undefined),
      shouldPersistTelemetry: jest.fn().mockReturnValue(false),
      syncOperationOrderFromLive: jest.fn().mockResolvedValue(undefined),
      // 控制器現在先問是否暫停接收（資料管理的重置期間）；測試情境都是正常接收
      isLiveInputPaused: jest.fn().mockReturnValue(false),
    };
    const telemetryWriteQueue = { enqueue: jest.fn() };
    const controller = new MqttController(
      redisService as any,
      eventsGateway as any,
      mqttService as any,
      telemetryWriteQueue as any,
    );
    const payload: Record<string, unknown> = { vehicle_code: 'PMS-05', trip_code: 'D1413' };
    const context = { getTopic: () => 'v1/vtms/PMS-05/telemetry/update' };

    await controller.handleTelemetry(payload, context as any);

    expect(redisService.setTelemetry).toHaveBeenCalledWith('PMS05', payload);
    expect(payload.vehicle_code).toBe('PMS05');
  });

  /* 場域設施走同一批 topic，代號不是車輛格式，不該被動到 */
  it('不是車輛代號的就原樣放行', async () => {
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(undefined) };
    const eventsGateway = {
      broadcastTelemetry: jest.fn(),
      broadcastMqttMessage: jest.fn(),
    };
    const mqttService = {
      updateVehicleLivePosition: jest.fn().mockResolvedValue(undefined),
      shouldPersistTelemetry: jest.fn().mockReturnValue(true),
      syncOperationOrderFromLive: jest.fn().mockResolvedValue(undefined),
      // 控制器現在先問是否暫停接收（資料管理的重置期間）；測試情境都是正常接收
      isLiveInputPaused: jest.fn().mockReturnValue(false),
    };
    const telemetryWriteQueue = { enqueue: jest.fn() };
    const controller = new MqttController(
      redisService as any,
      eventsGateway as any,
      mqttService as any,
      telemetryWriteQueue as any,
    );
    const payload = { slot_id: 'M3' };
    const context = { getTopic: () => 'v1/vtms/PSD-T3-01/telemetry/update' };

    await controller.handleTelemetry(payload, context as any);

    expect(redisService.setTelemetry).toHaveBeenCalledWith('PSD-T3-01', payload);
  });
});
