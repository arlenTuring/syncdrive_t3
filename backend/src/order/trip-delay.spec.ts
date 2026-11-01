import { tripDelayMinutes } from './trip-delay';

const END = 1_800_000_000_000;

describe('tripDelayMinutes', () => {
  it('不到一分鐘算準點，之後取整分鐘', () => {
    expect(tripDelayMinutes(END, END + 59_999)).toBe(0);
    expect(tripDelayMinutes(END, END + 60_000)).toBe(1);
    expect(tripDelayMinutes(String(END), END + 150_000)).toBe(2);
  });

  it('允許秒數可調：比一分鐘短也標得出延誤，比一分鐘長就晚點才算', () => {
    expect(tripDelayMinutes(END, END + 29_000, 30)).toBe(0);
    expect(tripDelayMinutes(END, END + 30_000, 30)).toBe(1);
    expect(tripDelayMinutes(END, END + 179_000, 180)).toBe(0);
    expect(tripDelayMinutes(END, END + 180_000, 180)).toBe(3);
    expect(tripDelayMinutes(END, END, 0)).toBe(0);
    expect(tripDelayMinutes(END, END + 1, 0)).toBe(1);
  });

  it('沒有計畫結束或提早完成都是 0', () => {
    expect(tripDelayMinutes(null, END)).toBe(0);
    expect(tripDelayMinutes(0, END)).toBe(0);
    expect(tripDelayMinutes(END, END - 1_000)).toBe(0);
  });
});
