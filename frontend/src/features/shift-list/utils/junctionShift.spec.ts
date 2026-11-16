import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnoseJunctionBlock, solveJunctionShift, type JunctionReservation, type JunctionShiftQuery } from './junctionShift';

/** 時刻都只是測試資料；間隔 60 秒、刻度 10 秒 */
const DAY = 86_400;
function query({ bookings = [], ...overrides }: Partial<Omit<JunctionShiftQuery, 'bookings'>> & { bookings?: JunctionReservation[] }): JunctionShiftQuery {
  const byNode = new Map<string, JunctionReservation[]>();
  for (const booking of bookings) {
    const group = byNode.get(booking.nodeId) ?? [];
    group.push(booking);
    byNode.set(booking.nodeId, group);
  }
  return {
    points: [{ nodeId: 'gate', instant: 1000 }],
    bookings: byNode,
    timelineRow: 1,
    minShift: 0,
    maxShift: 119,
    bufferSeconds: 60,
    daySeconds: DAY,
    alignSeconds: 10,
    ...overrides,
  };
}

describe('轉折點錯開 solveJunctionShift', () => {
  it('拒絕兩端各有 40 秒間隔但在路段內超車的安排', () => {
    const nodeId = 'seg:A:B#f';
    const q = query({
      points: [{ nodeId, instant: 40, until: 60 }],
      bookings: [{ nodeId, instant: 0, until: 100, timelineRow: 2 }],
      minShift: 0,
      maxShift: 0,
      bufferSeconds: 30,
    });
    assert.equal(solveJunctionShift(q), null);
    assert.equal(solveJunctionShift({ ...q, points: [{ nodeId, instant: 40, until: 140 }] }), 0);
  });
  it('跨午夜的同向路段仍須先進先出', () => {
    const nodeId = 'seg:A:B#f';
    const q = query({
      points: [{ nodeId, instant: 20, until: 80 }],
      bookings: [{ nodeId, instant: DAY - 40, until: DAY + 120, timelineRow: 2 }],
    });
    assert.equal(solveJunctionShift({ ...q, maxShift: 30 }), null);
    assert.equal(solveJunctionShift(q), 40);
  });

  it('拒絕 07:04:30 出場移動穿越載客車仍佔用的 T3U', () => {
    const nodeId = '156';
    const q = query({
      points: [{ nodeId, instant: 7 * 3600 + 4 * 60 + 30 }],
      bookings: [{
        nodeId, instant: 7 * 3600 + 60 + 30, until: 7 * 3600 + 7 * 60 + 30, timelineRow: 5,
      }],
      timelineRow: 2,
      berthNodeIds: new Set([nodeId]),
      bufferSeconds: 30,
      maxShift: 0,
    });
    assert.equal(solveJunctionShift(q), null);
  });
  it('單一阻擋：往後挪到剛好差開保護間隔', () => {
    const shift = solveJunctionShift(query({ bookings: [{ nodeId: 'gate', instant: 1010, timelineRow: 2 }] }));
    assert.equal(shift, 70); // 1070 − 1010 = 60，剛好等於間隔也算差開
  });

  it('恰好等於安全間隔可以；少 1 秒不行', () => {
    assert.equal(solveJunctionShift(query({ bookings: [{ nodeId: 'gate', instant: 940, timelineRow: 2 }] })), 0);
    const tight = query({ bookings: [{ nodeId: 'gate', instant: 941, timelineRow: 2 }], alignSeconds: 1 });
    assert.equal(solveJunctionShift(tight), 1);
  });

  it('可挪 119 秒、需要差開 60 秒，但多筆預約把整段佔滿：回 null，診斷列出所有擋在窗裡的預約', () => {
    const q = query({
      bookings: [
        { nodeId: 'gate', instant: 1000, timelineRow: 2 },
        { nodeId: 'gate', instant: 1060, timelineRow: 3 },
        { nodeId: 'gate', instant: 1120, timelineRow: 4 },
      ],
    });
    assert.equal(solveJunctionShift(q), null);
    const diagnosis = diagnoseJunctionBlock(q);
    assert.deepEqual(diagnosis.points[0]!.bookingsInWindow.map((item) => item.timelineRow), [2, 3, 4]);
    assert.equal(diagnosis.minShift, 0);
    assert.equal(diagnosis.maxShift, 119);
  });

  it('搜尋區間端點本身就是答案時也找得到（不只試預約邊緣）', () => {
    // 預約在更早的地方，往後挪到區間上限剛好差開
    const q = query({ minShift: 50, maxShift: 80, bookings: [{ nodeId: 'gate', instant: 990, timelineRow: 2 }] });
    assert.equal(solveJunctionShift(q), 50);
  });

  it('跨午夜：23:59:50 的預約會擋 00:00:10 的經過', () => {
    const q = query({
      points: [{ nodeId: 'gate', instant: DAY + 10 }],
      bookings: [{ nodeId: 'gate', instant: DAY - 10, timelineRow: 2 }],
    });
    assert.equal(solveJunctionShift(q), 40); // 00:00:50 跟 23:59:50 差 60 秒
  });

  it('外部位移（等設施空出來）已經加進時刻：求解跟診斷看的是同一組時刻', () => {
    const facilityShift = 30;
    const base = { nodeId: 'gate', instant: 1000 };
    const shifted = { ...base, instant: base.instant + facilityShift };
    const q = query({
      points: [shifted],
      maxShift: 119 - facilityShift,
      bookings: [{ nodeId: 'gate', instant: 1040, timelineRow: 2 }],
    });
    assert.equal(solveJunctionShift(q), 70); // 1030+70=1100，跟 1040 差 60
    assert.equal(diagnoseJunctionBlock(q).points[0]!.instant, 1030);
  });

  it('自己這一列的預約不算阻擋；位移優先落在 10 秒刻度上', () => {
    const q = query({
      bookings: [
        { nodeId: 'gate', instant: 1000, timelineRow: 1 },
        { nodeId: 'gate', instant: 1005, timelineRow: 2 },
      ],
    });
    const shift = solveJunctionShift(q)!;
    assert.equal(shift % 10, 0);
    assert.equal(shift, 70);
  });
});

describe('單線路段：只防對開，同方向跟車不互斥', () => {
  const segment = 'seg:a|b';
  it('同方向的車剛開上同一段：路段不擋（先進先出由兩端點的錯開保證）', () => {
    const shift = solveJunctionShift(query({
      points: [{ nodeId: `${segment}#f`, instant: 1000, until: 1050 }],
      bookings: [{ nodeId: `${segment}#f`, instant: 980, until: 1030, timelineRow: 2 }],
    }));
    assert.equal(shift, 0);
  });

  it('反方向的車還在這一段上：要等它開完再加一個保護間隔才能上去', () => {
    const shift = solveJunctionShift(query({
      points: [{ nodeId: `${segment}#f`, instant: 1000, until: 1050 }],
      bookings: [{ nodeId: `${segment}#r`, instant: 980, until: 1030, timelineRow: 2 }],
      maxShift: 200,
    }));
    assert.equal(shift, 90); // 1030 + 60 − 1000
  });
});

describe('月台套站位規則 solveJunctionShift', () => {
  const berthNodeIds = new Set(['NWD']);

  it('跟在停靠車後面可留 30 秒，有空檔時優先留 60 秒', () => {
    const q = query({
      points: [{ nodeId: 'NWD', instant: 1030 }],
      bookings: [{ nodeId: 'NWD', instant: 800, until: 1000, timelineRow: 2 }],
      bufferSeconds: 30,
      minShift: 0,
      maxShift: 300,
      berthNodeIds,
      preferBerthClearance: true,
    });
    assert.equal(solveJunctionShift(q), 30);
    assert.equal(solveJunctionShift({ ...q, maxShift: 0 }), 0);
  });

  it('月台上對方在停靠：要差開兩倍間隔', () => {
    // 我 1000 經過；對方 1030 到、停到 1600。一倍間隔 30 秒本來可以，站位規則要 60 秒
    const base = query({
      points: [{ nodeId: 'NWD', instant: 1000 }],
      bookings: [{ nodeId: 'NWD', instant: 1030, until: 1600, timelineRow: 2 }],
      bufferSeconds: 30,
      minShift: -120,
      maxShift: 0,
    });
    assert.equal(solveJunctionShift(base), 0);
    assert.equal(solveJunctionShift({ ...base, berthNodeIds }), -30);
  });

  it('月台上兩台都只是經過：維持一倍間隔', () => {
    const q = query({
      points: [{ nodeId: 'NWD', instant: 1000 }],
      bookings: [{ nodeId: 'NWD', instant: 1030, timelineRow: 2 }],
      bufferSeconds: 30,
      berthNodeIds,
    });
    assert.equal(solveJunctionShift(q), 0);
  });
});
