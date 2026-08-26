import { DispatchEngineService } from './dispatch-engine.service';
import { localMidnight } from './dispatch.plan';
import type { TimetableTripDto } from '../operation-shift/timetable/expand-timetable';

/**
 * 引擎的行為測試。時刻換算已在 dispatch.plan.spec 釘住，這裡只驗
 * <strong>決定要不要真的下訂單</strong>的那一段：防重、補發、開關、失敗重試。
 */

const REFERENCE = new Date(2026, 7, 26, 12, 0, 0).getTime();
const MIDNIGHT = localMidnight(REFERENCE);

function trip(
  secondOfDay: number,
  row = 1,
  code = `T-${secondOfDay}`,
): TimetableTripDto {
  return {
    trip_code: code,
    block_id: `block-${code}`,
    timeline_row: row,
    task_type: 'passenger',
    label: null,
    source: 'plan',
    route_id: 'route-a',
    route_code: 'A01',
    route_name: '正線',
    card_start: '00:00:00',
    card_end: '00:00:00',
    card_start_second: secondOfDay,
    card_end_second: secondOfDay + 1800,
    stations: [
      {
        order: 1,
        station_id: 'st-1',
        station_name: '起站',
        role: 'origin',
        arrival: null,
        departure: '08:00:00',
        dwell_complete: '08:00:00',
        base_dwell_seconds: 0,
        dwell_seconds: 0,
        travel_to_next_seconds: 1800,
      },
      {
        order: 2,
        station_id: 'st-2',
        station_name: '終站',
        role: 'destination',
        arrival: '08:30:00',
        departure: null,
        dwell_complete: '08:30:00',
        base_dwell_seconds: 0,
        dwell_seconds: 0,
        travel_to_next_seconds: null,
      },
    ],
  } as TimetableTripDto;
}

/** createOrder 收到的參數，測試只在意這幾個欄位 */
type CreatedOrder = {
  order_id: string;
  trip_code: string;
  vehicle_code: string;
  line_kind: string;
  planned_start?: number;
  payload: {
    kind: string;
    route_name: string | null;
    shift_name: string;
    origin: { id: string; name: string; kind: string } | null;
    destination: { id: string; name: string; kind: string } | null;
    stations: unknown[];
  };
};

function build(
  trips: TimetableTripDto[],
  existingOrderIds: string[] = [],
  body: Record<string, unknown> = {},
) {
  const created: CreatedOrder[] = [];
  const shiftService = {
    getDeployedTrips: jest.fn().mockResolvedValue({
      shiftId: 'shift-1',
      shiftName: '模擬正線',
      trips,
      body,
    }),
  };
  const orderService = {
    createOrder: jest.fn().mockImplementation((data: CreatedOrder) => {
      created.push(data);
      return Promise.resolve(data);
    }),
  };
  const vehicleRepository = {
    find: jest.fn().mockResolvedValue([
      { vehicleCode: 'PMS-02', isActive: true },
      { vehicleCode: 'PMS-01', isActive: true },
    ]),
  };
  const orderRepository = {
    find: jest.fn().mockResolvedValue(existingOrderIds.map((id) => ({ id }))),
  };

  const engine = new DispatchEngineService(
    shiftService as never,
    orderService as never,
    vehicleRepository as never,
    orderRepository as never,
  );
  return { engine, created, orderService, shiftService, orderRepository };
}

describe('DispatchEngineService.tick', () => {
  it('發車時刻進入提前量才下訂單', async () => {
    const { engine, created } = build([trip(12 * 3600 + 60)]);

    const early = await engine.tick({ now: REFERENCE - 600_000 });
    expect(early.issued).toHaveLength(0);
    expect(created).toHaveLength(0);

    const due = await engine.tick({ now: REFERENCE });
    expect(due.issued).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it('同一支程序不會重複下同一張訂單', async () => {
    const { engine, created } = build([trip(12 * 3600 + 60)]);

    await engine.tick({ now: REFERENCE });
    await engine.tick({ now: REFERENCE + 5_000 });
    await engine.tick({ now: REFERENCE + 10_000 });

    expect(created).toHaveLength(1);
  });

  it('重啟後不會重發庫裡已有的訂單', async () => {
    // 記憶體是空的，但庫裡已經有這張——模擬程序重啟
    const target = trip(12 * 3600 + 60);
    const orderId = `260826-${target.trip_code}`;
    const { engine, created } = build([target], [orderId]);

    const result = await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(0);
    expect(result.issued).toHaveLength(0);
  });

  it('晚了但還在補發窗口內的班次會補發', async () => {
    const { engine, created } = build([trip(12 * 3600 - 120)]);

    const result = await engine.tick({ now: REFERENCE });

    expect(result.issued).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it('晚太多的班次不補發，列進 expired', async () => {
    const { engine, created } = build([trip(12 * 3600 - 600)]);

    const result = await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(0);
    expect(result.expired.map((item) => item.tripCode)).toEqual([
      `T-${12 * 3600 - 600}`,
    ]);
  });

  it('停用時不下訂單', async () => {
    const { engine, created } = build([trip(12 * 3600 + 60)]);
    engine.setEnabled(false);

    await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(0);
  });

  it('dryRun 回報會發什麼但不真的發', async () => {
    const { engine, created } = build([trip(12 * 3600 + 60)]);

    const result = await engine.tick({ now: REFERENCE, dryRun: true });

    expect(result.issued).toHaveLength(1);
    expect(created).toHaveLength(0);
  });

  it('下訂單失敗時不記為已發，下個 tick 會再試', async () => {
    const { engine, orderService, created } = build([trip(12 * 3600 + 60)]);
    orderService.createOrder.mockRejectedValueOnce(new Error('MQTT 斷線'));

    const first = await engine.tick({ now: REFERENCE });
    expect(first.issued).toHaveLength(0);

    const second = await engine.tick({ now: REFERENCE + 5_000 });
    expect(second.issued).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it('沒有部署中的班表時安靜地不做事', async () => {
    const { engine, shiftService, created } = build([]);
    shiftService.getDeployedTrips.mockResolvedValue(null);

    const result = await engine.tick({ now: REFERENCE });

    expect(result.issued).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('車隊依代號排序，第 N 列固定對到第 N 台', async () => {
    // vehicleRepository 故意回傳 PMS-02 在前
    const { engine, created } = build([
      trip(12 * 3600 + 60, 1, 'ROW1'),
      trip(12 * 3600 + 60, 2, 'ROW2'),
    ]);

    await engine.tick({ now: REFERENCE });

    expect(created.map((order) => order.vehicle_code)).toEqual([
      'PMS-01',
      'PMS-02',
    ]);
  });

  it('訂單 payload 帶著 A/B 點與完整站序給車端', async () => {
    const { engine, created } = build([trip(12 * 3600 + 60)]);

    await engine.tick({ now: REFERENCE });

    const payload = created[0].payload;
    expect(payload.origin?.id).toBe('st-1');
    expect(payload.origin?.kind).toBe('station');
    expect(payload.destination?.id).toBe('st-2');
    expect(payload.stations).toHaveLength(2);
    expect(payload.shift_name).toBe('模擬正線');
    expect(created[0].planned_start).toBe(MIDNIGHT + (12 * 3600 + 60) * 1000);
  });
});

describe('空車移動', () => {
  /** 出廠：設施 → 站點。入廠欄位名相同，方向靠 source 分辨。 */
  const YARD_BODY = {
    scheduleOutput: {
      plan: {
        timelines: [
          {
            blocks: [
              {
                id: 'yardtransit-out-1',
                label: '整備出廠 · E3 → N2W下行出發',
                source: 'yard_exit_move',
                taskType: 'dispatch',
                timelineRow: 1,
                plannedStartMinute: 12 * 60 + 1,
                plannedEndMinute: 12 * 60 + 1.5,
                yardExitStationId: '175',
                yardExitStationLabel: 'N2W下行出發',
                yardExitFacilityNodeId: '131',
                yardExitFacilityLabel: 'E3',
              },
              {
                id: 'yardentry-1',
                label: '整備入廠 · N2W下行出發 → H1',
                source: 'yard_entry_move',
                taskType: 'dispatch',
                timelineRow: 1,
                plannedStartMinute: 12 * 60 + 1,
                plannedEndMinute: 12 * 60 + 4,
                yardExitStationId: '175',
                yardExitStationLabel: 'N2W下行出發',
                yardExitFacilityNodeId: '194',
                yardExitFacilityLabel: 'H1',
              },
            ],
          },
        ],
      },
    },
  };

  it('出廠與入廠都會下訂單，且方向相反', async () => {
    const { engine, created } = build([], [], YARD_BODY);

    await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(2);
    const out = created.find((order) =>
      order.payload.route_name?.startsWith('整備出廠'),
    )!;
    const into = created.find((order) =>
      order.payload.route_name?.startsWith('整備入廠'),
    )!;

    // 出廠：設施開往站點
    expect(out.payload.origin).toMatchObject({ id: '131', kind: 'facility' });
    expect(out.payload.destination).toMatchObject({
      id: '175',
      kind: 'station',
    });
    // 入廠：站點開回設施
    expect(into.payload.origin).toMatchObject({ id: '175', kind: 'station' });
    expect(into.payload.destination).toMatchObject({
      id: '194',
      kind: 'facility',
    });
  });

  it('空車移動不算正線營運，line_kind 不是 MAINLINE', async () => {
    const { engine, created } = build([], [], YARD_BODY);

    await engine.tick({ now: REFERENCE });

    expect(created.every((order) => order.line_kind === 'MOVEMENT')).toBe(true);
  });

  it('order_id 用列與分鐘組出來，重算班表也不會換號', async () => {
    const { engine, created } = build([], [], YARD_BODY);

    await engine.tick({ now: REFERENCE });

    expect(created.map((order) => order.order_id).sort()).toEqual([
      `260826-MVIN-R1-${(12 * 60 + 1) * 60}`,
      `260826-MVOUT-R1-${(12 * 60 + 1) * 60}`,
    ]);
  });

  it('連設施端都缺的移動卡不下訂單，記進 skipped', async () => {
    const broken = {
      scheduleOutput: {
        plan: {
          timelines: [
            {
              blocks: [
                {
                  id: 'broken-move',
                  source: 'yard_exit_move',
                  taskType: 'dispatch',
                  timelineRow: 1,
                  plannedStartMinute: 12 * 60 + 1,
                  plannedEndMinute: 12 * 60 + 2,
                  yardExitStationId: '175',
                },
              ],
            },
          ],
        },
      },
    };
    const { engine, created } = build([], [], broken);

    const result = await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        tripCode: 'broken-move',
        reason: '空車移動缺少設施節點，無法決定場區端',
      },
    ]);
  });
});

describe('讓站移動：只記了設施端', () => {
  /**
   * 這種卡用另一組欄位名（yardEntryFacility*），而且沒有站點端——起點就是車輛
   * 上一張卡的終點。實機班表裡有 33 張。
   */
  function bodyWith(blocks: Array<Record<string, unknown>>) {
    return { scheduleOutput: { plan: { timelines: [{ blocks }] } } };
  }

  const BERTH_PARK = {
    id: 'berthpark-in-1',
    label: '讓站移動 · T3上行 → H3',
    source: 'yard_entry_move',
    taskType: 'dispatch',
    timelineRow: 1,
    plannedStartMinute: 12 * 60 + 1.5,
    plannedEndMinute: 12 * 60 + 3,
    yardEntryFacilityLabel: 'H3',
    yardEntryFacilityNodeId: '196',
  };

  it('起點由前一張正線班次的終站補上', async () => {
    // 正線班次 12:01 出發、終站 st-2；讓站移動 12:02 出發
    const { engine, created } = build(
      [trip(12 * 3600 + 60)],
      [],
      bodyWith([BERTH_PARK]),
    );

    await engine.tick({ now: REFERENCE });

    const move = created.find(
      (order) => order.trip_code === `MVIN-R1-${(12 * 60 + 1.5) * 60}`,
    )!;
    expect(move.payload.origin).toMatchObject({ id: 'st-2', kind: 'station' });
    expect(move.payload.destination).toMatchObject({
      id: '196',
      kind: 'facility',
    });
  });

  it('前面沒有任何卡可以補時不發訂單，並說明原因', async () => {
    const { engine, created } = build([], [], bodyWith([BERTH_PARK]));

    const result = await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        tripCode: `MVIN-R1-${(12 * 60 + 1.5) * 60}`,
        reason: '補不到起點，不發訂單',
      },
    ]);
  });

  it('只補同一列的卡，不會跨列拿別台車的位置', async () => {
    // 第 2 列有正線班次，第 1 列的讓站移動不該拿它來補
    const { engine, created } = build(
      [trip(12 * 3600 + 60, 2, 'ROW2')],
      [],
      bodyWith([BERTH_PARK]),
    );

    const result = await engine.tick({ now: REFERENCE });

    expect(created.map((order) => order.trip_code)).toEqual(['ROW2']);
    expect(result.skipped).toHaveLength(1);
  });
});

describe('班次展開結果裡的 dispatch 卡不重複排入', () => {
  /**
   * 展開結果也含 taskType='dispatch' 的卡，但那份沒有站序。兩邊都收會讓同一趟
   * 被排兩次，其中一份兩端皆空，還會搶走相鄰卡的補齊來源。
   */
  it('只認 extractYardMoves 抽出來的那一份', async () => {
    const stationless = {
      ...trip(12 * 3600 + 60, 1, 'D0000'),
      task_type: 'dispatch',
      stations: [],
    } as TimetableTripDto;

    const { engine, created } = build([stationless], [], {
      scheduleOutput: {
        plan: {
          timelines: [
            {
              blocks: [
                {
                  id: 'yard-out-1',
                  label: '整備出廠 · E3 → N2W下行出發',
                  source: 'yard_exit_move',
                  taskType: 'dispatch',
                  timelineRow: 1,
                  plannedStartMinute: 12 * 60 + 1,
                  plannedEndMinute: 12 * 60 + 2,
                  yardExitStationId: '175',
                  yardExitStationLabel: 'N2W下行出發',
                  yardExitFacilityNodeId: '131',
                  yardExitFacilityLabel: 'E3',
                },
              ],
            },
          ],
        },
      },
    });

    const result = await engine.tick({ now: REFERENCE });

    expect(created).toHaveLength(1);
    expect(created[0].trip_code).toBe(`MVOUT-R1-${(12 * 60 + 1) * 60}`);
    expect(result.skipped).toHaveLength(0);
  });
});

describe('線上開關要真的能開', () => {
  /**
   * 停用時若不建計時器，POST /dispatch/enable 就變成沒有作用的按鈕——回應說
   * 已啟用，卻永遠不會有人去 tick，只能重啟後端。
   */
  it('DISPATCH_ENABLED=false 啟動後，setEnabled(true) 就能下單', async () => {
    const previous = process.env.DISPATCH_ENABLED;
    process.env.DISPATCH_ENABLED = 'false';
    try {
      const { engine, created } = build([trip(12 * 3600 + 60)]);
      engine.onModuleInit();

      const off = await engine.tick({ now: REFERENCE });
      expect(off.issued).toHaveLength(0);

      engine.setEnabled(true);
      const on = await engine.tick({ now: REFERENCE });

      expect(on.issued).toHaveLength(1);
      expect(created).toHaveLength(1);
      engine.onModuleDestroy();
    } finally {
      if (previous === undefined) delete process.env.DISPATCH_ENABLED;
      else process.env.DISPATCH_ENABLED = previous;
    }
  });
});
