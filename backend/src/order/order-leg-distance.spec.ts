import { mergeLegDistanceMax } from './order.service';

describe('mergeLegDistanceMax（班次卡進度的距離分母）', () => {
  it('每段記觀測到的最大距離，之後的較小距離不改分母；其他段保留', () => {
    let m = mergeLegDistanceMax(undefined, 'B', 300);
    m = mergeLegDistanceMax(m, 'B', 120);
    m = mergeLegDistanceMax(m, 'C', 480);
    expect(m).toEqual({ B: 300, C: 480 });
  });

  it('缺距離、非數字、0 不寫入，也不清掉已有的分母', () => {
    const base = { B: 300 };
    expect(mergeLegDistanceMax(base, 'B', null)).toEqual(base);
    expect(mergeLegDistanceMax(base, 'C', 0)).toEqual(base);
    expect(mergeLegDistanceMax(base, null, 50)).toEqual(base);
    expect(mergeLegDistanceMax({ B: 'x' }, 'B', 10)).toEqual({ B: 10 });
  });
});
