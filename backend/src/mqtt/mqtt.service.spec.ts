import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommandLog } from '../database/entities/command-log.entity';
import { SecurityEventLog } from '../database/entities/security-event-log.entity';
import { SlotStatus_ } from '../database/entities/slot-status.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { OrderService } from '../order/order.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { MqttService } from './mqtt.service';

const invalidationMock = { emit: jest.fn(), emitOrderLifecycle: jest.fn(), emitEventCenter: jest.fn(), emitMaintenanceSlots: jest.fn() };

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
        target_station_id: 'T3',
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
});
