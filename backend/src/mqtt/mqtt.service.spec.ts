import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommandLog } from '../database/entities/command-log.entity';
import { SecurityEventLog } from '../database/entities/security-event-log.entity';
import { SlotStatus_ } from '../database/entities/slot-status.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { OrderService } from '../order/order.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { RedisService } from '../redis/redis.service';
import { MapService } from '../map/map.service';
import { MqttService } from './mqtt.service';
import { DataSource } from 'typeorm';

const invalidationMock = {
  emit: jest.fn(),
  emitOrderLifecycle: jest.fn(),
  emitEventCenter: jest.fn(),
  emitMaintenanceSlots: jest.fn(),
  emitVehiclePosition: jest.fn(),
};
const redisServiceMock = { getTelemetry: jest.fn().mockResolvedValue(null) };
const mapServiceMock = {
  getActiveMapLibraryStatus: jest.fn().mockReturnValue({ activeMapId: 'map-test' }),
  findFacilityAtPoint: jest.fn().mockReturnValue(null),
  findVehicleLocationAtPoint: jest.fn().mockReturnValue(null),
};
const dataSourceMock = { query: jest.fn().mockResolvedValue([]) };

describe('MqttService', () => {
  let service: MqttService;
  let orderServiceMock: { applyOperationMqttUpdateWithOutcome: jest.Mock; markVehicleFaultOnActiveOrder: jest.Mock };
  let securityRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    const repositoryMock = {
      create: jest.fn((value) => value),
      findOne: jest.fn(),
      insert: jest.fn(),
      save: jest.fn(),
    };
    orderServiceMock = {
      applyOperationMqttUpdateWithOutcome: jest.fn().mockResolvedValue({
        order: { id: '260624-D1401', status: 'PROCESSING' },
        outcome: 'progress_applied',
      }),
      markVehicleFaultOnActiveOrder: jest.fn().mockResolvedValue(null),
    };
    securityRepo = { create: jest.fn((v) => v), save: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MqttService,
        { provide: getRepositoryToken(CommandLog), useValue: repositoryMock },
        { provide: getRepositoryToken(SecurityEventLog), useValue: securityRepo },
        { provide: getRepositoryToken(TelemetryLog), useValue: repositoryMock },
        { provide: getRepositoryToken(SlotStatus_), useValue: repositoryMock },
        { provide: OrderService, useValue: orderServiceMock },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: RedisService, useValue: redisServiceMock },
        { provide: MapService, useValue: mapServiceMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();

    service = module.get<MqttService>(MqttService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('delegates operation/update to OrderService incremental sync', async () => {
    const payload = {
      timestamp: new Date('2026-06-24T14:01:30+08:00').getTime(),
      order_id: '260624-D1401',
      trip_code: 'D1401',
      current_leg: {
        target_station_id: 'station_3',
        distance_to_target_m: 120,
        eta_seconds: 42,
      },
      task_group: [{ task_id: '260624-D1401_RT-DOWN-T3-DOCK', task_name: 'PLATFORM_DOCKING', status: 'IN_PROGRESS' }],
    };

    await service.syncOperationOrderFromLive('PMS03', payload);

    expect(orderServiceMock.applyOperationMqttUpdateWithOutcome).toHaveBeenCalledWith(
      'PMS03',
      expect.objectContaining({
        order_id: '260624-D1401',
        trip_code: 'D1401',
      }),
    );
    expect(invalidationMock.emitOrderLifecycle).toHaveBeenCalledWith('PMS03');
  });

  it('沒有 order_id：不從 trip_code／badge_label 拼單號，也不呼叫訂單更新', async () => {
    for (const trip of ['D1401', 'NT1401']) {
      await service.syncOperationOrderFromLive('PMS03', {
        trip_code: trip,
        badge_label: trip,
        order_status: 'PROCESSING',
        timestamp: Date.now(),
      });
    }
    expect(orderServiceMock.applyOperationMqttUpdateWithOutcome).not.toHaveBeenCalled();
  });

  it('D1401 與 NT1401 同樣只靠 order_id 送進訂單更新', async () => {
    for (const trip of ['D1401', 'NT1401']) {
      await service.syncOperationOrderFromLive(`PMS0${trip.length}`, {
        order_id: `ORD-${trip}`,
        trip_code: trip,
        timestamp: Date.now(),
      });
    }
    expect(orderServiceMock.applyOperationMqttUpdateWithOutcome.mock.calls.map((c) => c[1].order_id))
      .toEqual(['ORD-D1401', 'ORD-NT1401']);
  });

  describe('嚴重事件：告警照常，訂單只標故障待結案', () => {
    const event = (severity: string) => ({
      event_id: 'EVT-20261005-0001', event_code: 'PATH_BLOCKED', severity, detail: '路徑受阻', timestamp: 1,
    });

    it('CRITICAL：寫入告警、通知事件中心，訂單標「車輛故障，結案待確認」（不結案）', async () => {
      await service.handleEventReport('PMS03', event('CRITICAL'));
      expect(securityRepo.save).toHaveBeenCalledWith(expect.objectContaining({ vehicleCode: 'PMS03', eventCode: 'PATH_BLOCKED' }));
      expect(invalidationMock.emitEventCenter).toHaveBeenCalled();
      expect(orderServiceMock.markVehicleFaultOnActiveOrder).toHaveBeenCalledWith('PMS03', 'PATH_BLOCKED');
    });

    it('WARNING：只寫告警，不動訂單', async () => {
      await service.handleEventReport('PMS03', event('WARNING'));
      expect(securityRepo.save).toHaveBeenCalled();
      expect(orderServiceMock.markVehicleFaultOnActiveOrder).not.toHaveBeenCalled();
    });

    it('event_id 不符協議格式：丟棄（模擬器已改成 EVT-YYYYMMDD-NNNN）', async () => {
      await service.handleEventReport('PMS03', { ...event('CRITICAL'), event_id: 'EVT-1791140000000-ab12cd' });
      expect(securityRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('enrichWithFacilityLocation：yard_slot_id 改由座標判定', () => {
    it('車端已帶 yard_slot_id 時不覆蓋', async () => {
      const payload = { yard_slot_id: 'H1', vehicle_phase: 'IDLE' };
      const result = await service.enrichWithFacilityLocation('PMS01', payload);
      expect(result).toBe(payload);
      expect(redisServiceMock.getTelemetry).not.toHaveBeenCalled();
    });

    it('沒有 yard_slot_id 時，用最近一次 telemetry 座標比對格位', async () => {
      redisServiceMock.getTelemetry.mockResolvedValueOnce({
        local_pose: { position: { x: 52, y: 62 } },
      });
      mapServiceMock.findFacilityAtPoint.mockReturnValueOnce({
        mapCode: 'H2',
        equipmentId: '195',
        equipmentKind: 'yard_slot',
      });
      const payload = { vehicle_phase: 'IDLE' };
      const result = await service.enrichWithFacilityLocation('PMS01', payload);
      expect(result).toMatchObject({ yard_slot_id: 'H2' });
      expect(mapServiceMock.findFacilityAtPoint).toHaveBeenCalledWith('map-test', 52, 62);
    });

    it('座標沒有落在任何格位範圍內（正線軌道）時不補值', async () => {
      redisServiceMock.getTelemetry.mockResolvedValueOnce({
        local_pose: { position: { x: 500, y: 200 } },
      });
      mapServiceMock.findFacilityAtPoint.mockReturnValueOnce(null);
      const payload = { vehicle_phase: 'TRANSITING' };
      const result = await service.enrichWithFacilityLocation('PMS01', payload);
      expect(result).not.toHaveProperty('yard_slot_id');
    });
  });

  it('每筆 telemetry 將後端判定的位置寫入車輛快照', async () => {
    mapServiceMock.findVehicleLocationAtPoint.mockReturnValueOnce({
      kind: 'TRACK', label: 'D03', objectId: 'track-d03',
    });
    await service.updateVehicleLivePosition('PMS03', {
      timestamp: 123,
      local_pose: { position: { x: -820, y: -2 } },
      kinematics: { velocity: 5 },
      energy: { battery_level: 83 },
    });
    expect(dataSourceMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO vehicle_monitor_demo'),
      ['PMS03', 'D03', 'TRACK', 'track-d03', -820, -2, 123, 18, 83],
    );
    expect(invalidationMock.emitVehiclePosition).toHaveBeenCalledWith('PMS03');
  });

  it('位置分類帶上車速：開著的車座標落進設施矩形（M1 被支線穿過）不算在設施裡', async () => {
    await service.updateVehicleLivePosition('PMS03', {
      timestamp: 123,
      local_pose: { position: { x: -882, y: -281 } },
      kinematics: { velocity: 5 },
    });
    expect(mapServiceMock.findVehicleLocationAtPoint).toHaveBeenCalledWith(
      expect.any(String),
      -882,
      -281,
      { speedMps: 5 },
    );
  });
});
