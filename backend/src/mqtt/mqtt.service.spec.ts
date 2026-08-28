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

const invalidationMock = { emit: jest.fn(), emitOrderLifecycle: jest.fn(), emitEventCenter: jest.fn(), emitMaintenanceSlots: jest.fn() };
const redisServiceMock = { getTelemetry: jest.fn().mockResolvedValue(null) };
const mapServiceMock = {
  getActiveMapLibraryStatus: jest.fn().mockReturnValue({ activeMapId: 'map-test' }),
  findFacilityAtPoint: jest.fn().mockReturnValue(null),
};

describe('MqttService', () => {
  let service: MqttService;
  let orderServiceMock: { applyOperationMqttUpdate: jest.Mock };

  beforeEach(async () => {
    const repositoryMock = {
      create: jest.fn((value) => value),
      findOne: jest.fn(),
      insert: jest.fn(),
      save: jest.fn(),
    };
    orderServiceMock = {
      applyOperationMqttUpdate: jest.fn().mockResolvedValue({ id: '260624-D1401' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MqttService,
        { provide: getRepositoryToken(CommandLog), useValue: repositoryMock },
        { provide: getRepositoryToken(SecurityEventLog), useValue: repositoryMock },
        { provide: getRepositoryToken(TelemetryLog), useValue: repositoryMock },
        { provide: getRepositoryToken(SlotStatus_), useValue: repositoryMock },
        { provide: OrderService, useValue: orderServiceMock },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: RedisService, useValue: redisServiceMock },
        { provide: MapService, useValue: mapServiceMock },
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

    await service.syncOperationOrderFromLive('PMS-03', payload);

    expect(orderServiceMock.applyOperationMqttUpdate).toHaveBeenCalledWith(
      'PMS-03',
      expect.objectContaining({
        order_id: '260624-D1401',
        trip_code: 'D1401',
      }),
    );
  });

  describe('enrichWithFacilityLocation：yard_slot_id 改由座標判定', () => {
    it('車端已帶 yard_slot_id 時不覆蓋', async () => {
      const payload = { yard_slot_id: 'H1', vehicle_phase: 'IDLE' };
      const result = await service.enrichWithFacilityLocation('PMS-01', payload);
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
      const result = await service.enrichWithFacilityLocation('PMS-01', payload);
      expect(result).toMatchObject({ yard_slot_id: 'H2' });
      expect(mapServiceMock.findFacilityAtPoint).toHaveBeenCalledWith('map-test', 52, 62);
    });

    it('座標沒有落在任何格位範圍內（正線軌道）時不補值', async () => {
      redisServiceMock.getTelemetry.mockResolvedValueOnce({
        local_pose: { position: { x: 500, y: 200 } },
      });
      mapServiceMock.findFacilityAtPoint.mockReturnValueOnce(null);
      const payload = { vehicle_phase: 'TRANSITING' };
      const result = await service.enrichWithFacilityLocation('PMS-01', payload);
      expect(result).not.toHaveProperty('yard_slot_id');
    });
  });
});
