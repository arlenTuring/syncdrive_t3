import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnoseJunctionBlock, solveJunctionShift, type JunctionShiftQuery } from './junctionShift';

/** 時刻都只是測試資料；間隔 60 秒、刻度 10 秒 */
const DAY = 86_400;
function query(overrides: Partial<JunctionShiftQuery>): JunctionShiftQuery {
  return {
    points: [{ nodeId: 'gate', instant: 1000 }],
    bookings: [],
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
