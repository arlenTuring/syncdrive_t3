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
import { MapService } from '../map/map.service';

const invalidationMock = {
  emit: jest.fn(),
  emitOrderLifecycle: jest.fn(),
  emitEventCenter: jest.fn(),
  emitMaintenanceSlots: jest.fn(),
};

describe('OrderService 狀態機 (VALID_TRANSITIONS)', () => {
  let service: OrderService;
  let orderRepo: { findOne: jest.Mock; save: jest.Mock };

  const makeOrder = (status: OrderStatus): OperationOrder =>
    ({
      id: '260624-U1030',
      vehicleCode: 'PMS05',
      status,
      payload: {},
    }) as OperationOrder;

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
        { provide: MapService, useValue: noop },
      ],
    }).compile();
    service = module.get(OrderService);
  });

  it('允許未接單直接拒絕並容許重試相同狀態', async () => {
    const order = makeOrder(OrderStatus.PENDING);
    orderRepo.findOne.mockResolvedValue(order);
    expect((await service.updateOrderStatus(order.id, 'FAULTED')).status).toBe(OrderStatus.FAULTED);
    await service.updateOrderStatus(order.id, 'FAULTED');
    expect(orderRepo.save).toHaveBeenCalledTimes(1);
  });

  it('小寫狀態拒絕，PENDING 不能由進度端點寫回', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
    for (const value of ['processing', 'end', 'faulted', 'PENDING']) {
      await expect(service.updateOrderStatus('260624-U1030', value)).rejects.toMatchObject({
        response: { statusCode: 400, code: 'INVALID_ORDER_STATUS' },
      });
    }
  });

  it('只准授權車輛，拒絕其他車輛的既存訂單', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
    await expect(service.authorizeOrder('260624-U1030', ['PMS99'])).rejects.toMatchObject({
      response: { statusCode: 403, code: 'VEHICLE_NOT_AUTHORIZED' },
    });
    await expect(service.authorizeOrder('260624-U1030', ['PMS05'])).resolves.toHaveProperty('vehicleCode', 'PMS05');
  });

  it('允許 PENDING → PROCESSING', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
    const result = await service.updateOrderStatus(
      '260624-U1030',
      'PROCESSING',
    );
    expect(result.status).toBe(OrderStatus.PROCESSING);
  });

  it('允許 PROCESSING → END 並寫入 completedAt', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
    const result = await service.updateOrderStatus('260624-U1030', 'END');
    expect(result.status).toBe(OrderStatus.END);
    expect(result.completedAt).toBeTruthy();
  });

  it('允許 FAULTED → PROCESSING（人工復歸）', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.FAULTED));
    const result = await service.updateOrderStatus(
      '260624-U1030',
      'PROCESSING',
    );
    expect(result.status).toBe(OrderStatus.PROCESSING);
  });

  it('拒絕 PENDING → END（非法跳轉）', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
    await expect(
      service.updateOrderStatus('260624-U1030', 'END'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('拒絕從終態 END 再跳轉', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.END));
    await expect(
      service.updateOrderStatus('260624-U1030', 'PROCESSING'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('拒絕未知狀態字串', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
    await expect(
      service.updateOrderStatus('260624-U1030', 'flying'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('找不到訂單時拋 NotFound', async () => {
    orderRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateOrderStatus('nope', 'PROCESSING'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('缺少 id 時乾淨回 400，不查表（避免 where:{id:undefined} 誤配任意一筆）', async () => {
    await expect(service.getOrderById('')).rejects.toBeInstanceOf(BadRequestException);
    expect(orderRepo.findOne).not.toHaveBeenCalled();
  });

  it('缺少 status 時乾淨回 400，而不是 statusStr.toUpperCase() 丟未預期的 TypeError', async () => {
    orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
    await expect(
      service.updateOrderStatus('260624-U1030', ''),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateOrderStatus('260624-U1030', undefined as unknown as string),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('SSOT：中心端不臆造 vehicle_phase', () => {
    it('faultActiveOrderForVehicle 不寫入 vehicle_phase，只動 status', async () => {
      orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
      const result = await service.faultActiveOrderForVehicle(
        'PMS05',
        'PATH_BLOCKED',
      );
      expect(result?.status).toBe(OrderStatus.FAULTED);
      expect(result?.payload).not.toHaveProperty('vehicle_phase');
      expect(result?.payload).toMatchObject({ fault_reason: 'PATH_BLOCKED' });
    });

    it('recoverFaultedOrderForVehicle 不寫入 vehicle_phase，只動 status', async () => {
      orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.FAULTED));
      const result = await service.recoverFaultedOrderForVehicle('PMS05');
      expect(result?.status).toBe(OrderStatus.PROCESSING);
      expect(result?.payload).not.toHaveProperty('vehicle_phase');
    });
  });

  describe('requestCancel：中心端主動取消', () => {
    let cancelService: OrderService;
    let cancelOrderRepo: { findOne: jest.Mock; save: jest.Mock };
    let publisherMock: { publishAssign: jest.Mock; publishCancel: jest.Mock };

    beforeEach(async () => {
      cancelOrderRepo = {
        findOne: jest.fn(),
        save: jest.fn((o) => Promise.resolve(o)),
      };
      publisherMock = { publishAssign: jest.fn(), publishCancel: jest.fn() };
      const noop = {} as never;
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OrderService,
          { provide: getRepositoryToken(OperationOrder), useValue: cancelOrderRepo },
          { provide: getRepositoryToken(OrderActionState), useValue: noop },
          { provide: getRepositoryToken(OrderEvent), useValue: noop },
          { provide: OrderMqttPublisher, useValue: publisherMock },
          { provide: OrderRouteService, useValue: noop },
          { provide: DatasourceInvalidationService, useValue: invalidationMock },
          { provide: MapService, useValue: noop },
        ],
      }).compile();
      cancelService = module.get(OrderService);
    });

    it('PENDING 可取消：寫入 cancel_requested_at 並發布 MQTT operation/cancel', async () => {
      cancelOrderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PENDING));
      const result = await cancelService.requestCancel('260624-U1030');
      expect(result.payload).toHaveProperty('cancel_requested_at');
      expect(publisherMock.publishCancel).toHaveBeenCalledWith('PMS05', '260624-U1030');
    });

    it('PROCESSING 可取消', async () => {
      cancelOrderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
      const result = await cancelService.requestCancel('260624-U1030');
      expect(result.payload).toHaveProperty('cancel_requested_at');
      expect(publisherMock.publishCancel).toHaveBeenCalledTimes(1);
    });

    it('END／FAULTED 已是終態，拒絕取消', async () => {
      cancelOrderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.END));
      await expect(cancelService.requestCancel('260624-U1030')).rejects.toMatchObject({
        response: { statusCode: 400, code: 'ORDER_ALREADY_CLOSED' },
      });
      cancelOrderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.FAULTED));
      await expect(cancelService.requestCancel('260624-U1030')).rejects.toMatchObject({
        response: { statusCode: 400, code: 'ORDER_ALREADY_CLOSED' },
      });
      expect(publisherMock.publishCancel).not.toHaveBeenCalled();
    });

    it('重複取消同一張單：冪等回傳，不重發 MQTT', async () => {
      const order = makeOrder(OrderStatus.PROCESSING);
      order.payload = { cancel_requested_at: 1700000000000 };
      cancelOrderRepo.findOne.mockResolvedValue(order);
      const result = await cancelService.requestCancel('260624-U1030');
      expect(result.payload).toMatchObject({ cancel_requested_at: 1700000000000 });
      expect(publisherMock.publishCancel).not.toHaveBeenCalled();
      expect(cancelOrderRepo.save).not.toHaveBeenCalled();
    });

    it('找不到訂單時拋 NotFound', async () => {
      cancelOrderRepo.findOne.mockResolvedValue(null);
      await expect(cancelService.requestCancel('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('applyOperationMqttUpdate：車端回報不得吃掉中心端的任務內容', () => {
  let service: OrderService;
  let orderRepo: { findOne: jest.Mock; save: jest.Mock };

  /** 調度引擎下單時寫進去的任務內容 */
  const dispatchPayload = {
    source: 'dispatch_engine',
    kind: 'passenger',
    shift_name: '模擬正線',
    origin: { id: 'station_2', name: 'N2W下行出發', kind: 'station' },
    destination: { id: 'station_5', name: 'S2W下行停靠', kind: 'station' },
    stations: [
      { order: 1, station_id: 'station_2' },
      { order: 2, station_id: 'station_5' },
    ],
  };

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
        {
          provide: OrderRouteService,
          useValue: {
            // 新格式的班次代號對不到舊的 D/U 路線表，回 null 才是實際情況
            routeIdForTripCode: () => null,
            computeRouteProgress: () => Promise.resolve(0),
            computeNextStation: () => Promise.resolve(null),
          },
        },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: noop },
      ],
    }).compile();
    service = module.get(OrderService);
  });

  function existingOrder(): OperationOrder {
    return {
      id: '260826-NT1403',
      vehicleCode: 'PMS07',
      tripCode: 'NT1403',
      lineKind: 'MAINLINE',
      status: OrderStatus.PROCESSING,
      plannedStart: '1787724000000',
      plannedEnd: '1787724210000',
      payload: { ...dispatchPayload },
    } as OperationOrder;
  }

  it('進度回報後，起訖點與站序仍在', async () => {
    const order = existingOrder();
    orderRepo.findOne.mockResolvedValue(order);

    await service.applyOperationMqttUpdate('PMS07', {
      vehicle_code: 'PMS07',
      order_id: '260826-NT1403',
      trip_code: 'NT1403',
      line_kind: 'MAINLINE',
      order_status: 'PROCESSING',
      vehicle_phase: 'RUNNING',
      timestamp: 1787724100000,
    });

    const calls = orderRepo.save.mock.calls as Array<[OperationOrder]>;
    const saved = calls[calls.length - 1][0];
    const payload = saved.payload as Record<string, unknown>;
    expect(payload.origin).toEqual(dispatchPayload.origin);
    expect(payload.destination).toEqual(dispatchPayload.destination);
    expect(payload.stations).toHaveLength(2);
    expect(payload.shift_name).toBe('模擬正線');
    // 進度欄位仍然要更新
    expect(payload.vehicle_phase).toBe('RUNNING');
  });

  it('已有計畫時刻時，車端回報不覆蓋', async () => {
    const order = existingOrder();
    orderRepo.findOne.mockResolvedValue(order);

    await service.applyOperationMqttUpdate('PMS07', {
      vehicle_code: 'PMS07',
      order_id: '260826-NT1403',
      trip_code: 'NT1403',
      line_kind: 'MAINLINE',
      order_status: 'PROCESSING',
      timestamp: 1787724100000,
    });

    const calls = orderRepo.save.mock.calls as Array<[OperationOrder]>;
    const saved = calls[calls.length - 1][0];
    expect(saved.plannedStart).toBe('1787724000000');
    expect(saved.plannedEnd).toBe('1787724210000');
  });

  it('沒有計畫時刻時才用班次代號推測', async () => {
    const order = existingOrder();
    order.plannedStart = undefined;
    order.plannedEnd = undefined;
    orderRepo.findOne.mockResolvedValue(order);

    await service.applyOperationMqttUpdate('PMS07', {
      vehicle_code: 'PMS07',
      order_id: '260826-NT1403',
      trip_code: 'NT1403',
      line_kind: 'MAINLINE',
      order_status: 'PROCESSING',
      timestamp: 1787724100000,
    });

    const calls = orderRepo.save.mock.calls as Array<[OperationOrder]>;
    const saved = calls[calls.length - 1][0];
    expect(saved.plannedStart).toBe('1787724100000');
  });

  it('車端完全不送 line_kind/route_id/yard_slot_id 時，整備分類仍以訂單記錄為準', async () => {
    const order = existingOrder();
    order.lineKind = 'MAINTENANCE';
    order.routeId = undefined;
    orderRepo.findOne.mockResolvedValue(order);

    const saved = await service.applyOperationMqttUpdate('PMS07', {
      vehicle_code: 'PMS07',
      order_id: '260826-NT1403',
      trip_code: 'NT1403',
      order_status: 'PROCESSING',
      vehicle_phase: 'TRANSITING',
      timestamp: 1787724100000,
    });

    expect(saved?.lineKind).toBe('MAINTENANCE');
  });

  it('leg_eta_max 由訂單自己的站序計畫時刻推算，不需要車端回報', async () => {
    const order = existingOrder();
    order.payload = {
      ...dispatchPayload,
      stations: [
        { order: 1, station_id: 'station_2', depart_at: 1787724000000 },
        { order: 2, station_id: 'station_5', arrive_at: 1787724180000 },
      ],
    };
    orderRepo.findOne.mockResolvedValue(order);

    await service.applyOperationMqttUpdate('PMS07', {
      vehicle_code: 'PMS07',
      order_id: '260826-NT1403',
      trip_code: 'NT1403',
      order_status: 'PROCESSING',
      vehicle_phase: 'TRANSITING',
      current_leg: {
        target_station_id: 'station_5',
        distance_to_target_m: 100,
        eta_seconds: 90,
      },
      timestamp: 1787724100000,
    });

    const calls = orderRepo.save.mock.calls as Array<[OperationOrder]>;
    const saved = calls[calls.length - 1][0];
    const payload = saved.payload as Record<string, unknown>;
    const legEtaMax = payload.leg_eta_max as Record<string, number>;
    // (1787724180000 - 1787724000000) / 1000 = 180 秒，非車端回報的任何值
    expect(legEtaMax.station_5).toBe(180);
  });
});
