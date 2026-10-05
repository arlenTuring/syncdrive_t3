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

  it('開始執行記下實際發車時刻；故障復歸不覆寫', async () => {
    const order = makeOrder(OrderStatus.PENDING);
    orderRepo.findOne.mockResolvedValue(order);
    const started = await service.updateOrderStatus(order.id, 'PROCESSING');
    const firstStart = (started.payload as Record<string, unknown>).actual_started_at;
    expect(typeof firstStart).toBe('number');

    const faulted = { ...started, status: OrderStatus.FAULTED } as OperationOrder;
    orderRepo.findOne.mockResolvedValue(faulted);
    const recovered = await service.updateOrderStatus(order.id, 'PROCESSING');
    expect((recovered.payload as Record<string, unknown>).actual_started_at).toBe(firstStart);
  });

  it('結束時寫延誤分鐘：晚於計畫結束一分鐘以上才算延誤', async () => {
    const late = { ...makeOrder(OrderStatus.PROCESSING), plannedEnd: String(Date.now() - 150_000) } as OperationOrder;
    orderRepo.findOne.mockResolvedValue(late);
    expect((await service.updateOrderStatus(late.id, 'END')).delayMinutes).toBe(2);

    const onTime = { ...makeOrder(OrderStatus.PROCESSING), plannedEnd: String(Date.now() - 30_000) } as OperationOrder;
    orderRepo.findOne.mockResolvedValue(onTime);
    expect((await service.updateOrderStatus(onTime.id, 'END')).delayMinutes).toBe(0);
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
    it('CRITICAL 事件：訂單只標「車輛故障，結案待確認」，不改狀態、不寫 vehicle_phase', async () => {
      orderRepo.findOne.mockResolvedValue(makeOrder(OrderStatus.PROCESSING));
      const result = await service.markVehicleFaultOnActiveOrder(
        'PMS05',
        'PATH_BLOCKED',
      );
      expect(result?.status).toBe(OrderStatus.PROCESSING);
      expect(result?.completedAt).toBeFalsy();
      expect(result?.payload).not.toHaveProperty('vehicle_phase');
      expect(result?.payload).toMatchObject({ vehicle_fault: { reason: 'PATH_BLOCKED', source: 'event_report' } });
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

  it('沒有計畫時刻的舊單維持沒有，不拿班次代號或回報時間推', async () => {
    for (const tripCode of ['D1403', 'NT1403']) {
      const order = existingOrder();
      order.tripCode = tripCode;
      order.plannedStart = undefined;
      order.plannedEnd = undefined;
      orderRepo.findOne.mockResolvedValue(order);

      const saved = await service.applyOperationMqttUpdate('PMS07', {
        vehicle_code: 'PMS07',
        order_id: '260826-NT1403',
        trip_code: tripCode,
        order_status: 'PROCESSING',
        timestamp: 1787724100000,
      });
      expect(saved?.plannedStart).toBeUndefined();
      expect(saved?.plannedEnd).toBeUndefined();
    }
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

describe('OrderService.createOrder 模擬器重播單（不覆寫、重試不重發）', () => {
  let service: OrderService;
  const stored = new Map<string, OperationOrder>();
  const publishAssign = jest.fn(() => ({ topic: 't' }));
  const orderRepo = {
    create: jest.fn((o) => o),
    insert: jest.fn(async (o: OperationOrder) => {
      if (stored.has(o.id)) throw Object.assign(new Error('dup'), { code: '23505' });
      stored.set(o.id, o);
    }),
    save: jest.fn(async (o: OperationOrder) => o),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => stored.get(where.id) ?? null),
  };

  beforeEach(async () => {
    stored.clear();
    publishAssign.mockClear();
    orderRepo.save.mockClear();
    const noop = {} as never;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getRepositoryToken(OperationOrder), useValue: orderRepo },
        { provide: getRepositoryToken(OrderActionState), useValue: noop },
        { provide: getRepositoryToken(OrderEvent), useValue: noop },
        { provide: OrderMqttPublisher, useValue: { publishAssign } },
        { provide: OrderRouteService, useValue: {} },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: noop },
      ],
    }).compile();
    service = module.get(OrderService);
  });

  const body = (payload: Record<string, unknown> = {}) => ({
    order_id: 'SIM-PLAN-run1-MT-D3-R5-0',
    vehicle_code: 'PMS05',
    trip_code: 'MT-D3-R5-0',
    line_kind: 'MAINTENANCE',
    payload: { source: 'plan_replay', plan_run_id: 'run1', ...payload },
  });

  it('分類改成 MAINTENANCE 後仍是只新增，不用 save 覆寫', async () => {
    await service.createOrder(body());
    expect(orderRepo.insert).toHaveBeenCalled();
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(publishAssign).toHaveBeenCalledTimes(1);
  });

  it('同一輪同一任務重送：回傳原訂單，不再發 assign', async () => {
    await service.createOrder(body());
    const again = await service.createOrder(body());
    expect((again as OperationOrder & { duplicate?: boolean }).duplicate).toBe(true);
    expect(publishAssign).toHaveBeenCalledTimes(1);
  });

  it('同編號但不是同一輪：撞號報錯', async () => {
    await service.createOrder(body());
    await expect(service.createOrder(body({ plan_run_id: 'run2' }))).rejects.toThrow('內容不同');
  });
});

describe('OrderService.updateOrderStatus 中心端取消後', () => {
  let service: OrderService;
  const orderRepo = { findOne: jest.fn(), save: jest.fn((o) => Promise.resolve(o)) };
  beforeEach(async () => {
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
  const cancelled = (status: OrderStatus) =>
    ({ id: 'SIM-1', vehicleCode: 'PMS09', status, payload: { cancel_requested_at: 1 } }) as unknown as OperationOrder;

  it('已取消的單不能開始執行', async () => {
    orderRepo.findOne.mockResolvedValue(cancelled(OrderStatus.PENDING));
    await expect(service.updateOrderStatus('SIM-1', 'PROCESSING')).rejects.toMatchObject({ response: { code: 'ORDER_CANCELLED' } });
  });

  it('取消結案後，遲到的完成回報不能把它改回 END', async () => {
    orderRepo.findOne.mockResolvedValue(cancelled(OrderStatus.FAULTED));
    await expect(service.updateOrderStatus('SIM-1', 'END')).rejects.toMatchObject({ response: { code: 'ORDER_CANCELLED' } });
  });

  it('取消結案記下原因；重複回報 FAULTED 冪等', async () => {
    orderRepo.findOne.mockResolvedValue(cancelled(OrderStatus.PROCESSING));
    const saved = await service.updateOrderStatus('SIM-1', 'FAULTED');
    expect((saved.payload as Record<string, unknown>).closed_reason).toBe('cancelled_by_center');
    orderRepo.findOne.mockResolvedValue(saved);
    await expect(service.updateOrderStatus('SIM-1', 'FAULTED')).resolves.toBe(saved);
  });

  it('執行中剛好正常完成：照實接受 END', async () => {
    orderRepo.findOne.mockResolvedValue(cancelled(OrderStatus.PROCESSING));
    expect((await service.updateOrderStatus('SIM-1', 'END')).status).toBe(OrderStatus.END);
  });
});

describe('訂單生命週期：開始只認 REST，MQTT 只寫既有訂單的進度（不看班次代號）', () => {
  let service: OrderService;
  const stored = new Map<string, OperationOrder>();
  const orderRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => stored.get(where.id) ?? null),
    save: jest.fn(async (o: OperationOrder) => {
      stored.set(o.id, o);
      return o;
    }),
  };

  beforeEach(async () => {
    stored.clear();
    orderRepo.save.mockClear();
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
            computeRouteProgress: () => Promise.resolve(0),
            computeNextStation: () => Promise.resolve(null),
            getRouteStations: () => Promise.resolve([]),
          },
        },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: noop },
      ],
    }).compile();
    service = module.get(OrderService);
  });

  function seed(tripCode: string, lineKind = 'MAINLINE', status = OrderStatus.PENDING, payload: Record<string, unknown> = {}) {
    const order = {
      id: `ORD-${tripCode}`,
      vehicleCode: 'PMS03',
      tripCode,
      lineKind,
      status,
      plannedStart: '1787724000000',
      plannedEnd: '1787724360000',
      payload: { source: 'dispatch_engine', ...payload },
    } as OperationOrder;
    stored.set(order.id, order);
    return order;
  }

  const report = (tripCode: string, extra: Record<string, unknown> = {}) => ({
    vehicle_code: 'PMS03',
    order_id: `ORD-${tripCode}`,
    trip_code: tripCode,
    vehicle_phase: 'TRANSITING',
    order_status: 'PROCESSING',
    current_leg: { target_station_id: 'station_5', eta_seconds: 60 },
    timestamp: 1787724100000,
    ...extra,
  });

  /** 跑一遍：MQTT 行駛中 → REST 開始 → MQTT 進度 → REST 結束 → 遲到的 MQTT */
  async function lifecycle(tripCode: string, lineKind: string) {
    seed(tripCode, lineKind);
    const trace: string[] = [];
    const step = async (fn: () => Promise<unknown>) => {
      await fn();
      trace.push(String(stored.get(`ORD-${tripCode}`)!.status));
    };
    await step(() => service.applyOperationMqttUpdateWithOutcome('PMS03', report(tripCode)));
    await step(() => service.updateOrderStatus(`ORD-${tripCode}`, 'PROCESSING'));
    await step(() => service.applyOperationMqttUpdateWithOutcome('PMS03', report(tripCode, { timestamp: 1787724200000 })));
    await step(() => service.updateOrderStatus(`ORD-${tripCode}`, 'END'));
    await step(() => service.applyOperationMqttUpdateWithOutcome('PMS03', report(tripCode, { timestamp: 1787724300000 })));
    const order = stored.get(`ORD-${tripCode}`)!;
    return { trace, tripCode: order.tripCode, lineKind: order.lineKind, plannedStart: order.plannedStart };
  }

  it.each(['MAINLINE', 'TRANSITION', 'MAINTENANCE'])('%s：D1234、NT0000、其他名稱走完全一樣的流程', async (lineKind) => {
    const runs: Array<Awaited<ReturnType<typeof lifecycle>>> = [];
    for (const tripCode of ['D1234', 'NT0000', 'MT-D3-R5-0']) runs.push(await lifecycle(tripCode, lineKind));
    for (const run of runs) {
      expect(run.trace).toEqual(['PENDING', 'PROCESSING', 'PROCESSING', 'END', 'END']);
      expect(run.lineKind).toBe(lineKind);
      expect(run.plannedStart).toBe('1787724000000');
    }
    expect(runs.map((r) => r.tripCode)).toEqual(['D1234', 'NT0000', 'MT-D3-R5-0']);
  });

  it('待發中的進度更新（任何 phase）只刷新 ETA，不算開始', async () => {
    for (const phase of ['AWAITING_DEPARTURE', 'TRANSITING', 'DWELLING', 'DOCKING']) {
      seed('D1234');
      const { outcome } = await service.applyOperationMqttUpdateWithOutcome(
        'PMS03',
        report('D1234', { vehicle_phase: phase, timestamp: Date.now() }),
      );
      const order = stored.get('ORD-D1234')!;
      expect(outcome).toBe('pending_refreshed');
      expect(order.status).toBe(OrderStatus.PENDING);
      expect(order.lineKind).toBe('MAINLINE');
      expect(order.etaRemain).toBe('01:00');
    }
  });

  it('錯車：回報的車不是指派的車，不寫入', async () => {
    seed('NT0000', 'MAINLINE', OrderStatus.PROCESSING);
    const { order, outcome } = await service.applyOperationMqttUpdateWithOutcome('PMS09', report('NT0000', { vehicle_code: 'PMS09' }));
    expect(outcome).toBe('vehicle_mismatch');
    expect(order).toBeNull();
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(stored.get('ORD-NT0000')!.vehicleCode).toBe('PMS03');
  });

  it('未知訂單：不建立訂單', async () => {
    const { order, outcome } = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NOPE'));
    expect(outcome).toBe('unknown_order');
    expect(order).toBeNull();
    expect(stored.size).toBe(0);
  });

  it('沒有 order_id：不從班次代號拼單號', async () => {
    seed('D1234', 'MAINLINE', OrderStatus.PROCESSING);
    const { outcome } = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('D1234', { order_id: undefined }));
    expect(outcome).toBe('missing_order_id');
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('重複訊息與延遲訊息：不覆蓋較新的進度', async () => {
    seed('NT0000', 'MAINLINE', OrderStatus.PROCESSING);
    await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', {
      timestamp: 2000, current_leg: { target_station_id: 'station_7', eta_seconds: 10 },
    }));
    const dup = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', { timestamp: 2000 }));
    const late = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', { timestamp: 1000 }));
    expect(dup.outcome).toBe('duplicate');
    expect(late.outcome).toBe('stale');
    const payload = stored.get('ORD-NT0000')!.payload as Record<string, unknown>;
    expect((payload.current_leg as Record<string, unknown>).target_station_id).toBe('station_7');
    expect(orderRepo.save).toHaveBeenCalledTimes(1);
  });

  it('已取消的單：MQTT 行駛中也不會開始，REST 開始被拒', async () => {
    seed('D1234', 'MAINLINE', OrderStatus.PENDING, { cancel_requested_at: 1 });
    const { outcome } = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('D1234'));
    expect(outcome).toBe('cancel_requested');
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(stored.get('ORD-D1234')!.status).toBe(OrderStatus.PENDING);
    await expect(service.updateOrderStatus('ORD-D1234', 'PROCESSING')).rejects.toMatchObject({
      response: { code: 'ORDER_CANCELLED' },
    });
  });

  it('已結束、已故障的單：遲到的 MQTT 不寫進度、不改狀態', async () => {
    for (const status of [OrderStatus.END, OrderStatus.FAULTED]) {
      orderRepo.save.mockClear();
      seed('NT0000', 'MAINLINE', status);
      const { outcome } = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', { timestamp: Date.now() }));
      expect(outcome).toBe('not_processing');
      expect(stored.get('ORD-NT0000')!.status).toBe(status);
      expect(orderRepo.save).not.toHaveBeenCalled();
    }
  });

  it('車端 REST 回報才記車端證據；中心端內部呼叫不記；重送不改第一次的時間', async () => {
    seed('NT0000');
    await service.updateOrderStatus('ORD-NT0000', 'PROCESSING');
    expect((stored.get('ORD-NT0000')!.payload as Record<string, unknown>).vehicle_progress_at).toBeUndefined();
    seed('D1234');
    await service.updateOrderStatus('ORD-D1234', 'PROCESSING', { reporter: 'vehicle' });
    const first = ((stored.get('ORD-D1234')!.payload as Record<string, unknown>).vehicle_progress_at as Record<string, number>).PROCESSING;
    expect(first).toEqual(expect.any(Number));
    await service.updateOrderStatus('ORD-D1234', 'PROCESSING', { reporter: 'vehicle' });
    expect(((stored.get('ORD-D1234')!.payload as Record<string, unknown>).vehicle_progress_at as Record<string, number>).PROCESSING).toBe(first);
  });

  it('MQTT vehicle_phase=FAULTED：不結案，標「車輛故障，結案待確認」；之後車端 REST FAULTED 才結案', async () => {
    seed('NT0000', 'MAINLINE', OrderStatus.PROCESSING);
    const { outcome } = await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', { vehicle_phase: 'FAULTED' }));
    let order = stored.get('ORD-NT0000')!;
    expect(outcome).toBe('vehicle_fault_reported');
    expect(order.status).toBe(OrderStatus.PROCESSING);
    expect((order.payload as Record<string, unknown>).vehicle_fault).toMatchObject({ source: 'operation_update' });
    await service.updateOrderStatus('ORD-NT0000', 'FAULTED', { reporter: 'vehicle' });
    order = stored.get('ORD-NT0000')!;
    expect(order.status).toBe(OrderStatus.FAULTED);
  });

  it('車端故障後恢復正常 phase：清掉故障標記，可以照常 END', async () => {
    seed('NT0000', 'MAINLINE', OrderStatus.PROCESSING);
    await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', { vehicle_phase: 'FAULTED', timestamp: 10 }));
    await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', { vehicle_phase: 'TRANSITING', timestamp: 20 }));
    expect((stored.get('ORD-NT0000')!.payload as Record<string, unknown>).vehicle_fault).toBeNull();
    await service.updateOrderStatus('ORD-NT0000', 'END', { reporter: 'vehicle' });
    expect(stored.get('ORD-NT0000')!.status).toBe(OrderStatus.END);
  });

  it('故障待結案時中心端仍可取消', async () => {
    seed('NT0000', 'MAINLINE', OrderStatus.PROCESSING, { vehicle_fault: { reported_at: 1 } });
    const publishCancel = jest.fn();
    (service as unknown as { orderMqttPublisher: { publishCancel: jest.Mock } }).orderMqttPublisher = { publishCancel };
    await service.requestCancel('ORD-NT0000');
    expect((stored.get('ORD-NT0000')!.payload as Record<string, unknown>).cancel_requested_at).toEqual(expect.any(Number));
  });

  it('MQTT 不改班次代號、車輛與業務分類', async () => {
    seed('NT0000', 'TRANSITION', OrderStatus.PROCESSING);
    await service.applyOperationMqttUpdateWithOutcome('PMS03', report('NT0000', {
      trip_code: 'D9999', line_kind: 'MAINLINE', route_id: 'ROUTE-MAINLINE-DOWN',
    }));
    const order = stored.get('ORD-NT0000')!;
    expect(order.tripCode).toBe('NT0000');
    expect(order.lineKind).toBe('TRANSITION');
  });
});

describe('createOrder：路線與分類只用明確給的值', () => {
  it('D/U 班次代號不會自動變成正線、也不會補路線', async () => {
    const saved: OperationOrder[] = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: getRepositoryToken(OperationOrder),
          useValue: { create: (o: OperationOrder) => o, findOne: async () => null, save: async (o: OperationOrder) => { saved.push(o); return o; } },
        },
        { provide: getRepositoryToken(OrderActionState), useValue: {} },
        { provide: getRepositoryToken(OrderEvent), useValue: {} },
        { provide: OrderMqttPublisher, useValue: { publishAssign: () => ({}) } },
        { provide: OrderRouteService, useValue: { materializeActionStates: jest.fn() } },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: {} },
      ],
    }).compile();
    const service = module.get(OrderService);
    await service.createOrder({ order_id: 'A', vehicle_code: 'PMS01', trip_code: 'D1234' });
    expect(saved[0].lineKind).toBeUndefined();
    expect(saved[0].routeId).toBeUndefined();
  });
});

describe('同一張單同時被 MQTT 進度與 REST 回報寫入', () => {
  it('不會互相蓋掉 payload（vehicle_progress_at、cancel_requested_at 都留著）', async () => {
    const db = new Map<string, OperationOrder>();
    const clone = (o: OperationOrder) => JSON.parse(JSON.stringify(o)) as OperationOrder;
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const orderRepo = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
        await tick();
        const o = db.get(where.id);
        return o ? clone(o) : null;
      }),
      save: jest.fn(async (o: OperationOrder) => {
        await tick();
        db.set(o.id, clone(o));
        return o;
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getRepositoryToken(OperationOrder), useValue: orderRepo },
        { provide: getRepositoryToken(OrderActionState), useValue: {} },
        { provide: getRepositoryToken(OrderEvent), useValue: {} },
        { provide: OrderMqttPublisher, useValue: { publishCancel: jest.fn() } },
        {
          provide: OrderRouteService,
          useValue: {
            computeRouteProgress: () => Promise.resolve(0),
            computeNextStation: () => Promise.resolve(null),
            getRouteStations: () => Promise.resolve([]),
          },
        },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: {} },
      ],
    }).compile();
    const service = module.get(OrderService);
    db.set('ORD-1', {
      id: 'ORD-1', vehicleCode: 'PMS04', tripCode: 'NT0401', lineKind: 'MAINLINE',
      status: OrderStatus.PROCESSING, payload: { source: 'plan_replay' },
    } as OperationOrder);

    await Promise.all([
      service.applyOperationMqttUpdateWithOutcome('PMS04', {
        order_id: 'ORD-1', vehicle_phase: 'TRANSITING', timestamp: 100,
        current_leg: { target_station_id: 'station_5', eta_seconds: 10 },
      }),
      service.updateOrderStatus('ORD-1', 'END', { reporter: 'vehicle' }),
    ]);
    let order = db.get('ORD-1')!;
    expect(order.status).toBe(OrderStatus.END);
    expect((order.payload as Record<string, unknown>).vehicle_progress_at).toMatchObject({ END: expect.any(Number) });

    db.set('ORD-2', {
      id: 'ORD-2', vehicleCode: 'PMS04', tripCode: 'NT0402', lineKind: 'MAINLINE',
      status: OrderStatus.PROCESSING, payload: {},
    } as OperationOrder);
    await Promise.all([
      service.requestCancel('ORD-2'),
      service.applyOperationMqttUpdateWithOutcome('PMS04', { order_id: 'ORD-2', vehicle_phase: 'TRANSITING', timestamp: 200 }),
    ]);
    order = db.get('ORD-2')!;
    expect((order.payload as Record<string, unknown>).cancel_requested_at).toEqual(expect.any(Number));
  });
});

describe('建單不能覆寫已開始、已結案或已取消的單', () => {
  async function serviceWith(existing: OperationOrder | null) {
    const saved: OperationOrder[] = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: getRepositoryToken(OperationOrder),
          useValue: { create: (o: OperationOrder) => o, findOne: async () => existing, save: async (o: OperationOrder) => { saved.push(o); return o; } },
        },
        { provide: getRepositoryToken(OrderActionState), useValue: {} },
        { provide: getRepositoryToken(OrderEvent), useValue: {} },
        { provide: OrderMqttPublisher, useValue: { publishAssign: () => ({}) } },
        { provide: OrderRouteService, useValue: { materializeActionStates: jest.fn() } },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: {} },
      ],
    }).compile();
    return { service: module.get(OrderService), saved };
  }
  const body = { order_id: 'ORD-1', vehicle_code: 'PMS01', trip_code: 'NT0000', line_kind: 'MAINLINE' };

  it.each([OrderStatus.PROCESSING, OrderStatus.END, OrderStatus.FAULTED])('既有單是 %s：拒絕，不改狀態', async (status) => {
    const { service, saved } = await serviceWith({ id: 'ORD-1', status, payload: {} } as OperationOrder);
    await expect(service.createOrder(body)).rejects.toMatchObject({ response: { code: 'ORDER_NOT_OVERWRITABLE' } });
    expect(saved).toHaveLength(0);
  });

  it('既有單是待發但中心端已取消：拒絕', async () => {
    const { service, saved } = await serviceWith({ id: 'ORD-1', status: OrderStatus.PENDING, payload: { cancel_requested_at: 1 } } as OperationOrder);
    await expect(service.createOrder(body)).rejects.toMatchObject({ response: { code: 'ORDER_NOT_OVERWRITABLE' } });
    expect(saved).toHaveLength(0);
  });

  it('還沒開始的待發單：照舊可以更新內容', async () => {
    const { service, saved } = await serviceWith({ id: 'ORD-1', status: OrderStatus.PENDING, payload: {} } as OperationOrder);
    await service.createOrder(body);
    expect(saved).toHaveLength(1);
  });
});

describe('並行的開始、取消、結束、遲到訊息不會把訂單恢復成錯誤狀態', () => {
  async function setup() {
    const db = new Map<string, OperationOrder>();
    const clone = (o: OperationOrder) => JSON.parse(JSON.stringify(o)) as OperationOrder;
    const tick = () => new Promise((r) => setTimeout(r, Math.random() * 6));
    const repo = {
      create: (o: OperationOrder) => o,
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => { await tick(); const o = db.get(where.id); return o ? clone(o) : null; }),
      save: jest.fn(async (o: OperationOrder) => { await tick(); db.set(o.id, clone(o)); return o; }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getRepositoryToken(OperationOrder), useValue: repo },
        { provide: getRepositoryToken(OrderActionState), useValue: {} },
        { provide: getRepositoryToken(OrderEvent), useValue: {} },
        { provide: OrderMqttPublisher, useValue: { publishCancel: jest.fn(), publishAssign: () => ({}) } },
        { provide: OrderRouteService, useValue: { computeRouteProgress: () => Promise.resolve(0), computeNextStation: () => Promise.resolve(null), getRouteStations: () => Promise.resolve([]), materializeActionStates: jest.fn() } },
        { provide: DatasourceInvalidationService, useValue: invalidationMock },
        { provide: MapService, useValue: {} },
      ],
    }).compile();
    const seed = (status: OrderStatus, payload: Record<string, unknown> = {}) =>
      db.set('ORD-C', { id: 'ORD-C', vehicleCode: 'PMS01', tripCode: 'NT0000', lineKind: 'MAINLINE', status, payload } as OperationOrder);
    return { service: module.get(OrderService), db, seed };
  }
  const settle = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e as { response?: { code?: string } }).response?.code ?? 'error');

  it('開始與取消同時到：取消一定留著；若先開始，取消照樣生效；若先取消，開始被拒', async () => {
    for (let i = 0; i < 20; i += 1) {
      const { service, db, seed } = await setup();
      seed(OrderStatus.PENDING);
      await Promise.all([settle(service.updateOrderStatus('ORD-C', 'PROCESSING', { reporter: 'vehicle' })), settle(service.requestCancel('ORD-C'))]);
      const o = db.get('ORD-C')!;
      expect((o.payload as Record<string, unknown>).cancel_requested_at).toEqual(expect.any(Number));
      expect([OrderStatus.PENDING, OrderStatus.PROCESSING]).toContain(o.status);
    }
  });

  it('結束與遲到的 MQTT 進度同時到：停在 END，不會被改回執行中', async () => {
    for (let i = 0; i < 20; i += 1) {
      const { service, db, seed } = await setup();
      seed(OrderStatus.PROCESSING, { last_operation_report_at: 100 });
      await Promise.all([
        settle(service.updateOrderStatus('ORD-C', 'END', { reporter: 'vehicle' })),
        settle(service.applyOperationMqttUpdateWithOutcome('PMS01', { order_id: 'ORD-C', vehicle_phase: 'TRANSITING', timestamp: 90 })),
        settle(service.applyOperationMqttUpdateWithOutcome('PMS01', { order_id: 'ORD-C', vehicle_phase: 'FAULTED', timestamp: 200 })),
      ]);
      const o = db.get('ORD-C')!;
      expect(o.status).toBe(OrderStatus.END);
      expect((o.payload as Record<string, unknown>).vehicle_progress_at).toMatchObject({ END: expect.any(Number) });
    }
  });

  it('重送建單與開始同時到：不會把已開始的單改回待發', async () => {
    for (let i = 0; i < 20; i += 1) {
      const { service, db, seed } = await setup();
      seed(OrderStatus.PENDING);
      await Promise.all([
        settle(service.updateOrderStatus('ORD-C', 'PROCESSING', { reporter: 'vehicle' })),
        settle(service.createOrder({ order_id: 'ORD-C', vehicle_code: 'PMS01', trip_code: 'NT0000', line_kind: 'MAINLINE' }, { skipAssign: true })),
      ]);
      const o = db.get('ORD-C')!;
      // 開始先到：建單被拒；建單先到：覆寫的是待發單，之後開始照常生效
      expect(o.status).toBe(OrderStatus.PROCESSING);
    }
  });
});
