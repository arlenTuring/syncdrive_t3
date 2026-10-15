import { MqttController, withDerivedLocation } from './mqtt.controller';

describe('MqttController', () => {
  it('does not sync operation orders from telemetry (operation/update only)', async () => {
    const redisService = {
      setTelemetry: jest.fn().mockResolvedValue(true),
    };
    const eventsGateway = {
      broadcastTelemetry: jest.fn(),
      broadcastMqttMessage: jest.fn(),
      broadcastVehicleState: jest.fn(),
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
      { capture: jest.fn() } as any,
      { capture: jest.fn() } as any,
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
    expect(mqttService.updateVehicleLivePosition).toHaveBeenCalledWith('PMS05', payload, expect.any(Number));
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
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(true) };
    const eventsGateway = {
      broadcastTelemetry: jest.fn(),
      broadcastMqttMessage: jest.fn(),
      broadcastVehicleState: jest.fn(),
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
      { capture: jest.fn() } as any,
      { capture: jest.fn() } as any,
    );
    const payload: Record<string, unknown> = { vehicle_code: 'PMS-05', trip_code: 'D1413' };
    const context = { getTopic: () => 'v1/vtms/PMS-05/telemetry/update' };

    await controller.handleTelemetry(payload, context as any);

    expect(redisService.setTelemetry).toHaveBeenCalledWith('PMS05', payload);
    expect(payload.vehicle_code).toBe('PMS05');
  });

  /* 場域設施走同一批 topic，代號不是車輛格式，不該被動到 */
  it('不是車輛代號的就原樣放行', async () => {
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(true) };
    const eventsGateway = {
      broadcastTelemetry: jest.fn(),
      broadcastMqttMessage: jest.fn(),
      broadcastVehicleState: jest.fn(),
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
      { capture: jest.fn() } as any,
      { capture: jest.fn() } as any,
    );
    const payload = { slot_id: 'M3' };
    const context = { getTopic: () => 'v1/vtms/PSD-T3-01/telemetry/update' };

    await controller.handleTelemetry(payload, context as any);

    expect(redisService.setTelemetry).toHaveBeenCalledWith('PSD-T3-01', payload);
  });

  it('keeps the payload as received for history, before the vehicle code is normalised in place', async () => {
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(true) };
    const mqttService = {
      acceptsVehicleInput: jest.fn().mockResolvedValue(true),
      updateVehicleLivePosition: jest.fn().mockResolvedValue({ persisted: true, dataAt: 1, receivedAt: 2, derivedLocation: { label: 'D1', kind: 'FACILITY', objectId: '139' } }),
      shouldPersistTelemetry: jest.fn().mockReturnValue(false),
    };
    const eventsGateway = { broadcastVehicleState: jest.fn(), broadcastTelemetry: jest.fn(), broadcastMqttMessage: jest.fn() };
    const history = { capture: jest.fn() };
    const controller = new MqttController(redisService as any, eventsGateway as any, mqttService as any, { enqueue: jest.fn() } as any, { capture: jest.fn() } as any, history as any);
    const payload: Record<string, unknown> = { vehicle_code: 'PMS-05', timestamp: 1 };
    await controller.handleTelemetry(payload, { getTopic: () => 'v1/vtms/PMS-05/telemetry/update' } as any);
    // 即時流程照常正規化，但歷史存的是收到的原樣，衍生的位置標籤另外放
    expect(payload.vehicle_code).toBe('PMS05');
    const [stream, input] = history.capture.mock.calls[0];
    expect(stream).toBe('telemetry');
    expect(input.payload).toEqual({ vehicle_code: 'PMS-05', timestamp: 1 });
    expect(input.derived).toEqual({ location: { label: 'D1', kind: 'FACILITY', objectId: '139' } });
  });

  it('still records a message the live view rejected as stale, flagged so replay does not apply it', async () => {
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(false) };
    const mqttService = { acceptsVehicleInput: jest.fn().mockResolvedValue(true) };
    const history = { capture: jest.fn() };
    const controller = new MqttController(redisService as any, {} as any, mqttService as any, {} as any, { capture: jest.fn() } as any, history as any);
    await controller.handleTelemetry({ vehicle_code: 'PMS01', timestamp: 1 }, { getTopic: () => 'v1/vtms/PMS01/telemetry/update' } as any);
    expect(history.capture.mock.calls[0][1].derived).toEqual({ rejected: 'stale_or_duplicate' });
  });

  it('sends the browser a copy carrying the backend location of this very message, leaving the stored raw payload alone', async () => {
    const redisService = { setTelemetry: jest.fn().mockResolvedValue(true) };
    const mqttService = {
      acceptsVehicleInput: jest.fn().mockResolvedValue(true),
      updateVehicleLivePosition: jest.fn().mockResolvedValue({ persisted: true, dataAt: 1, receivedAt: 2, derivedLocation: { label: 'D1', kind: 'FACILITY', objectId: '132' } }),
      shouldPersistTelemetry: jest.fn().mockReturnValue(false),
    };
    const eventsGateway = { broadcastVehicleState: jest.fn(), broadcastTelemetry: jest.fn(), broadcastMqttMessage: jest.fn() };
    const controller = new MqttController(redisService as any, eventsGateway as any, mqttService as any, { enqueue: jest.fn() } as any, { capture: jest.fn() } as any, { capture: jest.fn() } as any);
    // 車端自己帶了歸屬欄位：不採用
    const payload: Record<string, unknown> = { vehicle_code: 'PMS03', timestamp: 1, location_kind: 'FACILITY', segment_label: 'E9' };
    await controller.handleTelemetry(payload, { getTopic: () => 'v1/vtms/PMS03/telemetry/update' } as any);
    const sent = eventsGateway.broadcastMqttMessage.mock.calls[0][1];
    expect(sent).toMatchObject({ segment_label: 'D1', location_kind: 'FACILITY', location_object_id: '132' });
    expect(eventsGateway.broadcastTelemetry.mock.calls[0][1]).toEqual(sent);
    // 原始內容沒有被改寫（Redis 與資料庫寫的是這一份）
    expect(payload.segment_label).toBe('E9');
    expect(redisService.setTelemetry.mock.calls[0][1]).toBe(payload);
  });

  it('drops location fields the vehicle sent when the backend could not locate the message', () => {
    const copy = withDerivedLocation({ x: 1, location_kind: 'FACILITY', segment_label: 'D1', location_object_id: '1' }, undefined);
    expect(copy).toEqual({ x: 1 });
  });
});
