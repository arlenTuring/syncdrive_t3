import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OperationOrder,
  OrderStatus,
} from '../database/entities/operation-order.entity';
import { OrderActionState } from '../database/entities/order-action-state.entity';
import { OrderEvent } from '../database/entities/order-event.entity';
import { OrderMqttPublisher } from './order-mqtt.publisher';
import { OrderRouteService } from './order-route.service';
import { OrderService } from './order.service';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';

const invalidationMock = { emit: jest.fn(), emitOrderLifecycle: jest.fn(), emitEventCenter: jest.fn(), emitMaintenanceSlots: jest.fn() };

describe('OrderService 狀態機 (VALID_TRANSITIONS)', () => {
  let service: OrderService;
  let orderRepo: { findOne: jest.Mock; save: jest.Mock };

  const makeOrder = (status: OrderStatus): OperationOrder =>
    ({ id: '260624-U1030', vehicleCode: 'PMS-05', status, payload: {} } as OperationOrder);

  beforeEach(async () => {
    orderRepo = {
      findOne: jest.fn(),
      save: jest.fn((o) => Promise.resolve(o)),
    };
    const noop = {} as never;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getRepositoryToken(OperationOrder), useValue: orderRepo },
        { provide: getRepositoryToken(OrderActionState), useValue: noop },
        { provide: getRepositoryToken(OrderEvent), useValue: noop },
        { provide: OrderMqttPublisher, useValue: noop },
        { provide: OrderRouteService, useValue: noop },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
      ],
    }).compile();
    service = module.get(OrderService);
  });

  it('允許 PENDING → PROCESSING', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
    const result = await service.updateOrderStatus('260624-U1030', 'processing');
    expect(result.status).toBe(OrderStatus.PROCESSING);
  });

  it('允許 PROCESSING → END 並寫入 completedAt', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
    const result = await service.updateOrderStatus('260624-U1030', 'end');
    expect(result.status).toBe(OrderStatus.END);
    expect(result.completedAt).toBeTruthy();
  });

  it('允許 FAULTED → PROCESSING（人工復歸）', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.FAULTED));
    const result = await service.updateOrderStatus('260624-U1030', 'processing');
    expect(result.status).toBe(OrderStatus.PROCESSING);
  });

  it('拒絕 PENDING → END（非法跳轉）', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
    await expect(service.updateOrderStatus('260624-U1030', 'end')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('拒絕從終態 END 再跳轉', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.END));
    await expect(service.updateOrderStatus('260624-U1030', 'processing')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('拒絕未知狀態字串', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
    await expect(service.updateOrderStatus('260624-U1030', 'flying')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('找不到訂單時拋 NotFound', async () => {
    orderRepo.findOne.mockResolvedValue(null);
    await expect(service.updateOrderStatus('nope', 'processing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('SSOT：中心端不臆造 vehicle_phase', () => {
    it('faultActiveOrderForVehicle 不寫入 vehicle_phase，只動 status', async () => {
      orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
      const result = await service.faultActiveOrderForVehicle('PMS-05', 'PATH_BLOCKED');
      expect(result?.status).toBe(OrderStatus.FAULTED);
      expect(result?.payload).not.toHaveProperty('vehicle_phase');
      expect(result?.payload).toMatchObject({ fault_reason: 'PATH_BLOCKED' });
    });

    it('recoverFaultedOrderForVehicle 不寫入 vehicle_phase，只動 status', async () => {
      orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.FAULTED));
      const result = await service.recoverFaultedOrderForVehicle('PMS-05');
      expect(result?.status).toBe(OrderStatus.PROCESSING);
      expect(result?.payload).not.toHaveProperty('vehicle_phase');
    });
  });
});
