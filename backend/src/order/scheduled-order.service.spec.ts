import {
  OperationOrder,
  OrderStatus,
} from '../database/entities/operation-order.entity';
import { ScheduledOrderEntry } from '../database/entities/scheduled-order-entry.entity';
import {
  orderCalendarCategory,
  ScheduledOrderService,
} from './scheduled-order.service';

const order = (status: OrderStatus, payload: Record<string, unknown> = {}) =>
  ({ status, payload }) as OperationOrder;

describe('orderCalendarCategory', () => {
  it('END 永遠優先於取消請求', () => {
    expect(
      orderCalendarCategory(order(OrderStatus.END, { cancel_requested_at: 1 })),
    ).toBe('completed');
  });

  it('取消請求優先於故障分類，但不捏造已停止', () => {
    expect(
      orderCalendarCategory(
        order(OrderStatus.FAULTED, { cancel_requested_at: 1 }),
      ),
    ).toBe('cancelled');
  });

  it('將結案待確認的車輛故障歸入異常', () => {
    expect(
      orderCalendarCategory(
        order(OrderStatus.PROCESSING, { vehicle_phase: 'FAULTED' }),
      ),
    ).toBe('fault');
  });

  it('PROCESSING 與 PENDING 維持互斥分類', () => {
    expect(orderCalendarCategory(order(OrderStatus.PROCESSING))).toBe(
      'running',
    );
    expect(orderCalendarCategory(order(OrderStatus.PENDING))).toBe('pending');
  });
});

describe('ScheduledOrderService calendar projection', () => {
  const service = Object.create(
    ScheduledOrderService.prototype,
  ) as ScheduledOrderService;

  it('用每日計畫關聯欄位去重，不靠顯示名稱或時間猜測', () => {
    const matches = (
      service as unknown as {
        orderBelongsToPlanTask: (
          order: OperationOrder,
          plan: Record<string, unknown>,
          task: Record<string, unknown>,
        ) => boolean;
      }
    ).orderBelongsToPlanTask(
      {
        payload: {
          operating_day: '2026-10-23',
          plan_digest: 'digest-1',
          plan_block_id: 'block-1',
        },
      } as unknown as OperationOrder,
      { operating_day: '2026-10-23', plan_digest: 'digest-1' },
      { id: 'block-1', code: '班次01' },
    );
    expect(matches).toBe(true);
  });

  it('既有 route_id 模板訂單詳情會呈現路線站序', () => {
    const projected = (
      service as unknown as {
        projectOrder: (
          order: OperationOrder,
          schedule: undefined,
          template: Record<string, unknown>,
        ) => { route_name: string; stations: Array<{ station_id: string }> };
      }
    ).projectOrder(
      {
        id: 'order-1',
        tripCode: 'trip-1',
        vehicleCode: 'PMS01',
        routeId: 'route-1',
        status: OrderStatus.PENDING,
        payload: {},
        plannedStart: '1000',
        plannedEnd: null,
        completedAt: null,
      } as unknown as OperationOrder,
      undefined,
      {
        route_name: '正線上行',
        line_kind: 'MAINLINE',
        stations: [
          { order: 1, station_id: 'A', station_name: 'A', actions: [] },
          { order: 2, station_id: 'B', station_name: 'B', actions: [] },
        ],
      },
    );
    expect(projected.route_name).toBe('正線上行');
    expect(projected.stations.map((station) => station.station_id)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('ScheduledOrderService.publishDue', () => {
  const pending = (): ScheduledOrderEntry => ({
    id: '00000000-0000-4000-8000-000000000001',
    requestKey: 'req-1',
    requestHash: 'hash',
    displayName: '人工排程',
    vehicleCode: 'PMS01',
    routeId: 'route-1',
    mapId: 'map-1',
    plannedStart: '100000',
    plannedEnd: null,
    routeSnapshot: {
      route_name: '測試路線',
      line_kind: 'MAINLINE',
      stations: [
        { order: 1, station_id: 'A', station_name: 'A站', actions: [] },
        { order: 2, station_id: 'B', station_name: 'B站', actions: [] },
      ],
    },
    state: 'PENDING',
    operationOrderId: null,
    createdBy: 'user',
    createdAt: '1',
    cancelledAt: null,
    publishedAt: null,
    lastAttemptAt: null,
    lastError: null,
  });

  const harness = (
    row: ScheduledOrderEntry,
    existing: OperationOrder | null = null,
    mode = 'realtime',
  ) => {
    const schedules = {
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([row]),
      save: jest
        .fn()
        .mockImplementation((value: ScheduledOrderEntry) =>
          Promise.resolve(value),
        ),
    };
    const orders = { findOne: jest.fn().mockResolvedValue(existing) };
    const createOrder = jest
      .fn<Promise<Record<string, never>>, [Record<string, unknown>]>()
      .mockResolvedValue({});
    const orderService = { createOrder };
    const invalidation = { emit: jest.fn() };
    const service = new ScheduledOrderService(
      schedules as never,
      orders as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      orderService as never,
      {} as never,
      {} as never,
      invalidation as never,
      { snapshot: () => ({ mode }) } as never,
    );
    return { service, schedules, orders, orderService, invalidation };
  };

  it('到期時只建立一張 operation_order，並把計畫連回該訂單', async () => {
    const row = pending();
    const h = harness(row);
    const result = await h.service.publishDue(100_000, 60, 300);
    expect(h.orderService.createOrder).toHaveBeenCalledTimes(1);
    const submitted = h.orderService.createOrder.mock.calls[0][0];
    expect(submitted.order_id).toBe(`MANUAL-${row.id}`);
    expect(submitted.vehicle_code).toBe('PMS01');
    expect(submitted.payload).toMatchObject({
      source: 'manual_schedule',
      scheduled_order_id: row.id,
    });
    expect(row).toMatchObject({
      state: 'PUBLISHED',
      operationOrderId: `MANUAL-${row.id}`,
    });
    expect(result.published).toEqual([row.id]);
  });

  it('重啟後已有同一 deterministic order_id 時不重建訂單', async () => {
    const row = pending();
    const h = harness(row, { id: `MANUAL-${row.id}` } as OperationOrder);
    await h.service.publishDue(100_000, 60, 300);
    expect(h.orderService.createOrder).not.toHaveBeenCalled();
    expect(row.state).toBe('PUBLISHED');
  });

  it('發布失敗後 30 秒內退避，不高速重試', async () => {
    const row = pending();
    row.lastAttemptAt = '90000';
    const h = harness(row);
    const result = await h.service.publishDue(100_000, 60, 300);
    expect(h.orderService.createOrder).not.toHaveBeenCalled();
    expect(result.published).toEqual([]);
  });

  it('重播營運時鐘不發布人工實機排程', async () => {
    const row = pending();
    const h = harness(row, null, 'replay');
    const result = await h.service.publishDue(100_000, 60, 300);
    expect(h.schedules.find).not.toHaveBeenCalled();
    expect(h.orderService.createOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, published: [] });
  });
});
